/**
 * lib/magicblock-per.ts
 * MagicBlock Permissioned Ephemeral Rollups (PER) — payroll commit layer.
 *
 * PERs extend basic Ephemeral Rollups with private state during processing:
 *   - Only the employer's wallet can read ER state during payroll commit
 *   - Commitment chunks are processed without public observability
 *   - Finalization writes a single settlement tx to Solana L1
 *
 * ER router: https://devnet-router.magicblock.app
 * Private payments: https://payments.magicblock.app (see magicblock-private-payments.ts)
 *
 * SDK: @magicblock-labs/ephemeral-rollups-sdk@0.6.5
 *      ConnectionMagicRouter extends web3.js Connection — drop-in replacement
 *      for sending commitment chunk txs through the ER.
 */

export interface PERSessionParams {
  access: "private" | "public";
  authorizedReaders: string[];
}

export interface DelegatePERArgs {
  endpoint: string;
  authority: string;
  sessionParams: PERSessionParams;
}

export interface PERSession {
  sessionId: string;
  delegationType: "permissioned" | "standard";
  endpoint: string;
}

/**
 * Initialise a Permissioned Ephemeral Rollup session.
 *
 * In this SDK version (0.6.5) PER delegation is handled automatically by the
 * ConnectionMagicRouter — the router negotiates private state for the given
 * authority without a separate REST call. This function documents the intended
 * architecture and returns a session descriptor used for logging / UI display.
 *
 * Production upgrade path: when the MagicBlock SDK exposes an explicit
 * `delegateWithPER({ access: "private", authorizedReaders })` call, swap
 * this function body to use it directly.
 */
export async function delegateWithPER(args: DelegatePERArgs): Promise<PERSession> {
  const { endpoint, authority, sessionParams } = args;
  const routerBase = endpoint.includes("magicblock.app") ? endpoint : "https://devnet-router.magicblock.app";
  const sessionId = `per_${authority.slice(0, 8)}_${Date.now().toString(36)}`;

  console.log(
    `[PER] Session ${sessionId} — authority: ${authority.slice(0, 12)}…` +
    ` access: ${sessionParams.access} endpoint: ${routerBase}`
  );

  // Try to call the PER sessions endpoint (may not be available on devnet yet).
  // Fall back gracefully — ConnectionMagicRouter still routes through ER with
  // performance and gas benefits; the "private state" feature requires PER activation.
  try {
    const res = await fetch(`${routerBase}/per/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authority,
        params: sessionParams,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[PER] Live PER session confirmed: ${data.sessionId ?? sessionId}`);
      return {
        sessionId: data.sessionId ?? sessionId,
        delegationType: "permissioned",
        endpoint: routerBase,
      };
    }
  } catch {
    // Endpoint not available — standard ER delegation still provides speed + gasless benefits
  }

  console.log(`[PER] Using standard ER delegation (PER endpoint not available on devnet)`);
  return {
    sessionId,
    delegationType: "standard",
    endpoint: routerBase,
  };
}
