// Direct EVM signer for `XIAKE_MODE=sepolia` — bypasses OnchainOS.
//
// Why this exists
// ───────────────
// OnchainOS (WaaS + Paymaster) only supports mainnet chains. Our contracts
// live on Base **Sepolia** for hackathon demos. This module lets the skill
// issue tx directly with a local private key (pulled from `XIAKE_PLAYER_PK`),
// using viem's `createWalletClient` + `privateKeyToAccount`.
//
// Scope / caveats
// ───────────────
// - The skill holds a private key in process memory. Acceptable for testnet
//   + hackathon demo, NOT for production. Mainnet stays on OnchainOS.
// - The player pays gas themselves (no Paymaster). Sepolia ETH is free from
//   faucets so this is a non-issue for testnet.
// - Matches `signAndSend` from onchainos/gateway.ts so call-sites don't care
//   which backend is active.

import {
  createWalletClient,
  http,
  encodeFunctionData,
  type Hex,
  type WalletClient,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { getPublicClient } from "./client.js";

const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

let _wallet: WalletClient | null = null;
let _account: ReturnType<typeof privateKeyToAccount> | null = null;

function loadAccount() {
  if (_account) return _account;
  const pk = process.env.XIAKE_PLAYER_PK;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error(
      "XIAKE_MODE=sepolia 需要设置 XIAKE_PLAYER_PK (0x 前缀 · 64 字符 hex)。" +
        " 用 `cast wallet new` 生成一个测试网专用钱包,去 faucet 领 Sepolia ETH 后再运行。",
    );
  }
  _account = privateKeyToAccount(pk as Hex);
  return _account;
}

function getWallet(): WalletClient {
  if (_wallet) return _wallet;
  const account = loadAccount();
  _wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
  return _wallet;
}

/** Player's address derived from XIAKE_PLAYER_PK. */
export function getPlayerAddress(): Address {
  return loadAccount().address;
}

export interface DirectSendInput {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Native-token value in wei (decimal string), defaults to "0". */
  value?: string;
  /** Gas ceiling, defaults to 4_000_000 (enough for the heaviest battle). */
  gasLimit?: number;
}

export interface DirectSendResult {
  txHash: `0x${string}`;
}

/**
 * Sign + send a raw EVM tx using XIAKE_PLAYER_PK. Waits briefly for the tx
 * to hit the mempool, returns immediately on success.
 *
 * Call-sites mirror the OnchainOS `signAndSend` signature — the caller
 * doesn't know (or care) which backend is active.
 */
export async function directSignAndSend(input: DirectSendInput): Promise<DirectSendResult> {
  const wallet = getWallet();
  const account = loadAccount();
  const value = input.value ? BigInt(input.value) : 0n;
  const gas = BigInt(input.gasLimit ?? 4_000_000);

  const hash = await wallet.sendTransaction({
    account,
    chain: baseSepolia,
    to: input.to,
    data: input.data,
    value,
    gas,
  });
  return { txHash: hash };
}

/** Block until the tx mines (or timeout). Used by tools that need receipts. */
export async function directWaitForTx(
  txHash: `0x${string}`,
  opts: { timeoutMs?: number } = {},
): Promise<{ state: "success" | "failed"; blockNumber?: number }> {
  const publicClient = getPublicClient();
  const timeout = BigInt(opts.timeoutMs ?? 60_000);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: Number(timeout),
  });
  return {
    state: receipt.status === "success" ? "success" : "failed",
    blockNumber: Number(receipt.blockNumber),
  };
}

/** Re-export encodeFunctionData for call-sites that want to stay in one module. */
export { encodeFunctionData };
