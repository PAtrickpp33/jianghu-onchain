// Tool: xiake_start_pve
// PVE battle. In mock mode, uses offline simulator.
// In on-chain mode, sends Arena.startPve via OnchainOS gateway.

import { z } from "zod";
import { guard } from "./_util.js";
import {
  getCurrentPlayer,
  cacheReport,
  setLastBattleId,
  getHeroCache,
} from "../state/cache.js";
import { renderBattleReport } from "../render/battleReport.js";
import { PVE_STAGES, renderStageList, renderMainMenu, type GameMenuState } from "../render/gameMenu.js";
import {
  Sect,
  SkillKind,
  type Hero,
  type HeroState,
  type BattleEvent,
  type BattleReport,
  FLAG_CRIT,
  FLAG_KILL,
} from "../types.js";

export const inputSchema = z
  .object({
    stageId: z.number().int().min(1).max(3).default(1),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_start_pve",
  description:
    "挑战 PVE 关卡。stageId: 1=少林藏经阁(简单), 2=唐门密室(普通), 3=峨眉金顶(普通)。不传参默认第1关。",
  inputSchema: {
    type: "object",
    properties: {
      stageId: {
        type: "integer",
        minimum: 1,
        maximum: 3,
        default: 1,
        description: "关卡编号。1=少林藏经阁, 2=唐门密室, 3=峨眉金顶",
      },
    },
    additionalProperties: false,
  },
} as const;

function isMockMode(): boolean {
  return !process.env.XIAKE_ARENA_ADDRESS || !process.env.XIAKE_HERO_ADDRESS;
}

// PVE boss teams for each stage
const BOSS_TEAMS: Record<number, Hero[]> = {
  1: [
    { tokenId: 901n, sect: Sect.Shaolin, name: "玄苦", hp: 180, atk: 70, def: 90, spd: 50, crit: 400, skillIds: [0, 1, 2] },
    { tokenId: 902n, sect: Sect.Shaolin, name: "空见", hp: 170, atk: 65, def: 95, spd: 45, crit: 300, skillIds: [1, 0, 2] },
    { tokenId: 903n, sect: Sect.Shaolin, name: "渡劫", hp: 160, atk: 75, def: 85, spd: 55, crit: 500, skillIds: [2, 0, 1] },
  ],
  2: [
    { tokenId: 904n, sect: Sect.Tangmen, name: "飞燕", hp: 100, atk: 95, def: 50, spd: 90, crit: 1500, skillIds: [3, 4, 5] },
    { tokenId: 905n, sect: Sect.Tangmen, name: "夜鸮", hp: 95, atk: 100, def: 45, spd: 95, crit: 2000, skillIds: [4, 3, 5] },
    { tokenId: 906n, sect: Sect.Tangmen, name: "柳如烟", hp: 105, atk: 88, def: 52, spd: 88, crit: 1600, skillIds: [5, 3, 4] },
  ],
  3: [
    { tokenId: 907n, sect: Sect.Emei, name: "灭绝", hp: 120, atk: 80, def: 65, spd: 75, crit: 1200, skillIds: [8, 6, 7] },
    { tokenId: 908n, sect: Sect.Emei, name: "风陵", hp: 125, atk: 72, def: 68, spd: 82, crit: 1000, skillIds: [6, 8, 7] },
    { tokenId: 909n, sect: Sect.Emei, name: "周芷若", hp: 115, atk: 85, def: 60, spd: 78, crit: 1400, skillIds: [8, 7, 6] },
  ],
};

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw ?? {});
    const stageId = input.stageId;
    const stage = PVE_STAGES.find(s => s.id === stageId);
    if (!stage) throw new Error(`关卡 ${stageId} 不存在。可选: 1, 2, 3`);

    const mock = isMockMode();

    if (mock) {
      return runMockPve(stageId, stage.name);
    } else {
      return runOnChainPve(stageId, stage.name);
    }
  });
}

// ── Mock PVE ────────────────────────────────────────────────────────────────

async function runMockPve(stageId: number, stageName: string): Promise<string> {
  const heroCache = getHeroCache();
  const playerTeam = [...heroCache.values()].slice(0, 3);
  if (playerTeam.length < 3) {
    throw new Error("你至少需要 3 位侠客才能出战,请先「招募侠客」(xiake_mint_hero)。");
  }

  const bossTeam = BOSS_TEAMS[stageId] ?? BOSS_TEAMS[1]!;

  // Run offline simulation
  const report = simulateFullBattle(playerTeam, bossTeam, BigInt(Date.now()));
  const battleId = `0x${Date.now().toString(16).padStart(64, "0")}` as `0x${string}`;

  const fullReport: BattleReport = {
    battleId,
    attacker: "0x000000000000000000000000000000000000A001",
    defender: "0x0000000000000000000000000000000000BOSS01",
    winner: report.winner,
    timestamp: Math.floor(Date.now() / 1000),
    attackerTeam: playerTeam,
    defenderTeam: bossTeam,
    events: report.events,
  };

  cacheReport(fullReport);
  setLastBattleId(battleId);

  const result = renderBattleReport(fullReport, {
    title: `⚔️ PVE 第 ${stageId} 关: ${stageName}`,
    youSide: 0,
  });

  // Append narration hint + next steps
  const menuState: GameMenuState = {
    heroes: playerTeam,
    hasDefenseTeam: false,
    mode: "mock",
  };

  return result +
    "\n\n---\n" +
    "📜 **请用金庸说书人风格解说这场战斗,重点描述关键回合的招式交锋、转折点和最终结局。**\n\n" +
    renderMainMenu(menuState);
}

// ── On-chain PVE (original logic) ───────────────────────────────────────────

async function runOnChainPve(stageId: number, stageName: string): Promise<string> {
  const { encodeFunctionData, decodeEventLog } = await import("viem");
  const { arenaAbi } = await import("../chain/abi.js");
  const { getAddresses, txUrl, getPublicClient } = await import("../chain/client.js");
  const { signAndSend } = await import("../onchainos/gateway.js");
  const { fetchOwnedHeroIds, fetchHeroes, fetchBattleReport } = await import("../chain/reads.js");
  const { cacheHeroes } = await import("../state/cache.js");

  const playerObj = getCurrentPlayer();
  if (!playerObj) throw new Error("请先调用 xiake_init 进入游戏。");
  const player = playerObj.address;

  const owned = await fetchOwnedHeroIds(player);
  if (owned.length < 3) throw new Error("你至少需要 3 位侠客。先调用 xiake_mint_hero。");
  const team: [bigint, bigint, bigint] = [owned[0]!, owned[1]!, owned[2]!];

  const { arena } = getAddresses();
  const data = encodeFunctionData({
    abi: arenaAbi,
    functionName: "startPve",
    args: [team, stageId],
  });

  const { txHash } = await signAndSend({ to: arena, data, from: player });
  const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });

  // Extract battleId from event
  let battleId: `0x${string}` = "0x0";
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== arena.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "BattleSettled") {
        battleId = (decoded.args as { battleId: `0x${string}` }).battleId;
      }
    } catch { /* skip */ }
  }

  const attackerTeam = await fetchHeroes([...team]);
  cacheHeroes(attackerTeam);
  const report = await fetchBattleReport(battleId, { attackerTeam, defenderTeam: [] }, txHash);
  cacheReport(report);
  setLastBattleId(battleId);

  return renderBattleReport(report, {
    title: `⚔️ PVE 第 ${stageId} 关: ${stageName}`,
    txUrl: txUrl(txHash),
    youSide: 0,
  });
}

// ── Offline battle simulation ───────────────────────────────────────────────

const SKILL_EFFECT: Record<number, { kind: SkillKind; multBps: number; aoe: boolean; heal: number }> = {
  0: { kind: SkillKind.Buff, multBps: 0, aoe: false, heal: 0 },
  1: { kind: SkillKind.Heal, multBps: 0, aoe: false, heal: 30 },
  2: { kind: SkillKind.Control, multBps: 0, aoe: true, heal: 0 },
  3: { kind: SkillKind.Damage, multBps: 15000, aoe: false, heal: 0 },
  4: { kind: SkillKind.Damage, multBps: 8000, aoe: true, heal: 0 },
  5: { kind: SkillKind.Dot, multBps: 1000, aoe: false, heal: 0 },
  6: { kind: SkillKind.Heal, multBps: 0, aoe: true, heal: 20 },
  7: { kind: SkillKind.Control, multBps: 0, aoe: false, heal: 0 },
  8: { kind: SkillKind.Damage, multBps: 12000, aoe: false, heal: 0 },
};

function simulateFullBattle(
  teamA: Hero[],
  teamB: Hero[],
  seed: bigint,
): { winner: 0 | 1 | 2; events: BattleEvent[] } {
  const aState: HeroState[] = teamA.map(h => ({ hero: h, currentHp: h.hp, buffs: [], alive: true }));
  const bState: HeroState[] = teamB.map(h => ({ hero: h, currentHp: h.hp, buffs: [], alive: true }));
  const events: BattleEvent[] = [];

  let s = Number(seed & 0xFFFFFFFFn) || 1;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

  for (let round = 1; round <= 30; round++) {
    // Build turn order: all alive heroes sorted by SPD desc
    const turns: Array<{ side: "A" | "B"; idx: number; hero: Hero; state: HeroState }> = [];
    aState.forEach((st, i) => { if (st.alive) turns.push({ side: "A", idx: i, hero: st.hero, state: st }); });
    bState.forEach((st, i) => { if (st.alive) turns.push({ side: "B", idx: i, hero: st.hero, state: st }); });
    turns.sort((a, b) => b.hero.spd - a.hero.spd);

    for (const turn of turns) {
      if (!turn.state.alive) continue;
      // Silenced? skip
      if (turn.state.buffs.some(b => b.kind === SkillKind.Control && b.roundsLeft > 0)) continue;

      const mine = turn.side === "A" ? aState : bState;
      const theirs = turn.side === "A" ? bState : aState;
      const globalActor = turn.side === "A" ? turn.idx : turn.idx + 3;

      // Simple AI: pick skill based on situation
      const skillId = pickSkill(turn.state, mine, theirs, rng);
      const effect = SKILL_EFFECT[skillId];
      if (!effect) continue;

      if (effect.kind === SkillKind.Damage) {
        const targets = effect.aoe ? theirs.filter(t => t.alive) : [lowestHp(theirs)].filter(Boolean);
        for (const t of targets) {
          if (!t) continue;
          const gi = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          const base = Math.floor((turn.hero.atk * effect.multBps) / 10000);
          const dmg0 = Math.max(1, base - Math.floor(t.hero.def / 2));
          const isCrit = rng() * 10000 < turn.hero.crit;
          const dmg = isCrit ? Math.floor(dmg0 * 1.5) : dmg0;
          t.currentHp = Math.max(0, t.currentHp - dmg);
          let flags = isCrit ? FLAG_CRIT : 0;
          if (t.currentHp === 0) { t.alive = false; flags |= FLAG_KILL; }
          events.push({ round, actorIdx: globalActor, skillId, targetIdx: gi, hpDelta: -dmg, flags });
        }
      } else if (effect.kind === SkillKind.Heal) {
        const targets = effect.aoe ? mine.filter(t => t.alive) : [lowestHp(mine)].filter(Boolean);
        for (const t of targets) {
          if (!t) continue;
          const gi = (turn.side === "A" ? 0 : 3) + mine.indexOf(t);
          const healed = Math.min(effect.heal, t.hero.hp - t.currentHp);
          t.currentHp += healed;
          events.push({ round, actorIdx: globalActor, skillId, targetIdx: gi, hpDelta: healed, flags: 0 });
        }
      } else if (effect.kind === SkillKind.Buff) {
        turn.state.buffs.push({ kind: SkillKind.Buff, value: 30, roundsLeft: 2 });
        events.push({ round, actorIdx: globalActor, skillId, targetIdx: globalActor, hpDelta: 0, flags: 0 });
      } else if (effect.kind === SkillKind.Control) {
        const target = highestAtk(theirs);
        if (target) {
          const gi = (turn.side === "A" ? 3 : 0) + theirs.indexOf(target);
          target.buffs.push({ kind: SkillKind.Control, value: 0, roundsLeft: 1 });
          events.push({ round, actorIdx: globalActor, skillId, targetIdx: gi, hpDelta: 0, flags: 0 });
        }
      } else if (effect.kind === SkillKind.Dot) {
        const target = lowestHp(theirs);
        if (target) {
          const gi = (turn.side === "A" ? 3 : 0) + theirs.indexOf(target);
          const tick = Math.max(1, Math.floor(target.hero.hp * 0.1));
          target.buffs.push({ kind: SkillKind.Dot, value: tick, roundsLeft: 3 });
          events.push({ round, actorIdx: globalActor, skillId, targetIdx: gi, hpDelta: 0, flags: 0 });
        }
      }
    }

    // Tick buffs
    [...aState, ...bState].forEach(h => {
      // Apply DoT damage
      h.buffs.filter(b => b.kind === SkillKind.Dot && b.roundsLeft > 0).forEach(b => {
        if (!h.alive) return;
        h.currentHp = Math.max(0, h.currentHp - b.value);
        if (h.currentHp === 0) h.alive = false;
      });
      h.buffs = h.buffs.map(b => ({ ...b, roundsLeft: b.roundsLeft - 1 })).filter(b => b.roundsLeft > 0);
    });

    // Check termination
    const aAlive = aState.some(h => h.alive);
    const bAlive = bState.some(h => h.alive);
    if (!aAlive && !bAlive) return { winner: 2, events };
    if (!aAlive) return { winner: 1, events };
    if (!bAlive) return { winner: 0, events };
  }

  // Timeout: compare total HP
  const aHp = aState.reduce((s, h) => s + h.currentHp, 0);
  const bHp = bState.reduce((s, h) => s + h.currentHp, 0);
  return { winner: aHp >= bHp ? 0 : 1, events };
}

function pickSkill(actor: HeroState, mine: HeroState[], theirs: HeroState[], rng: () => number): number {
  const skills = actor.hero.skillIds;
  // Heal if any ally < 40% HP
  const wounded = mine.find(h => h.alive && h.currentHp < h.hero.hp * 0.4);
  const healSkill = skills.find(s => SKILL_EFFECT[s]?.kind === SkillKind.Heal);
  if (wounded && healSkill !== undefined) return healSkill;
  // AoE if 2+ enemies
  const aliveEnemies = theirs.filter(h => h.alive).length;
  const aoeSkill = skills.find(s => SKILL_EFFECT[s]?.kind === SkillKind.Damage && SKILL_EFFECT[s]?.aoe);
  if (aliveEnemies >= 2 && aoeSkill !== undefined && rng() > 0.4) return aoeSkill;
  // Default: first damage/dot skill, fallback to first skill
  return skills.find(s => {
    const k = SKILL_EFFECT[s]?.kind;
    return k === SkillKind.Damage || k === SkillKind.Dot;
  }) ?? skills[0];
}

function lowestHp(team: HeroState[]): HeroState | undefined {
  return team.filter(h => h.alive).sort((a, b) => a.currentHp - b.currentHp)[0];
}

function highestAtk(team: HeroState[]): HeroState | undefined {
  return team.filter(h => h.alive).sort((a, b) => b.hero.atk - a.hero.atk)[0];
}
