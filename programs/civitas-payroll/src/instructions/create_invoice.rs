//! create_invoice — contractor creates a shareable invoice commitment on-chain.

use anchor_lang::prelude::*;

use crate::{
    events::InvoiceCreated,
    state::{InvoiceAccount, InvoiceStatus, MAX_METADATA_CID_LEN},
};

#[derive(Accounts)]
#[instruction(id: [u8; 16], commitment: [u8; 32], due_ts: i64, metadata_cid: String)]
pub struct CreateInvoice<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + InvoiceAccount::INIT_SPACE,
        seeds = [b"invoice".as_ref(), id.as_ref()],
        bump,
    )]
    pub invoice_account: Account<'info, InvoiceAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateInvoice>,
    id: [u8; 16],
    commitment: [u8; 32],
    due_ts: i64,
    metadata_cid: String,
) -> Result<()> {
    require!(
        metadata_cid.len() <= MAX_METADATA_CID_LEN,
        crate::errors::CivitasError::ChunkTooLarge
    );

    let invoice = &mut ctx.accounts.invoice_account;
    invoice.id = id;
    invoice.commitment = commitment;
    invoice.creator = ctx.accounts.creator.key();
    invoice.due_ts = due_ts;
    invoice.metadata_cid = metadata_cid;
    invoice.status = InvoiceStatus::Pending;
    invoice.bump = ctx.bumps.invoice_account;

    emit!(InvoiceCreated {
        id,
        commitment,
        creator: ctx.accounts.creator.key(),
        due_ts,
    });

    Ok(())
}
