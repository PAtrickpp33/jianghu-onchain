// Viem public client for Base Sepolia (chainId 84532).
// Only public (read-only) operations go through here; all write tx go through
// the OnchainOS gateway (see ../onchainos/gateway.ts).

import { createPublicClient, http, type PublicClient, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL =
  process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";

let _client: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL),
    }) as PublicClient;
  }
  return _client;
}

export const CHAIN_ID = 84532;

export interface ContractAddresses {
  hero: Address;
  arena: Address;
}

export class MissingAddressError extends Error {
  constructor(which: "hero" | "arena") {
    const envVar = which === "hero" ? "XIAKE_HERO_ADDRESS" : "XIAKE_ARENA_ADDRESS";
    super(
      `合约地址未配置: 请在 MCP env 中设置 ${envVar} (格式 0x...40 chars)。` +
        ` 参考 mcp.json 示例。`,
    );
    this.name = "MissingAddressError";
  }
}

function validateAddress(raw: string | undefined, which: "hero" | "arena"): Address {
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new MissingAddressError(which);
  }
  return raw as Address;
}

export function getAddresses(): ContractAddresses {
  return {
    hero: validateAddress(process.env.XIAKE_HERO_ADDRESS, "hero"),
    arena: validateAddress(process.env.XIAKE_ARENA_ADDRESS, "arena"),
  };
}

/** Format a tx explorer URL for base-sepolia. */
export function txUrl(hash: `0x${string}`): string {
  return `https://sepolia.basescan.org/tx/${hash}`;
}
