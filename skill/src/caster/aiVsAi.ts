// AI vs AI battle orchestrator.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §4.6
//
// Flow per battle:
//   1. Load both teams (defense teams previously set on-chain).
//   2. For each round until termination:
//        a. Each side's decision agent picks (actor, skill, target).
//        b. We submit both moves to the on-chain BattleEngine (via the
//           `simulateOneRound` adapter wired in `../chain/*`, owned by another
//           engineer — we depend on the `simulateRound` callback that is
//           injected through `deps`).
//        c. The resulting `BattleEvent[]` is fed to the caster to produce
//           commentary, which we stream alongside the ASCII renderer.
//   3. A final `BattleReport` is returned; the caller (the `xiake_ai_vs_ai`
//      tool handler) bundles it into the tool response.
//
// This module does NOT touch the OnchainOS SDK directly — it is simulation +
// narration only. The *actual* chain tx (Arena.challengeRelay) is also
// injected via `deps.submitOnchain`, so the orchestrator stays unit-testable
// with stubs.
//
// For the hackathon we demo 3 battles back-to-back and print cumulative score.

import { renderBattleReportStream, renderLiveHpStrip } from "../render/battleReport.js";
import { bold, faint, status as statusColor, heal as healColor, crit as critColor } from "../render/ansi.js";
import {
  FLAG_KILL,
  SECT_NAMES,
  Sect,
  type AgentDecisionInput,
  type AgentDecisionOutput,
  type BattleEvent,
  type BattleReport,
  type Hero,
  type HeroState,
  hasFlag,
} from "../types.js";
import type { Caster, DecisionAgent } from "./caster.js";
import type { SkillMeta } from "../render/battleReport.js";

// ── Public API ──────────────────────────────────────────────────────────────

export interface AiVsAiDeps {
  /**
   * Load a player's on-chain defense team as hydrated Hero objects. Owned by
   * `src/chain/*`.
   */
  loadTeam(address: `0x${string}`): Promise<Hero[]>;
  /**
   * Advance one round of simulation given both sides' decisions. Returns the
   * raw events for this round plus the resulting HP snapshot so we can
   * update our HeroState. Implemented on top of either an off-chain replica
   * of `BattleEngine.simulate` or a view-call variant. Owned by `src/chain/*`.
   */
  simulateRound(args: {
    round: number;
    attackerState: HeroState[];
    defenderState: HeroState[];
    attackerMove: AgentDecisionOutput;
    defenderMove: AgentDecisionOutput;
    seed: bigint;
  }): Promise<{
    events: BattleEvent[];
    attackerState: HeroState[];
    defenderState: HeroState[];
    terminated: boolean;
    winner?: 0 | 1 | 2;
  }>;
  /**
   * Persist the final report on-chain via Arena.challengeRelay. Optional — when
   * omitted the orchestrator runs purely off-chain (useful for local demos
   * with no RPC). Owned by `src/chain/*` + `src/onchainos/gateway.ts`.
   */
  submitOnchain?(args: {
    attacker: `0x${string}`;
    defender: `0x${string}`;
    events: BattleEvent[];
    winner: 0 | 1 | 2;
  }): Promise<{ txHash: `0x${string}`; battleId: `0x${string}` }>;
  /** Optional skill metadata for nicer rendering + commentary. */
  skillMeta?: Record<number, SkillMeta>;
}

export interface AiVsAiInput {
  agentA: {
    address: `0x${string}`;
    agent: DecisionAgent;
    label?: string;
  };
  agentB: {
    address: `0x${string}`;
    agent: DecisionAgent;
    label?: string;
  };
  caster?: Caster;
  /** Number of battles to run. Default 3 (matches demo spec). */
  battles?: number;
  /** Max rounds per battle (must match on-chain MAX_ROUNDS = 30). */
  maxRounds?: number;
  /** Optional sink that receives every string chunk as it's produced. Default is `console.log`. */
  emit?: (chunk: string) => void;
}

export interface AiVsAiResult {
  /** Final cumulative scoreboard (A wins / B wins / draws). */
  score: { aWins: number; bWins: number; draws: number };
  /** Per-battle reports. */
  reports: BattleReport[];
  /** Full markdown transcript (what the MCP tool returns to the caller). */
  markdown: string;
}

// ── The orchestrator ────────────────────────────────────────────────────────

// Ring-of-7: counters = next in cycle, weakTo = previous. Mirrors
// SectAffinity.sol so the LLM agent and the on-chain damage multiplier agree.
const SECT_CHART: AgentDecisionInput["sectChart"] = {
  [Sect.Shaolin]: { counters: Sect.Tangmen, weakTo: Sect.Ming },
  [Sect.Tangmen]: { counters: Sect.Emei,    weakTo: Sect.Shaolin },
  [Sect.Emei]:    { counters: Sect.Wudang,  weakTo: Sect.Tangmen },
  [Sect.Wudang]:  { counters: Sect.Beggars, weakTo: Sect.Emei },
  [Sect.Beggars]: { counters: Sect.Huashan, weakTo: Sect.Wudang },
  [Sect.Huashan]: { counters: Sect.Ming,    weakTo: Sect.Beggars },
  [Sect.Ming]:    { counters: Sect.Shaolin, weakTo: Sect.Huashan },
};

/**
 * Run one or more AI-vs-AI battles, streaming commentary + ASCII report to
 * the configured emit sink, and returning the aggregated outcome.
 *
 * The transcript is ALSO accumulated into `result.markdown` so the MCP tool
 * can return it as the tool's final payload even after everything streamed.
 */
export async function runAiVsAi(input: AiVsAiInput, deps: AiVsAiDeps): Promise<AiVsAiResult> {
  const battles = input.battles ?? 3;
  const maxRounds = input.maxRounds ?? 30;
  const transcript: string[] = [];
  const emit = (chunk: string) => {
    transcript.push(chunk);
    (input.emit ?? ((s: string) => process.stdout.write(s + "\n")))(chunk);
  };

  const score = { aWins: 0, bWins: 0, draws: 0 };
  const reports: BattleReport[] = [];

  emit(bold("════════════════════════════════════════════════════════════"));
  emit(bold(`  侠客擂台 · AI vs AI Demo  (${battles} 场)  `));
  emit(bold("════════════════════════════════════════════════════════════"));

  // Hydrate both teams once — they don't change between battles in the demo.
  const [teamA, teamB] = await Promise.all([
    deps.loadTeam(input.agentA.address),
    deps.loadTeam(input.agentB.address),
  ]);
  requireTeam(teamA, "agentA");
  requireTeam(teamB, "agentB");

  for (let battleIdx = 0; battleIdx < battles; battleIdx++) {
    emit("");
    emit(bold(`━━━ 第 ${battleIdx + 1} / ${battles} 场 ━━━`));
    const report = await runOneBattle({
      battleIdx,
      teamA,
      teamB,
      agentA: input.agentA,
      agentB: input.agentB,
      caster: input.caster,
      maxRounds,
      deps,
      emit,
    });
    reports.push(report);
    if (report.winner === 0) score.aWins++;
    else if (report.winner === 1) score.bWins++;
    else score.draws++;
  }

  emit("");
  emit(bold("════════════ 累计战绩 ════════════"));
  emit(`  ${labelFor(input.agentA)} ${healColor(String(score.aWins))} 胜`);
  emit(`  ${labelFor(input.agentB)} ${healColor(String(score.bWins))} 胜`);
  if (score.draws > 0) emit(`  平局 ${statusColor(String(score.draws))}`);
  const leader =
    score.aWins > score.bWins
      ? `${labelFor(input.agentA)} 技高一筹`
      : score.bWins > score.aWins
      ? `${labelFor(input.agentB)} 技高一筹`
      : "势均力敌";
  emit(bold(`  🏆 ${leader}`));
  emit(bold("════════════════════════════════════"));

  return { score, reports, markdown: transcript.join("\n") };
}

// ── one-battle loop ─────────────────────────────────────────────────────────

interface OneBattleCtx {
  battleIdx: number;
  teamA: Hero[];
  teamB: Hero[];
  agentA: AiVsAiInput["agentA"];
  agentB: AiVsAiInput["agentB"];
  caster?: Caster;
  maxRounds: number;
  deps: AiVsAiDeps;
  emit: (chunk: string) => void;
}

async function runOneBattle(ctx: OneBattleCtx): Promise<BattleReport> {
  const { teamA, teamB, agentA, agentB, caster, deps, emit, maxRounds } = ctx;

  // Initialise mutable HeroState for both sides.
  let stateA: HeroState[] = teamA.map((h) => initialHeroState(h));
  let stateB: HeroState[] = teamB.map((h) => initialHeroState(h));
  const allEvents: BattleEvent[] = [];
  let lastEventA: BattleEvent | null = null;
  let lastEventB: BattleEvent | null = null;
  let winner: 0 | 1 | 2 = 2;

  // Intro narration (streaming, optional).
  if (caster) {
    emit(faint("[说书人]"));
    for await (const chunk of caster.narrateIntro({
      attackerTeam: teamA,
      defenderTeam: teamB,
      attackerLabel: agentA.label,
      defenderLabel: agentB.label,
    })) {
      ctx.emit(chunk);
    }
    emit("");
  }

  let finalRound = 0;
  for (let round = 1; round <= maxRounds; round++) {
    finalRound = round;

    // Stop early if either side is wiped out.
    if (!stateA.some((h) => h.alive)) {
      winner = 1;
      break;
    }
    if (!stateB.some((h) => h.alive)) {
      winner = 0;
      break;
    }

    // Decision phase — run agents in parallel.
    const [moveA, moveB] = await Promise.all([
      agentA.agent.decide(buildAgentInput({ round, mySide: stateA, enemySide: stateB, lastEnemyAction: lastEventB })),
      agentB.agent.decide(buildAgentInput({ round, mySide: stateB, enemySide: stateA, lastEnemyAction: lastEventA })),
    ]);

    // Re-base indices into the global 0..5 space the simulator expects.
    const moveAGlobal: AgentDecisionOutput = { ...moveA }; // side A indices already 0..2 / 3..5
    const moveBGlobal: AgentDecisionOutput = { ...moveB, actorIdx: moveB.actorIdx + 3, targetIdx: remapTargetForB(moveB.targetIdx) };

    // Simulation phase — inject a deterministic seed per round so replay works.
    const seed = BigInt(ctx.battleIdx * 997 + round);
    const stepOut = await deps.simulateRound({
      round,
      attackerState: stateA,
      defenderState: stateB,
      attackerMove: moveAGlobal,
      defenderMove: moveBGlobal,
      seed,
    });
    stateA = stepOut.attackerState;
    stateB = stepOut.defenderState;
    allEvents.push(...stepOut.events);

    // Remember the last event each side made, for the other's context.
    for (const ev of stepOut.events) {
      if (ev.actorIdx < 3) lastEventA = ev;
      else lastEventB = ev;
    }

    // ASCII render of this round.
    emit(renderRoundSection(round, stepOut.events, [...teamA, ...teamB], deps.skillMeta));
    emit(renderLiveHpStrip(teamA, teamB, buildHpMap(stateA, stateB)));

    // Commentary streaming.
    if (caster) {
      emit(faint("[说书人]"));
      const trashTalk = [
        { actorIdx: moveAGlobal.actorIdx, text: moveA.trashTalk },
        { actorIdx: moveBGlobal.actorIdx, text: moveB.trashTalk },
      ].filter((t) => t.text && t.text.length > 0);
      for await (const chunk of caster.narrateRound({
        round,
        events: stepOut.events,
        heroes: [...teamA, ...teamB],
        trashTalk,
        isFinalRound: stepOut.terminated,
        winner: stepOut.winner,
      })) {
        ctx.emit(chunk);
      }
      emit("");
    }

    if (stepOut.terminated) {
      winner = stepOut.winner ?? winner;
      break;
    }
  }

  // Submit to chain if wired up.
  let txHash: `0x${string}` | undefined;
  let battleId: `0x${string}` = ("0x" + "0".repeat(64)) as `0x${string}`;
  if (ctx.deps.submitOnchain) {
    try {
      const onchain = await ctx.deps.submitOnchain({
        attacker: ctx.agentA.address,
        defender: ctx.agentB.address,
        events: allEvents,
        winner,
      });
      txHash = onchain.txHash;
      battleId = onchain.battleId;
      emit(faint(`[链上存证] tx=${txHash}`));
    } catch (err) {
      emit(critColor(`[链上存证失败] ${(err as Error).message}`));
    }
  }

  const report: BattleReport = {
    battleId,
    attacker: ctx.agentA.address,
    defender: ctx.agentB.address,
    winner,
    timestamp: Math.floor(Date.now() / 1000),
    attackerTeam: teamA,
    defenderTeam: teamB,
    events: allEvents,
    txHash,
  };

  // Final ASCII report footer (reuses the standard renderer).
  emit(
    Array.from(
      renderBattleReportStream(report, { skillMeta: ctx.deps.skillMeta, explorerBase: "https://sepolia.basescan.org" }),
    ).join("\n"),
  );

  // Closing narration.
  if (ctx.caster) {
    emit(faint("[说书人]"));
    for await (const chunk of ctx.caster.narrateClosing({
      winner,
      attackerTeam: teamA,
      defenderTeam: teamB,
      totalRounds: finalRound,
    })) {
      ctx.emit(chunk);
    }
    emit("");
  }

  return report;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function initialHeroState(h: Hero): HeroState {
  return {
    hero: h,
    currentHp: h.hp,
    buffs: [],
    alive: true,
  };
}

function buildAgentInput(args: {
  round: number;
  mySide: HeroState[];
  enemySide: HeroState[];
  lastEnemyAction: BattleEvent | null;
}): AgentDecisionInput {
  return {
    round: args.round,
    mySide: args.mySide,
    enemySide: args.enemySide,
    lastEnemyAction: args.lastEnemyAction,
    sectChart: SECT_CHART,
  };
}

/**
 * Agent B sees the world from its own perspective (its units at 0..2, enemy
 * at 3..5). When we parsed B's target we left it in B's local frame; here we
 * flip indices so the global simulator gets the right global index.
 *
 * Local 0..2 (B's allies) → global 3..5
 * Local 3..5 (B's enemies, i.e. A's units) → global 0..2
 */
function remapTargetForB(localIdx: number): number {
  if (localIdx >= 0 && localIdx <= 2) return localIdx + 3;
  if (localIdx >= 3 && localIdx <= 5) return localIdx - 3;
  return 0;
}

function buildHpMap(stateA: HeroState[], stateB: HeroState[]): Record<number, number> {
  const out: Record<number, number> = {};
  stateA.forEach((s, i) => (out[i] = s.currentHp));
  stateB.forEach((s, i) => (out[i + 3] = s.currentHp));
  return out;
}

function renderRoundSection(
  round: number,
  events: BattleEvent[],
  heroes: Hero[],
  skillMeta?: Record<number, SkillMeta>,
): string {
  // Lean on the existing streaming renderer by re-using its round header +
  // event formatters. We can't import the private helpers directly, so we
  // assemble a tiny inline snippet here.
  const header = bold(`⚔️  Round ${round}`);
  const divider = "━".repeat(40);
  const lines = [header, divider];
  for (const ev of events) {
    const actor = heroes[ev.actorIdx];
    const target = heroes[ev.targetIdx];
    if (!actor || !target) continue;
    const skillName = skillMeta?.[ev.skillId]?.name ?? `技能#${ev.skillId}`;
    const dmg = ev.hpDelta === 0 ? "" : ev.hpDelta < 0 ? `  ${critColor(`(${ev.hpDelta})`)}` : `  ${healColor(`(+${ev.hpDelta})`)}`;
    const killTag = hasFlag(ev.flags, FLAG_KILL) ? "  💀" : "";
    const tgt = ev.actorIdx === ev.targetIdx ? "自身" : `${SECT_NAMES[target.sect]}·${target.name}`;
    lines.push(`  ${SECT_NAMES[actor.sect]}·${actor.name}  →  ${skillName}  →  ${tgt}${dmg}${killTag}`);
  }
  return lines.join("\n");
}

function requireTeam(team: Hero[], label: string): void {
  if (team.length !== 3) {
    throw new Error(`${label} defense team must have exactly 3 heroes (got ${team.length}). Did you forget setDefenseTeam?`);
  }
}

function labelFor(a: { label?: string; address: `0x${string}` }): string {
  return a.label ?? `${a.address.slice(0, 6)}…${a.address.slice(-4)}`;
}
