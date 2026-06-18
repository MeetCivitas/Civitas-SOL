//! Civitas Payroll — private payroll on Solana, gated by on-chain compliance
//! attestation, settled by MagicBlock's encrypted-queue Private Payments.
//!
//! Architecture:
//!   1. /api/compliance (Chainalysis + IP geofence + jurisdiction)  [off-chain]
//!      ↓
//!   2. attest_compliance  → freshness timestamp on treasury PDA   [base]
//!      ↓
//!   3. shield_funds  → employer ATA -> treasury PDA's ATA          [base]
//!      ↓
//!   4. Per disbursement, one atomic base-layer transaction:
//!        a. authorize_disburse  → compliance freshness check +
//!                                 per-employee + daily limits +
//!                                 PDA-signed SPL release from
//!                                 treasury ATA into employer's
//!                                 working ATA
//!        b. MagicBlock transferSpl (private, base → base) — takes the
//!           amount from employer's working ATA, queues encrypted
//!           recipient + jitter/split policy to the TEE validator,
//!           which settles to the employee's wallet ATA in seconds
//!
//! Custody model:
//!   • Treasury PDA owns its SPL ATA — the only place that holds shielded
//!     funds. ONLY this program can release them (PDA invoke_signed).
//!   • Employer wallet never holds the shielded pool; their working ATA
//!     is funded for the duration of a single tx and immediately drained
//!     into MagicBlock's shuttle.
//!   • A compromised employer key cannot drain the treasury without
//!     passing the compliance + limits gate inside `authorize_disburse`.
//!
//! What's not here (v1 tradeoff):
//!   • The compliance attestor key is the employer themselves on devnet
//!     for ergonomics. In production this should be a Civitas-controlled
//!     oracle keypair that signs `attest_compliance` only after a fresh
//!     Chainalysis screen + IP geofence check passes.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer as SplTransfer},
};

declare_id!("BW2wwxbsSjixSfXNGoD9ajoUq8394ZkB2Fn9PusXjJfs");

// ─── Seeds ─────────────────────────────────────────────────────────────────

pub const TREASURY_SEED: &[u8] = b"civ_treasury";

// ─── Tunables ──────────────────────────────────────────────────────────────

/// Maximum age (seconds) of a compliance attestation before transfers are
/// rejected. 24h on devnet for demo convenience; tighten to ~5min on
/// mainnet (oracle re-attesting every ~60s).
pub const COMPLIANCE_MAX_AGE_SECS: i64 = 86_400;

/// Hard upper bound on per-transfer amount, regardless of employer setting.
/// Mainnet-safety guard. 10M base units (with 6-decimal mint = 10M USDC).
pub const HARD_PER_TRANSFER_CAP: u64 = 10_000_000_000_000;

/// Seconds in a day, for daily-cap rollover.
pub const SECS_PER_DAY: i64 = 86_400;

// ═══════════════════════════════════════════════════════════════════════════
//   PROGRAM
// ═══════════════════════════════════════════════════════════════════════════

#[program]
pub mod civitas_ephemeral {
    use super::*;

    // ─── 1. initialize_payroll_pool ─────────────────────────────────────────

    pub fn initialize_payroll_pool(
        ctx: Context<InitializePayrollPool>,
        per_employee_limit: u64,
        daily_limit: u64,
        compliance_attestor: Pubkey,
    ) -> Result<()> {
        require!(per_employee_limit > 0, CivitasError::InvalidLimit);
        require!(
            per_employee_limit <= HARD_PER_TRANSFER_CAP,
            CivitasError::LimitExceedsCap
        );
        require!(
            daily_limit >= per_employee_limit,
            CivitasError::DailyLimitTooLow
        );

        let treasury = &mut ctx.accounts.treasury;
        treasury.authority = ctx.accounts.authority.key();
        treasury.mint = ctx.accounts.mint.key();
        treasury.treasury_token_account = ctx.accounts.treasury_token_account.key();
        treasury.total_shielded = 0;
        treasury.total_disbursed = 0;
        treasury.per_employee_limit = per_employee_limit;
        treasury.daily_limit = daily_limit;
        treasury.daily_disbursed = 0;
        treasury.daily_cap_day = 0;
        treasury.compliance_attestor = compliance_attestor;
        treasury.compliance_attested_at = 0;
        treasury.jurisdiction_code = [0u8; 4];
        treasury.bump = ctx.bumps.treasury;

        emit!(TreasuryInitialized {
            treasury: treasury.key(),
            authority: treasury.authority,
            mint: treasury.mint,
            per_employee_limit,
            daily_limit,
        });
        Ok(())
    }

    // ─── 2. attest_compliance ───────────────────────────────────────────────

    pub fn attest_compliance(
        ctx: Context<AttestCompliance>,
        passed: bool,
        jurisdiction_code: [u8; 4],
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require_keys_eq!(
            treasury.compliance_attestor,
            ctx.accounts.attestor.key(),
            CivitasError::NotAttestor
        );
        require!(passed, CivitasError::ComplianceFailed);

        let clock = Clock::get()?;
        treasury.compliance_attested_at = clock.unix_timestamp;
        treasury.jurisdiction_code = jurisdiction_code;

        emit!(ComplianceAttested {
            treasury: treasury.key(),
            attestor: ctx.accounts.attestor.key(),
            attested_at: treasury.compliance_attested_at,
            jurisdiction_code,
        });
        Ok(())
    }

    // ─── 3. shield_funds ────────────────────────────────────────────────────

    pub fn shield_funds(ctx: Context<ShieldFunds>, amount: u64) -> Result<()> {
        require!(amount > 0, CivitasError::InvalidAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.source_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        let treasury = &mut ctx.accounts.treasury;
        treasury.total_shielded = treasury
            .total_shielded
            .checked_add(amount)
            .ok_or(CivitasError::Overflow)?;

        emit!(FundsShielded {
            treasury: treasury.key(),
            amount,
            new_total_shielded: treasury.total_shielded,
        });
        Ok(())
    }

    // ─── 4. authorize_disburse ──────────────────────────────────────────────
    //
    // Atomic gate + custody release. Must be the FIRST instruction in the
    // disburse tx; the MagicBlock `transferSpl(visibility=private)` ix that
    // follows takes `amount` from the employer's working ATA into the
    // shuttle/queue. Because both ixs are in the same tx, partial failure
    // is impossible: if the queue ix fails, this entire authorization
    // reverts and the funds stay shielded.
    //
    // The `recipient` parameter is recorded in the emitted event so an
    // off-chain receipt indexer can link the on-chain authorization to the
    // private settlement that lands ~3-30s later.
    pub fn authorize_disburse(
        ctx: Context<AuthorizeDisburse>,
        amount: u64,
        recipient: Pubkey,
    ) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(amount > 0, CivitasError::InvalidAmount);
        require!(amount <= HARD_PER_TRANSFER_CAP, CivitasError::Overflow);

        // ── Compliance freshness gate ──
        let clock = Clock::get()?;
        let age = clock
            .unix_timestamp
            .saturating_sub(treasury.compliance_attested_at);
        require!(
            treasury.compliance_attested_at > 0 && age <= COMPLIANCE_MAX_AGE_SECS,
            CivitasError::ComplianceStale
        );

        // ── Per-employee limit ──
        require!(
            amount <= treasury.per_employee_limit,
            CivitasError::ExceedsPerEmployeeLimit
        );

        // ── Daily cap (auto-reset on day rollover) ──
        let today = clock.unix_timestamp / SECS_PER_DAY;
        if treasury.daily_cap_day != today {
            treasury.daily_disbursed = 0;
            treasury.daily_cap_day = today;
        }
        let new_daily = treasury
            .daily_disbursed
            .checked_add(amount)
            .ok_or(CivitasError::Overflow)?;
        require!(new_daily <= treasury.daily_limit, CivitasError::DailyCapExceeded);

        // ── Solvency check (treasury holds enough shielded) ──
        let new_total = treasury
            .total_disbursed
            .checked_add(amount)
            .ok_or(CivitasError::Overflow)?;
        require!(
            new_total <= treasury.total_shielded,
            CivitasError::InsufficientShieldedBalance
        );

        // ── Bump counters BEFORE the CPI (defensive against reentrancy) ──
        treasury.daily_disbursed = new_daily;
        treasury.total_disbursed = new_total;

        // ── PDA-signed SPL transfer: treasury ATA → authority working ATA ──
        //
        // After this returns, the employer's working ATA holds `amount`
        // briefly. The MagicBlock transferSpl ix that follows in the same
        // tx will move it into the shuttle PDA, which the TEE crank then
        // settles to the encrypted recipient. Net effect on the employer's
        // working ATA across the full tx: 0.
        let authority_key = treasury.authority;
        let bump = treasury.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[TREASURY_SEED, authority_key.as_ref(), &[bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_token_account.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: treasury.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        emit!(DisburseAuthorized {
            treasury: treasury.key(),
            authority: ctx.accounts.authority.key(),
            recipient,
            amount,
            daily_disbursed: treasury.daily_disbursed,
            total_disbursed: treasury.total_disbursed,
            jurisdiction_code: treasury.jurisdiction_code,
        });
        Ok(())
    }

    // ─── 5. emergency_unshield ──────────────────────────────────────────────
    //
    // Admin reclaim: treasury authority pulls any portion of the shielded
    // pool back to their working ATA without going through the queue.
    // Useful for closing out a payroll cycle or recovering from a misconfig.
    // Does NOT touch compliance — it's a custody-owner action, intentionally
    // independent of the disburse gating.
    pub fn emergency_unshield(ctx: Context<EmergencyUnshield>, amount: u64) -> Result<()> {
        let treasury = &mut ctx.accounts.treasury;
        require!(amount > 0, CivitasError::InvalidAmount);
        require_keys_eq!(
            treasury.authority,
            ctx.accounts.authority.key(),
            CivitasError::NotAuthority
        );

        // Cap the unshield at the unspent shielded balance.
        let unspent = treasury
            .total_shielded
            .checked_sub(treasury.total_disbursed)
            .unwrap_or(0);
        require!(amount <= unspent, CivitasError::InsufficientShieldedBalance);

        let authority_key = treasury.authority;
        let bump = treasury.bump;
        let signer_seeds: &[&[&[u8]]] =
            &[&[TREASURY_SEED, authority_key.as_ref(), &[bump]]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.treasury_token_account.to_account_info(),
                    to: ctx.accounts.authority_token_account.to_account_info(),
                    authority: treasury.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;

        // Bookkeeping: emergency unshield reduces the "total_shielded" tally
        // so future disburse solvency checks reflect actual treasury balance.
        treasury.total_shielded = treasury
            .total_shielded
            .checked_sub(amount)
            .ok_or(CivitasError::Overflow)?;

        emit!(EmergencyUnshielded {
            treasury: treasury.key(),
            authority: ctx.accounts.authority.key(),
            amount,
            remaining_shielded: treasury.total_shielded,
        });
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════
//   ACCOUNT CONTEXTS
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Accounts)]
pub struct InitializePayrollPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + EmployerTreasury::INIT_SPACE,
        seeds = [TREASURY_SEED, authority.key().as_ref()],
        bump
    )]
    pub treasury: Account<'info, EmployerTreasury>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = treasury,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AttestCompliance<'info> {
    pub attestor: Signer<'info>,
    #[account(mut)]
    pub treasury: Account<'info, EmployerTreasury>,
}

#[derive(Accounts)]
pub struct ShieldFunds<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [TREASURY_SEED, authority.key().as_ref()],
        bump = treasury.bump,
        has_one = authority @ CivitasError::NotAuthority,
    )]
    pub treasury: Account<'info, EmployerTreasury>,
    #[account(
        mut,
        constraint = source_token_account.mint == treasury.mint @ CivitasError::MintMismatch,
        constraint = source_token_account.owner == authority.key() @ CivitasError::NotAuthority,
    )]
    pub source_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = treasury_token_account.key() == treasury.treasury_token_account
            @ CivitasError::TreasuryAtaMismatch,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AuthorizeDisburse<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [TREASURY_SEED, authority.key().as_ref()],
        bump = treasury.bump,
        has_one = authority @ CivitasError::NotAuthority,
    )]
    pub treasury: Account<'info, EmployerTreasury>,
    #[account(
        mut,
        constraint = treasury_token_account.key() == treasury.treasury_token_account
            @ CivitasError::TreasuryAtaMismatch,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    /// The employer's working ATA. The PDA-signed transfer lands here so
    /// the MagicBlock `transferSpl` ix that follows in the same tx can
    /// take it through the encrypted queue.
    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key() @ CivitasError::NotAuthority,
        constraint = authority_token_account.mint == treasury.mint @ CivitasError::MintMismatch,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencyUnshield<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [TREASURY_SEED, authority.key().as_ref()],
        bump = treasury.bump,
        has_one = authority @ CivitasError::NotAuthority,
    )]
    pub treasury: Account<'info, EmployerTreasury>,
    #[account(
        mut,
        constraint = treasury_token_account.key() == treasury.treasury_token_account
            @ CivitasError::TreasuryAtaMismatch,
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key() @ CivitasError::NotAuthority,
        constraint = authority_token_account.mint == treasury.mint @ CivitasError::MintMismatch,
    )]
    pub authority_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ═══════════════════════════════════════════════════════════════════════════
//   STATE
// ═══════════════════════════════════════════════════════════════════════════

#[account]
#[derive(InitSpace)]
pub struct EmployerTreasury {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub treasury_token_account: Pubkey,
    pub total_shielded: u64,
    pub total_disbursed: u64,
    pub per_employee_limit: u64,
    pub daily_limit: u64,
    pub daily_disbursed: u64,
    pub daily_cap_day: i64,
    pub compliance_attestor: Pubkey,
    pub compliance_attested_at: i64,
    pub jurisdiction_code: [u8; 4],
    pub bump: u8,
}

// ═══════════════════════════════════════════════════════════════════════════
//   EVENTS
// ═══════════════════════════════════════════════════════════════════════════

#[event]
pub struct TreasuryInitialized {
    pub treasury: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub per_employee_limit: u64,
    pub daily_limit: u64,
}

#[event]
pub struct ComplianceAttested {
    pub treasury: Pubkey,
    pub attestor: Pubkey,
    pub attested_at: i64,
    pub jurisdiction_code: [u8; 4],
}

#[event]
pub struct FundsShielded {
    pub treasury: Pubkey,
    pub amount: u64,
    pub new_total_shielded: u64,
}

#[event]
pub struct DisburseAuthorized {
    pub treasury: Pubkey,
    pub authority: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub daily_disbursed: u64,
    pub total_disbursed: u64,
    pub jurisdiction_code: [u8; 4],
}

#[event]
pub struct EmergencyUnshielded {
    pub treasury: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub remaining_shielded: u64,
}

// ═══════════════════════════════════════════════════════════════════════════
//   ERRORS
// ═══════════════════════════════════════════════════════════════════════════

#[error_code]
pub enum CivitasError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Per-employee limit must be greater than zero")]
    InvalidLimit,
    #[msg("Limit exceeds mainnet safety cap")]
    LimitExceedsCap,
    #[msg("Daily limit must be at least the per-employee limit")]
    DailyLimitTooLow,
    #[msg("Mint mismatch between accounts")]
    MintMismatch,
    #[msg("Signer is not the configured compliance attestor")]
    NotAttestor,
    #[msg("Compliance check failed (passed=false)")]
    ComplianceFailed,
    #[msg("Compliance attestation is stale — re-attest before disbursing")]
    ComplianceStale,
    #[msg("Signer is not the treasury authority")]
    NotAuthority,
    #[msg("Provided treasury token account does not match treasury record")]
    TreasuryAtaMismatch,
    #[msg("Amount exceeds per-employee limit")]
    ExceedsPerEmployeeLimit,
    #[msg("Disbursement would exceed daily cap")]
    DailyCapExceeded,
    #[msg("Insufficient shielded balance in treasury")]
    InsufficientShieldedBalance,
    #[msg("Arithmetic overflow")]
    Overflow,
}
