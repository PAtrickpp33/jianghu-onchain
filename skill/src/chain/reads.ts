// Convenience wrappers around viem readContract calls. These keep tool
// handlers readable and push ABI knowledge down into the chain/ boundary.

import type { Address } from "viem";
import { getPublicClient, getAddresses } from "./client.js";
import { heroNftAbi, arenaAbi } from "./abi.js";
import { decodeHero, decodeBattleReport } from "./decode.js";
import type { Hero, BattleReport } from "../types.js";

/**
 * Resolve tokens owned by `owner` by scanning `Transfer` events (mint = from=0x0).
 *
 * HeroNFT is plain ERC-721 (not Enumerable), so `tokenOfOwnerByIndex` doesn't
 * exist. We walk the ERC-721 Transfer log for mints to `owner`, then filter
 * out anything subsequently transferred away. For hackathon scale (<100 heroes
 * per player) this is fine; a production indexer would cache.
 */
export async function fetchOwnedHeroIds(owner: Address): Promise<bigint[]> {
  const { hero } = getAddresses();
  const client = getPublicClient();

  const balance = (await client.readContract({
    address: hero,
    abi: heroNftAbi,
    functionName: "balanceOf",
    args: [owner],
  })) as bigint;

  if (balance === 0n) return [];

  // Transfer(from indexed, to indexed, tokenId indexed) — topic0 is ERC-721
  // standard. Base Sepolia public RPC caps `eth_getLogs` at a 10k-block
  // range, so we chunk-walk backwards from `latest`. Stop once we've
  // accumulated as many tokens as `balanceOf` reports (no further history
  // can help — the remaining balance must come from the chunks we've
  // already covered, or we've already exceeded the current balance count).
  const BLOCK_CHUNK = 9_000n;
  const MAX_LOOKBACK_BLOCKS = 2_000_000n; // ~1-2 months on Base Sepolia
  const latest = await client.getBlockNumber();
  const lowerBound = latest > MAX_LOOKBACK_BLOCKS ? latest - MAX_LOOKBACK_BLOCKS : 0n;

  const transferEvent = {
    type: "event" as const,
    name: "Transfer",
    inputs: [
      { type: "address", name: "from", indexed: true },
      { type: "address", name: "to", indexed: true },
      { type: "uint256", name: "tokenId", indexed: true },
    ],
  };

  type TransferLog = {
    args?: { tokenId?: bigint };
  };
  const logs: TransferLog[] = [];
  let to = latest;
  while (to >= lowerBound) {
    const from = to >= BLOCK_CHUNK ? to - BLOCK_CHUNK + 1n : 0n;
    const chunk = await client.getLogs({
      address: hero,
      event: transferEvent,
      args: { to: owner },
      fromBlock: from,
      toBlock: to,
    });
    logs.push(...(chunk as unknown as TransferLog[]));
    if (from === 0n) break;
    to = from - 1n;
    // Short-circuit: once we have enough candidates to match current balance,
    // older history can't add owned tokens we'd miss (a token you own now
    // must have a mint/receive event in the range we already covered).
    if (BigInt(logs.length) >= balance) break;
  }

  const candidates = new Set<string>();
  for (const l of logs) {
    const id = (l.args as { tokenId?: bigint })?.tokenId;
    if (id !== undefined) candidates.add(id.toString());
  }

  // Filter out any that were later transferred away (owner != current owner).
  const ownedNow: bigint[] = [];
  for (const idStr of candidates) {
    try {
      const currOwner = (await client.readContract({
        address: hero,
        abi: heroNftAbi,
        functionName: "ownerOf",
        args: [BigInt(idStr)],
      })) as unknown as Address;
      if (currOwner.toLowerCase() === owner.toLowerCase()) {
        ownedNow.push(BigInt(idStr));
      }
    } catch {
      // Burned tokens throw on ownerOf — skip.
    }
  }

  // Sorted ascending for stable ordering.
  ownedNow.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ownedNow;
}

export async function fetchHasMintedGenesis(owner: Address): Promise<boolean> {
  const { hero } = getAddresses();
  const client = getPublicClient();
  return (await client.readContract({
    address: hero,
    abi: heroNftAbi,
    functionName: "hasMintedGenesis",
    args: [owner],
  })) as boolean;
}

export async function fetchHero(tokenId: bigint): Promise<Hero> {
  const { hero } = getAddresses();
  const client = getPublicClient();
  const raw = (await client.readContract({
    address: hero,
    abi: heroNftAbi,
    functionName: "getHero",
    args: [tokenId],
  })) as Parameters<typeof decodeHero>[0];
  return decodeHero(raw);
}

export async function fetchHeroes(ids: bigint[]): Promise<Hero[]> {
  if (ids.length === 0) return [];
  const { hero } = getAddresses();
  const client = getPublicClient();
  const raws = (await client.readContract({
    address: hero,
    abi: heroNftAbi,
    functionName: "getHeroes",
    args: [ids],
  })) as Parameters<typeof decodeHero>[0][];
  return raws.map(decodeHero);
}

export async function fetchDefenseTeam(player: Address): Promise<[bigint, bigint, bigint]> {
  const { arena } = getAddresses();
  const client = getPublicClient();
  return (await client.readContract({
    address: arena,
    abi: arenaAbi,
    functionName: "getDefenseTeam",
    args: [player],
  })) as [bigint, bigint, bigint];
}

export async function fetchArenaList(
  offset: bigint,
  limit: bigint,
): Promise<{ players: Address[]; powers: bigint[] }> {
  const { arena } = getAddresses();
  const client = getPublicClient();
  const [players, powers] = (await client.readContract({
    address: arena,
    abi: arenaAbi,
    functionName: "listArena",
    args: [offset, limit],
  })) as [readonly Address[], readonly bigint[]];
  return { players: [...players], powers: [...powers] };
}

export async function fetchBattleReport(
  battleId: `0x${string}`,
  teams?: { attackerTeam: Hero[]; defenderTeam: Hero[] },
  txHash?: `0x${string}`,
): Promise<BattleReport> {
  const { arena } = getAddresses();
  const client = getPublicClient();
  const raw = (await client.readContract({
    address: arena,
    abi: arenaAbi,
    functionName: "getBattleReport",
    args: [battleId],
  })) as Parameters<typeof decodeBattleReport>[0];
  return decodeBattleReport(
    raw,
    teams?.attackerTeam ?? [],
    teams?.defenderTeam ?? [],
    txHash,
  );
}
