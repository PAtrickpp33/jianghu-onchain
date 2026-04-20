// Runtime mode selector for the Xiake skill + CLI.
//
// Modes
//   mock     — pure local simulation, no chain, no keys. Default. Works offline.
//   sepolia  — direct EVM signing with XIAKE_PLAYER_PK against Base Sepolia.
//              Bypasses OnchainOS (which doesn't support testnets).
//   onchain  — OnchainOS MPC wallet + Paymaster. Mainnet only.
//   hybrid   — dev/debug: pulls reads from chain but mutations go local.
//
// Precedence
//   1. XIAKE_MODE env var if explicitly set
//   2. Auto: "onchain" when contract addresses + OKX_API_KEY are present,
//            "sepolia" when addresses + XIAKE_PLAYER_PK are present,
//            else "mock".

export type Mode = "mock" | "sepolia" | "onchain" | "hybrid";

/** True when writes should go on-chain (either via OnchainOS or direct-sign). */
export function isChainMode(mode: Mode): boolean {
  return mode === "onchain" || mode === "sepolia";
}

export function getMode(): Mode {
  const explicit = process.env.XIAKE_MODE as Mode | undefined;
  if (
    explicit === "mock" ||
    explicit === "sepolia" ||
    explicit === "onchain" ||
    explicit === "hybrid"
  ) {
    return explicit;
  }
  const hasAddrs = Boolean(
    process.env.XIAKE_ARENA_ADDRESS && process.env.XIAKE_HERO_ADDRESS,
  );
  if (!hasAddrs) return "mock";
  if (process.env.OKX_API_KEY) return "onchain";
  if (process.env.XIAKE_PLAYER_PK) return "sepolia";
  return "mock";
}
