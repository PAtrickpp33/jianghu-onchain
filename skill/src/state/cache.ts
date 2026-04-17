// Session-level in-memory cache. The MCP server process is the session; data
// evaporates when the client disconnects, which is fine because all truth is
// on chain.

import type { Hero, BattleEvent, BattleReport } from "../types.js";

export interface AchievementRecord {
  earned: boolean;
  progress: number;
  unlockedAt: number; // epoch ms, 0 if not yet unlocked
}

export interface BattleHistoryDetailed {
  kind: "pve" | "pvp" | "arena" | "auto";
  stageId?: string;
  subtitle?: string;
  winner: 0 | 1 | 2;
  timestamp: number;
  playerTeam: Hero[];       // snapshot of lineup that fought
  opponentTeam: Hero[];
  opponentLabel: string;
  events: BattleEvent[];    // full event log for replay
  mvpIdx?: number;          // MVP actorIdx (0..5)
  mvpName?: string;
}

export interface SeasonState {
  current: number;
  startsAt: number;         // epoch ms
  endsAt: number;           // epoch ms
  top100?: Array<{ rank: number; address: string; reputation: number }>;
  lastRank?: number;        // rank in previous season (mock)
}

interface SkillState {
  currentPlayer?: { address: `0x${string}`; nickname?: string };
  heroCache: Map<string, Hero>; // key = tokenId.toString()
  lastBattleId?: `0x${string}`;
  reportCache: Map<string, BattleReport>; // key = battleId
  defenseTeam?: [bigint, bigint, bigint]; // mock PVP defense lineup (session-level)
}

const state: SkillState = {
  heroCache: new Map(),
  reportCache: new Map(),
};

export function setCurrentPlayer(address: `0x${string}`, nickname?: string): void {
  state.currentPlayer = { address, nickname };
}

export function getCurrentPlayer(): SkillState["currentPlayer"] {
  return state.currentPlayer;
}

export function cacheHero(hero: Hero): void {
  state.heroCache.set(hero.tokenId.toString(), hero);
}

export function cacheHeroes(heroes: Hero[]): void {
  for (const h of heroes) cacheHero(h);
}

export function getCachedHero(tokenId: bigint): Hero | undefined {
  return state.heroCache.get(tokenId.toString());
}

export function getHeroCache(): Map<string, Hero> {
  return state.heroCache;
}

export function setLastBattleId(id: `0x${string}`): void {
  state.lastBattleId = id;
}

export function getLastBattleId(): `0x${string}` | undefined {
  return state.lastBattleId;
}

export function cacheReport(report: BattleReport): void {
  state.reportCache.set(report.battleId, report);
}

export function getCachedReport(battleId: `0x${string}`): BattleReport | undefined {
  return state.reportCache.get(battleId);
}

export function setDefenseTeam(ids: [bigint, bigint, bigint]): void {
  state.defenseTeam = ids;
}

export function getDefenseTeam(): [bigint, bigint, bigint] | undefined {
  return state.defenseTeam;
}

export function resetState(): void {
  state.currentPlayer = undefined;
  state.heroCache.clear();
  state.reportCache.clear();
  state.lastBattleId = undefined;
  state.defenseTeam = undefined;
}
