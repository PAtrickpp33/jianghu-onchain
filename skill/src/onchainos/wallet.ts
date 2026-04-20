// OnchainOS Wallet-as-a-Service helpers.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §4.3
//
// Endpoints:
//   POST /api/v5/wallet/account/create-wallet-account   create MPC-custodied wallet
//   GET  /api/v5/wallet/account/list                    list wallets for the project
//   GET  /api/v5/wallet/asset/balance                   native + token + NFT balances
//
// The skill keeps a 1:1 mapping between "current player" and one wallet account,
// identified by an app-supplied `accountId` (e.g. a nickname or a hash of the
// Claude Code session id). The actual EVM address is returned by the API.

import { request } from "./client.js";

export interface WalletAccount {
  /** App-level identifier passed at creation time. */
  accountId: string;
  /** Checksummed EVM address of the MPC wallet. */
  address: `0x${string}`;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
}

export interface TokenBalance {
  /** Contract address, or the native-asset sentinel when applicable. */
  tokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  symbol: string;
  decimals: number;
  /** Raw on-chain balance as a decimal string (not scaled). */
  balance: string;
}

export interface NftHolding {
  contractAddress: `0x${string}`;
  tokenId: string; // uint256 as decimal string
  name?: string;
  standard?: "ERC-721" | "ERC-1155";
}

export interface WalletBalanceSnapshot {
  address: `0x${string}`;
  chainId: number;
  native: TokenBalance;
  tokens: TokenBalance[];
  nfts: NftHolding[];
}

/**
 * Create a new MPC-custodied wallet. Safe to call on every `xiake_init`: if
 * the account already exists the call will succeed and return the existing
 * record (OnchainOS behaves idempotently for this endpoint when the same
 * `accountId` is reused).
 */
export async function createWalletAccount(params: {
  accountId: string;
  chainIds?: number[];
}): Promise<WalletAccount> {
  const chainIds = params.chainIds ?? [84532]; // default to Base Sepolia
  const raw = await request<RawWalletAccount>("POST", "/api/v5/wallet/account/create-wallet-account", {
    body: { accountId: params.accountId, chainIds: chainIds.map(String) },
  });
  return normalizeAccount(raw);
}

/**
 * Look up the wallet for an `accountId`. Returns `null` if none exists yet.
 * Implemented on top of the list endpoint since OnchainOS doesn't expose a
 * per-id GET; we filter client-side.
 */
export async function getWalletAccount(accountId: string): Promise<WalletAccount | null> {
  const raw = await request<{ accounts: RawWalletAccount[] }>("GET", "/api/v5/wallet/account/list", {
    query: { accountId },
  });
  const hit = raw.accounts.find((a) => a.accountId === accountId);
  return hit ? normalizeAccount(hit) : null;
}

/**
 * Get native + ERC-20 + ERC-721 balances for a wallet on a specific chain.
 * For the Xiake skill we only care about Base Sepolia (`chainId=84532`).
 */
export async function getWalletBalance(params: {
  address: `0x${string}`;
  chainId?: number;
}): Promise<WalletBalanceSnapshot> {
  const chainId = params.chainId ?? 84532;
  const raw = await request<RawBalance>("GET", "/api/v5/wallet/asset/balance", {
    query: { address: params.address, chainId: String(chainId) },
  });
  return {
    address: params.address,
    chainId,
    native: {
      tokenAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      symbol: raw.native?.symbol ?? "ETH",
      decimals: raw.native?.decimals ?? 18,
      balance: raw.native?.balance ?? "0",
    },
    tokens: (raw.tokens ?? []).map((t) => ({
      tokenAddress: t.tokenAddress as `0x${string}`,
      symbol: t.symbol,
      decimals: t.decimals,
      balance: t.balance,
    })),
    nfts: (raw.nfts ?? []).map((n) => ({
      contractAddress: n.contractAddress as `0x${string}`,
      tokenId: n.tokenId,
      name: n.name,
      standard: n.standard as NftHolding["standard"],
    })),
  };
}

// ── internal response shapes ────────────────────────────────────────────────

interface RawWalletAccount {
  accountId: string;
  address: string;
  createdAt: string | number;
}

function normalizeAccount(a: RawWalletAccount): WalletAccount {
  return {
    accountId: a.accountId,
    address: a.address.toLowerCase() as `0x${string}`,
    createdAt: typeof a.createdAt === "string" ? Number(a.createdAt) : a.createdAt,
  };
}

interface RawBalance {
  native?: { symbol: string; decimals: number; balance: string };
  tokens?: Array<{ tokenAddress: string; symbol: string; decimals: number; balance: string }>;
  nfts?: Array<{ contractAddress: string; tokenId: string; name?: string; standard?: string }>;
}
