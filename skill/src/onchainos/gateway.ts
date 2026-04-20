// OnchainOS Gateway — off-chain signing + relay for EVM transactions.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §4.3
//
// The Xiake skill NEVER holds a private key. Every state-changing contract
// call (Arena.challenge, HeroNFT.mintGenesis, …) is marshalled here into a
// signAndSend request. OnchainOS signs with the custodied MPC wallet, attaches
// a paymaster policy for gas sponsorship, and relays the tx to Base Sepolia.

import { OnchainOSError, request } from "./client.js";

/** Chain id for Base Sepolia — the deploy target for HeroNFT / Arena. */
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export interface SignAndSendInput {
  /** Wallet address that should sign + pay (via paymaster). */
  from: `0x${string}`;
  /** Destination contract address. */
  to: `0x${string}`;
  /** ABI-encoded calldata (0x-prefixed hex). */
  data: `0x${string}`;
  /** Optional native-asset value in wei as a decimal string. Defaults to "0". */
  value?: string;
  /** EVM chain id. Defaults to Base Sepolia (84532). */
  chainId?: number;
  /**
   * Optional paymaster policy id. If omitted, OnchainOS applies the project's
   * default policy from the Dev Portal (which we configure to cover all
   * HeroNFT / Arena methods).
   */
  paymasterPolicyId?: string;
  /**
   * When true, the call explicitly skips paymaster sponsorship — the player
   * wallet pays gas (and `value`) directly. Used for paid-mint flows where
   * the user is already consenting to an ETH spend, per docs/GACHA_PRD_TECH.md §2.5.
   */
  bypassPaymaster?: boolean;
  /** Gas ceiling in gas units. Defaults to 3_000_000 — plenty for a 3v3 battle. */
  gasLimit?: number;
}

export interface SignAndSendResult {
  /** 0x-prefixed EVM transaction hash. */
  txHash: `0x${string}`;
  /** Echoed back by the gateway so callers can correlate status polls. */
  taskId?: string;
}

/**
 * Submit a single EVM transaction via the OnchainOS gateway.
 *
 * Failures (rejection by risk control, insufficient gas budget on paymaster,
 * simulation revert, …) surface as `OnchainOSError` with the original message
 * preserved on `.message` and any structured data on `.data`.
 */
export async function signAndSend(input: SignAndSendInput): Promise<SignAndSendResult> {
  const chainId = input.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const body = {
    chainId: String(chainId),
    from: input.from,
    to: input.to,
    data: input.data,
    value: input.value ?? "0",
    gasLimit: input.gasLimit ? String(input.gasLimit) : undefined,
    // bypassPaymaster=true overrides any policy id so the player pays gas.
    paymasterPolicyId: input.bypassPaymaster ? undefined : input.paymasterPolicyId,
  };

  let raw: RawSignAndSend;
  try {
    raw = await request<RawSignAndSend>("POST", "/api/v5/onchain-gateway/tx/sign-and-send", { body });
  } catch (err) {
    // Preserve typed OnchainOSError, wrap anything else.
    if (err instanceof OnchainOSError) throw err;
    throw new OnchainOSError(`signAndSend failed: ${(err as Error).message}`, { code: "E_GATEWAY" });
  }

  if (!raw?.txHash || !/^0x[0-9a-fA-F]{64}$/.test(raw.txHash)) {
    throw new OnchainOSError("Gateway returned no tx hash", { code: "E_GATEWAY", data: raw });
  }
  return { txHash: raw.txHash as `0x${string}`, taskId: raw.taskId };
}

/**
 * Poll gateway for the status / receipt of a submitted transaction.
 *
 * The skill's tool handlers typically await confirmation before decoding the
 * BattleReport from chain state — this helper centralises that poll loop.
 */
export async function waitForTx(params: {
  txHash: `0x${string}`;
  chainId?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<TxStatus> {
  const chainId = params.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const timeoutMs = params.timeoutMs ?? 60_000;
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  // Allow a short grace period between polls so we don't hammer the gateway.
  while (Date.now() < deadline) {
    const status = await getTxStatus({ txHash: params.txHash, chainId });
    if (status.state === "success" || status.state === "failed") return status;
    await sleep(pollIntervalMs);
  }
  throw new OnchainOSError(`Tx ${params.txHash} not mined within ${timeoutMs}ms`, { code: "E_TIMEOUT" });
}

export interface TxStatus {
  txHash: `0x${string}`;
  state: "pending" | "success" | "failed";
  blockNumber?: number;
  errorMessage?: string;
}

export async function getTxStatus(params: {
  txHash: `0x${string}`;
  chainId?: number;
}): Promise<TxStatus> {
  const chainId = params.chainId ?? BASE_SEPOLIA_CHAIN_ID;
  const raw = await request<RawTxStatus>("GET", "/api/v5/onchain-gateway/tx/status", {
    query: { txHash: params.txHash, chainId: String(chainId) },
  });
  return {
    txHash: params.txHash,
    state: normalizeState(raw.state),
    blockNumber: raw.blockNumber ? Number(raw.blockNumber) : undefined,
    errorMessage: raw.errorMessage,
  };
}

// ── internals ───────────────────────────────────────────────────────────────

interface RawSignAndSend {
  txHash?: string;
  taskId?: string;
}

interface RawTxStatus {
  state: string;
  blockNumber?: string | number;
  errorMessage?: string;
}

function normalizeState(s: string): TxStatus["state"] {
  const lower = s.toLowerCase();
  if (lower === "success" || lower === "confirmed" || lower === "mined") return "success";
  if (lower === "failed" || lower === "reverted" || lower === "dropped") return "failed";
  return "pending";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
