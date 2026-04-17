// Runtime mode selector for the Jianghu skill + CLI.
//
// Precedence:
//   1. WUXIA_MODE env var if explicitly set ("mock" | "onchain" | "hybrid")
//   2. Auto: "onchain" when both contract addresses are present, else "mock"

export type Mode = "mock" | "onchain" | "hybrid";

export function getMode(): Mode {
  const explicit = process.env.WUXIA_MODE as Mode | undefined;
  if (explicit === "mock" || explicit === "onchain" || explicit === "hybrid") {
    return explicit;
  }
  return process.env.WUXIA_ARENA_ADDRESS && process.env.WUXIA_HERO_ADDRESS
    ? "onchain"
    : "mock";
}
