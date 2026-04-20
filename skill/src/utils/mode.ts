// Runtime mode selector for the Xiake skill + CLI.
//
// Precedence:
//   1. XIAKE_MODE env var if explicitly set ("mock" | "onchain" | "hybrid")
//   2. Auto: "onchain" when both contract addresses are present, else "mock"

export type Mode = "mock" | "onchain" | "hybrid";

export function getMode(): Mode {
  const explicit = process.env.XIAKE_MODE as Mode | undefined;
  if (explicit === "mock" || explicit === "onchain" || explicit === "hybrid") {
    return explicit;
  }
  return process.env.XIAKE_ARENA_ADDRESS && process.env.XIAKE_HERO_ADDRESS
    ? "onchain"
    : "mock";
}
