// Thin wrapper around `aiVsAi.ts`'s orchestrator for the `wuxia_ai_vs_ai` tool.
//
// Responsibilities:
//   1. Map the tool's compact input ({agentA, agentB, rounds, withCaster})
//      to the full `AiVsAiInput` / `AiVsAiDeps` interface.
//   2. Assemble Decision agents (LLM-backed or mock) and an optional Caster.
//   3. Provide an off-chain `simulateRound` that approximates BattleEngine.sol
//      closely enough for demo purposes. The canonical simulation still lives
//      on-chain; this TS replica exists so AI vs AI demos can run without an
//      RPC round-trip per round (latency would kill the pacing).
//   4. Collect the full Markdown transcript and return it — the tool handler
//      hands this string back to the MCP client verbatim.

import {
  runAiVsAi as runOrchestrator,
  type AiVsAiDeps,
  type AiVsAiInput,
} from "./aiVsAi.js";
import {
  createCaster,
  createDecisionAgent,
  type Caster,
  type DecisionAgent,
} from "./caster.js";
import type { DecisionPersona } from "./prompts.js";
import { fetchDefenseTeam, fetchHeroes } from "../chain/reads.js";
import {
  FLAG_CRIT,
  FLAG_KILL,
  Sect,
  SkillKind,
  type AgentDecisionOutput,
  type BattleEvent,
  type Hero,
  type HeroState,
} from "../types.js";
import type { SkillMeta } from "../render/battleReport.js";

// ── Public API ──────────────────────────────────────────────────────────────

export type AgentId = "claude" | "gpt" | "mock" | "tangmen" | "shaolin" | "emei";

export interface SimpleRunInput {
  agentA: AgentId;
  agentB: AgentId;
  /** Number of battles back-to-back. Clamped to [1, 3] for the demo. */
  rounds: number;
  /** Whether to stream caster commentary. Requires ANTHROPIC_API_KEY. */
  withCaster: boolean;
}

/**
 * Entry point called by the `wuxia_ai_vs_ai` tool handler. Returns the full
 * battle Markdown transcript (suitable for direct MCP response).
 */
export async function runAiVsAi(input: SimpleRunInput): Promise<string> {
  const demoA = (process.env.WUXIA_DEMO_PLAYER_A ?? DEMO_DEFAULT_A) as `0x${string}`;
  const demoB = (process.env.WUXIA_DEMO_PLAYER_B ?? DEMO_DEFAULT_B) as `0x${string}`;

  const useChain =
    Boolean(process.env.WUXIA_ARENA_ADDRESS) &&
    Boolean(process.env.WUXIA_HERO_ADDRESS) &&
    input.agentA !== "mock" &&
    input.agentB !== "mock";

  const agentA = makeAgent(input.agentA);
  const agentB = makeAgent(input.agentB);

  const caster: Caster | undefined =
    input.withCaster && process.env.ANTHROPIC_API_KEY ? createCaster() : undefined;

  // Generate random teams each run for variety
  const seed = Date.now();
  const teamA = useChain ? [] : generateRandomTeam(seed, "A");
  const teamB = useChain ? [] : generateRandomTeam(seed + 7, "B");

  const deps: AiVsAiDeps = {
    loadTeam: useChain
      ? loadTeamFromChain
      : async (addr) => (addr === demoA ? teamA : teamB),
    simulateRound: simulateRoundOffChain,
    skillMeta: SKILL_META,
    // submitOnchain intentionally omitted — demo stays off-chain for pacing.
  };

  const battles = clamp(input.rounds, 1, 3);

  const io: AiVsAiInput = {
    agentA: { address: demoA, agent: agentA, label: labelFor(input.agentA) },
    agentB: { address: demoB, agent: agentB, label: labelFor(input.agentB) },
    caster,
    battles,
    maxRounds: 30,
    emit: () => {
      /* transcript is accumulated in result.markdown; don't double-print. */
    },
  };

  const result = await runOrchestrator(io, deps);
  return result.markdown;
}

// ── Agent wiring ────────────────────────────────────────────────────────────

function makeAgent(id: AgentId): DecisionAgent {
  if (id === "mock" || !process.env.ANTHROPIC_API_KEY) {
    return mockAgent(id);
  }
  const persona = personaFor(id);
  return createDecisionAgent({ persona });
}

function personaFor(id: AgentId): DecisionPersona {
  // Aggressive pairing on the left, defensive on the right. Tweak as needed
  // once we have real playtest data.
  switch (id) {
    case "claude":
    case "tangmen":
      return "raven";
    case "gpt":
    case "shaolin":
    case "emei":
      return "phoenix";
    default:
      return "raven";
  }
}

function labelFor(id: AgentId): string {
  switch (id) {
    case "claude": return "🅰 玄铁 (Claude)";
    case "gpt": return "🅱 凌霄 (GPT)";
    case "mock": return "🤖 木桩";
    case "tangmen": return "🗡 唐门掌门";
    case "shaolin": return "🥋 少林住持";
    case "emei": return "⛩ 峨眉掌门";
    default: return id;
  }
}

/**
 * Smart mock agent with basic heuristics. No LLM needed but plays reasonably:
 * - Heals when any ally HP < 40%
 * - Uses control on highest ATK enemy
 * - Focuses lowest HP enemy for damage
 * - Uses AoE when 2+ enemies alive
 * - Rotates actors and adds trash talk variety
 */
function mockAgent(id: AgentId): DecisionAgent {
  let turnCounter = 0;
  const trashTalks = [
    "看招!", "受死!", "这一剑,送你上西天!", "休想逃!",
    "纳命来!", "你已落入我的计中!", "哼,不过如此。", "江湖再见!",
    "你的武功,不值一提。", "接我一招试试!",
  ];

  return {
    persona: (id === "shaolin" || id === "emei" ? "phoenix" : "raven") as DecisionPersona,
    async decide(input) {
      turnCounter++;
      const myAlive = input.mySide.map((h, i) => ({ h, i })).filter(x => x.h.alive);
      const enemyAlive = input.enemySide.map((h, i) => ({ h, i })).filter(x => x.h.alive);

      if (myAlive.length === 0 || enemyAlive.length === 0) {
        return { actorIdx: 0, skillId: 0, targetIdx: 0, trashTalk: "..." };
      }

      // Pick actor: rotate through alive heroes
      const actorEntry = myAlive[turnCounter % myAlive.length];
      const actor = actorEntry.h;
      const actorIdx = actorEntry.i;
      const skills = actor.hero.skillIds;

      // Check if any ally needs healing (HP < 40%)
      const woundedAlly = myAlive.find(x => x.h.currentHp < x.h.hero.hp * 0.4);
      const healSkill = skills.find(s => SKILL_META[s]?.kind === SkillKind.Heal);
      if (woundedAlly && healSkill !== undefined) {
        return {
          actorIdx,
          skillId: healSkill,
          targetIdx: woundedAlly.i,
          trashTalk: "先疗伤,再战不迟!",
        };
      }

      // Use control on highest ATK enemy (if we have control skill)
      const controlSkill = skills.find(s => SKILL_META[s]?.kind === SkillKind.Control);
      const highAtkEnemy = [...enemyAlive].sort((a, b) => b.h.hero.atk - a.h.hero.atk)[0];
      if (controlSkill !== undefined && enemyAlive.length >= 2 && turnCounter % 3 === 0) {
        return {
          actorIdx,
          skillId: controlSkill,
          targetIdx: highAtkEnemy.i,
          trashTalk: "定!",
        };
      }

      // Use AoE when 2+ enemies alive
      const aoeSkill = skills.find(s => {
        const eff = SKILL_EFFECT[s];
        return eff && eff.kind === SkillKind.Damage && eff.aoe;
      });
      if (aoeSkill !== undefined && enemyAlive.length >= 2) {
        return {
          actorIdx,
          skillId: aoeSkill,
          targetIdx: enemyAlive[0].i,
          trashTalk: trashTalks[turnCounter % trashTalks.length],
        };
      }

      // Focus lowest HP enemy with best damage skill
      const lowestHpEnemy = [...enemyAlive].sort((a, b) => a.h.currentHp - b.h.currentHp)[0];
      const dmgSkill = skills.find(s => {
        const eff = SKILL_EFFECT[s];
        return eff && (eff.kind === SkillKind.Damage || eff.kind === SkillKind.Dot);
      }) ?? skills[0];

      return {
        actorIdx,
        skillId: dmgSkill,
        targetIdx: lowestHpEnemy.i,
        trashTalk: trashTalks[turnCounter % trashTalks.length],
      };
    },
  };
}

// ── On-chain team loader ────────────────────────────────────────────────────

async function loadTeamFromChain(address: `0x${string}`): Promise<Hero[]> {
  const [a, b, c] = await fetchDefenseTeam(address);
  const heroes = await fetchHeroes([a, b, c]);
  if (heroes.length !== 3) {
    throw new Error(
      `Player ${address} has not set a defense team yet. Call wuxia_set_defense_team first.`,
    );
  }
  return heroes;
}

// ── Skill metadata (mirrors SkillRegistry.sol) ──────────────────────────────

export const SKILL_META: Record<number, SkillMeta> = {
  // Shaolin
  0: { id: 0, name: "金钟罩", kind: SkillKind.Buff },
  1: { id: 1, name: "易筋经", kind: SkillKind.Heal },
  2: { id: 2, name: "狮子吼", kind: SkillKind.Control },
  // Tangmen
  3: { id: 3, name: "穿心刺", kind: SkillKind.Damage },
  4: { id: 4, name: "暗器急雨", kind: SkillKind.Damage },
  5: { id: 5, name: "毒针", kind: SkillKind.Dot },
  // Emei
  6: { id: 6, name: "慈航普渡", kind: SkillKind.Heal },
  7: { id: 7, name: "净心咒", kind: SkillKind.Control },
  8: { id: 8, name: "般若掌", kind: SkillKind.Damage },
};

// Multipliers in basis points (10000 = 100% of ATK).
const SKILL_EFFECT: Record<
  number,
  { kind: SkillKind; multBps: number; aoe: boolean; duration: number; heal: number }
> = {
  0: { kind: SkillKind.Buff, multBps: 0, aoe: false, duration: 2, heal: 0 },     // 金钟罩: +DEF buff
  1: { kind: SkillKind.Heal, multBps: 0, aoe: false, duration: 0, heal: 30 },    // 易筋经
  2: { kind: SkillKind.Control, multBps: 0, aoe: true, duration: 1, heal: 0 },   // 狮子吼
  3: { kind: SkillKind.Damage, multBps: 15000, aoe: false, duration: 0, heal: 0 }, // 穿心刺
  4: { kind: SkillKind.Damage, multBps: 8000, aoe: true, duration: 0, heal: 0 },   // 暗器急雨
  5: { kind: SkillKind.Dot, multBps: 1000, aoe: false, duration: 3, heal: 0 },     // 毒针
  6: { kind: SkillKind.Heal, multBps: 0, aoe: true, duration: 0, heal: 20 },       // 慈航普渡
  7: { kind: SkillKind.Control, multBps: 0, aoe: false, duration: 1, heal: 0 },    // 净心咒 (dispel + silence)
  8: { kind: SkillKind.Damage, multBps: 12000, aoe: false, duration: 0, heal: 0 }, // 般若掌
};

// ── Off-chain simulator ─────────────────────────────────────────────────────

interface SimulateRoundArgs {
  round: number;
  attackerState: HeroState[];
  defenderState: HeroState[];
  attackerMove: AgentDecisionOutput;
  defenderMove: AgentDecisionOutput;
  seed: bigint;
}

async function simulateRoundOffChain(
  args: SimulateRoundArgs,
): Promise<{
  events: BattleEvent[];
  attackerState: HeroState[];
  defenderState: HeroState[];
  terminated: boolean;
  winner?: 0 | 1 | 2;
}> {
  const aState = args.attackerState.map(cloneState);
  const bState = args.defenderState.map(cloneState);

  const events: BattleEvent[] = [];
  const rng = seededRng(args.seed);

  // Apply DoT at top of round, before moves resolve.
  applyDotTick(aState, args.round, 0, events);
  applyDotTick(bState, args.round, 3, events);

  // Determine turn order by SPD of the *acting* hero.
  const order: Array<{ side: "A" | "B"; move: AgentDecisionOutput; spd: number; actorIdx: number }> = [];
  const aActor = aState[args.attackerMove.actorIdx];
  const bActor = bState[args.defenderMove.actorIdx];
  if (aActor?.alive) {
    order.push({ side: "A", move: args.attackerMove, spd: aActor.hero.spd, actorIdx: args.attackerMove.actorIdx });
  }
  if (bActor?.alive) {
    order.push({ side: "B", move: args.defenderMove, spd: bActor.hero.spd, actorIdx: args.defenderMove.actorIdx });
  }
  order.sort((x, y) => y.spd - x.spd);

  for (const turn of order) {
    const mine = turn.side === "A" ? aState : bState;
    const theirs = turn.side === "A" ? bState : aState;
    const globalActorIdx = turn.side === "A" ? turn.actorIdx : turn.actorIdx + 3;

    if (!mine[turn.actorIdx]?.alive) continue;
    // Silenced? skip.
    if (isSilenced(mine[turn.actorIdx])) continue;

    const effect = SKILL_EFFECT[turn.move.skillId];
    if (!effect) continue;

    switch (effect.kind) {
      case SkillKind.Damage: {
        const targets = effect.aoe ? alive(theirs) : [pickTarget(theirs, turn.move.targetIdx)];
        for (const t of targets) {
          if (!t) continue;
          const globalTargetIdx = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          const { dmg, crit } = computeDamage(mine[turn.actorIdx].hero, t.hero, effect.multBps, rng);
          t.currentHp = Math.max(0, t.currentHp - dmg);
          let flags = crit ? FLAG_CRIT : 0;
          if (t.currentHp === 0) {
            t.alive = false;
            flags |= FLAG_KILL;
          }
          events.push({
            round: args.round,
            actorIdx: globalActorIdx,
            skillId: turn.move.skillId,
            targetIdx: globalTargetIdx,
            hpDelta: -dmg,
            flags,
          });
        }
        break;
      }
      case SkillKind.Heal: {
        const targets = effect.aoe ? alive(mine) : [pickTarget(mine, turn.move.targetIdx) ?? mine[turn.actorIdx]];
        for (const t of targets) {
          if (!t) continue;
          const globalTargetIdx = (turn.side === "A" ? 0 : 3) + mine.indexOf(t);
          const healed = Math.min(effect.heal, t.hero.hp - t.currentHp);
          t.currentHp += healed;
          events.push({
            round: args.round,
            actorIdx: globalActorIdx,
            skillId: turn.move.skillId,
            targetIdx: globalTargetIdx,
            hpDelta: healed,
            flags: 0,
          });
        }
        break;
      }
      case SkillKind.Buff: {
        mine[turn.actorIdx].buffs.push({
          kind: SkillKind.Buff,
          value: 30, // +30 DEF, matches 金钟罩 spec
          roundsLeft: effect.duration,
        });
        events.push({
          round: args.round,
          actorIdx: globalActorIdx,
          skillId: turn.move.skillId,
          targetIdx: globalActorIdx,
          hpDelta: 0,
          flags: 0,
        });
        break;
      }
      case SkillKind.Control: {
        const targets = effect.aoe ? alive(theirs) : [pickTarget(theirs, turn.move.targetIdx)];
        for (const t of targets) {
          if (!t) continue;
          const globalTargetIdx = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          t.buffs.push({
            kind: SkillKind.Control,
            value: 0,
            roundsLeft: effect.duration,
          });
          events.push({
            round: args.round,
            actorIdx: globalActorIdx,
            skillId: turn.move.skillId,
            targetIdx: globalTargetIdx,
            hpDelta: 0,
            flags: 0,
          });
        }
        break;
      }
      case SkillKind.Dot: {
        const target = pickTarget(theirs, turn.move.targetIdx);
        if (!target) break;
        const globalTargetIdx = (turn.side === "A" ? 3 : 0) + theirs.indexOf(target);
        const tickDmg = Math.max(1, Math.floor((target.hero.hp * effect.multBps) / 10000));
        target.buffs.push({
          kind: SkillKind.Dot,
          value: tickDmg,
          roundsLeft: effect.duration,
        });
        events.push({
          round: args.round,
          actorIdx: globalActorIdx,
          skillId: turn.move.skillId,
          targetIdx: globalTargetIdx,
          hpDelta: 0,
          flags: 0,
        });
        break;
      }
    }
  }

  // Tick down buff/debuff durations at end of round.
  tickBuffs(aState);
  tickBuffs(bState);

  const aAlive = aState.some((h) => h.alive);
  const bAlive = bState.some((h) => h.alive);

  let terminated = false;
  let winner: 0 | 1 | 2 | undefined;
  if (!aAlive && !bAlive) {
    terminated = true;
    winner = 2;
  } else if (!aAlive) {
    terminated = true;
    winner = 1;
  } else if (!bAlive) {
    terminated = true;
    winner = 0;
  }

  return {
    events,
    attackerState: aState,
    defenderState: bState,
    terminated,
    winner,
  };
}

// ── Simulator helpers ───────────────────────────────────────────────────────

function cloneState(s: HeroState): HeroState {
  return {
    hero: s.hero,
    currentHp: s.currentHp,
    buffs: s.buffs.map((b) => ({ ...b })),
    alive: s.alive,
  };
}

function alive(states: HeroState[]): HeroState[] {
  return states.filter((s) => s.alive);
}

function pickTarget(states: HeroState[], preferredIdx: number): HeroState | undefined {
  const mapped = preferredIdx >= 3 ? preferredIdx - 3 : preferredIdx;
  if (states[mapped]?.alive) return states[mapped];
  return alive(states)[0];
}

function isSilenced(state: HeroState): boolean {
  return state.buffs.some((b) => b.kind === SkillKind.Control && b.roundsLeft > 0);
}

function defBonus(state: HeroState): number {
  return state.buffs
    .filter((b) => b.kind === SkillKind.Buff)
    .reduce((sum, b) => sum + b.value, 0);
}

function computeDamage(
  attacker: Hero,
  defender: Hero,
  multBps: number,
  rng: () => number,
): { dmg: number; crit: boolean } {
  const base = Math.floor((attacker.atk * multBps) / 10000);
  const mitigated = Math.max(1, base - Math.floor(defender.def / 2));
  const critRoll = rng() * 10000;
  const isCrit = critRoll < attacker.crit;
  const dmg = isCrit ? Math.floor(mitigated * 1.5) : mitigated;
  return { dmg, crit: isCrit };
}

function applyDotTick(
  side: HeroState[],
  round: number,
  sideOffset: number,
  events: BattleEvent[],
): void {
  side.forEach((hero, i) => {
    if (!hero.alive) return;
    for (const b of hero.buffs) {
      if (b.kind === SkillKind.Dot && b.roundsLeft > 0) {
        const dmg = b.value;
        hero.currentHp = Math.max(0, hero.currentHp - dmg);
        if (hero.currentHp === 0) hero.alive = false;
        events.push({
          round,
          actorIdx: sideOffset + i,
          skillId: 5, // 毒针 id
          targetIdx: sideOffset + i,
          hpDelta: -dmg,
          flags: hero.alive ? 0 : FLAG_KILL,
        });
      }
    }
  });
}

function tickBuffs(side: HeroState[]): void {
  for (const hero of side) {
    hero.buffs = hero.buffs
      .map((b) => ({ ...b, roundsLeft: b.roundsLeft - 1 }))
      .filter((b) => b.roundsLeft > 0);
  }
}

function seededRng(seed: bigint): () => number {
  let state = seed === 0n ? 1n : seed;
  const mod = 2n ** 32n;
  return () => {
    state = (state * 1103515245n + 12345n) % mod;
    return Number(state) / Number(mod);
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── Mock teams (demo fallback when no chain) ────────────────────────────────

const DEMO_DEFAULT_A = "0x000000000000000000000000000000000000A001";
const DEMO_DEFAULT_B = "0x000000000000000000000000000000000000B002";

// ── Random team generation ──────────────────────────────────────────────────

const HERO_POOL: Array<Omit<Hero, "tokenId">> = [
  // Shaolin
  { sect: Sect.Shaolin, name: "圆智", hp: 180, atk: 70, def: 95, spd: 55, crit: 500,  skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "玄苦", hp: 200, atk: 75, def: 100, spd: 50, crit: 400, skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "空见", hp: 190, atk: 65, def: 105, spd: 45, crit: 300, skillIds: [1, 0, 2] },
  { sect: Sect.Shaolin, name: "渡劫", hp: 170, atk: 80, def: 90, spd: 60, crit: 600,  skillIds: [2, 0, 1] },
  // Tangmen
  { sect: Sect.Tangmen, name: "飞燕", hp: 100, atk: 95, def: 50, spd: 90, crit: 1500, skillIds: [3, 4, 5] },
  { sect: Sect.Tangmen, name: "无名", hp: 110, atk: 90, def: 55, spd: 85, crit: 1800, skillIds: [3, 5, 4] },
  { sect: Sect.Tangmen, name: "夜鸮", hp: 95,  atk: 100, def: 45, spd: 95, crit: 2000, skillIds: [4, 3, 5] },
  { sect: Sect.Tangmen, name: "柳如烟", hp: 105, atk: 88, def: 52, spd: 88, crit: 1600, skillIds: [5, 3, 4] },
  // Emei
  { sect: Sect.Emei, name: "静因", hp: 130, atk: 65, def: 70, spd: 80, crit: 800,  skillIds: [6, 7, 8] },
  { sect: Sect.Emei, name: "灭绝", hp: 120, atk: 80, def: 65, spd: 75, crit: 1200, skillIds: [8, 6, 7] },
  { sect: Sect.Emei, name: "风陵", hp: 125, atk: 72, def: 68, spd: 82, crit: 1000, skillIds: [6, 8, 7] },
  { sect: Sect.Emei, name: "周芷若", hp: 115, atk: 85, def: 60, spd: 78, crit: 1400, skillIds: [8, 7, 6] },
];

/**
 * Generate a random 3-hero team from the hero pool, seeded for reproducibility
 * within a single run but different between runs.
 */
function generateRandomTeam(seed: number, side: "A" | "B"): Hero[] {
  const rng = simpleRng(seed);
  const shuffled = [...HERO_POOL].sort(() => rng() - 0.5);

  // Pick 3 with at least 2 different sects for variety
  const team: Array<Omit<Hero, "tokenId">> = [];
  const usedSects = new Set<Sect>();
  for (const hero of shuffled) {
    if (team.length >= 3) break;
    // Allow 2 of same sect max
    if (team.length === 2 && usedSects.size === 1 && usedSects.has(hero.sect)) continue;
    team.push(hero);
    usedSects.add(hero.sect);
  }

  // Fill if we didn't get 3 (edge case)
  while (team.length < 3) team.push(shuffled[team.length]);

  const baseId = side === "A" ? 1 : 100;
  return team.map((h, i) => ({
    ...h,
    tokenId: BigInt(baseId + i),
    // Add slight stat variance ±5% for freshness
    hp: h.hp + Math.floor((rng() - 0.5) * h.hp * 0.1),
    atk: h.atk + Math.floor((rng() - 0.5) * h.atk * 0.1),
    def: h.def + Math.floor((rng() - 0.5) * h.def * 0.1),
    spd: h.spd + Math.floor((rng() - 0.5) * h.spd * 0.1),
  }));
}

function simpleRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}
