// Streaming-friendly ASCII renderer for a BattleReport.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §5.2
//
// The renderer is built around two reusable primitives:
//
//   renderRoundHeader(round)                      -- "⚔️  江湖论剑 · Round N"
//   renderEvent(event, teamA, teamB, skillNames)  -- one "actor → skill → target" line
//
// plus a high-level `renderBattleReport(...)` that emits a complete report.
//
// `*Stream` variants are async-iterables so the `xiake_ai_vs_ai` orchestrator
// can flush output round-by-round while a caster agent is still talking. We
// deliberately avoid any state in this module — each call is a pure function
// of its arguments.

import {
  crit as crColor,
  heal as healColor,
  control as ctrlColor,
  status as statusColor,
  link as linkColor,
  bold,
  faint,
  hpBar,
} from "./ansi.js";
import {
  FLAG_CRIT,
  FLAG_KILL,
  FLAG_MISS,
  SECT_NAMES,
  SkillKind,
  hasFlag,
  type BattleEvent,
  type BattleReport,
  type Hero,
} from "../types.js";

/** Metadata the renderer needs about a skill — supplied by the caller. */
export interface SkillMeta {
  id: number;
  name: string;
  kind: SkillKind;
}

export interface RenderBattleReportOptions {
  /** Skill id → metadata. Missing ids are rendered as `技能#<id>`. */
  skillMeta?: Record<number, SkillMeta>;
  /** 0 = attacker is "you", 1 = defender is "you". Controls the 🏆 footer. */
  youSide?: 0 | 1;
  /** Optional Base-scan URL prefix for the tx link. */
  explorerBase?: string;
  /** Optional title override shown above the report header. */
  title?: string;
  /** Optional tx URL shown in the footer. */
  txUrl?: string;
}

const DIVIDER = "━".repeat(40);

/**
 * Render a full BattleReport end-to-end as a single string. Suitable for
 * `console.log` or for returning from an MCP tool (as markdown-ish text).
 */
export function renderBattleReport(
  report: BattleReport,
  opts: RenderBattleReportOptions = {},
): string {
  return Array.from(renderBattleReportStream(report, opts)).join("\n");
}

/**
 * Yields the report line-by-line (actually round-by-round, so each `yield` is
 * multiple lines joined by `\n`). The `caster` orchestrator zips this stream
 * with the LLM-generated commentary.
 */
export function* renderBattleReportStream(
  report: BattleReport,
  opts: RenderBattleReportOptions = {},
): Generator<string> {
  const all = [...report.attackerTeam, ...report.defenderTeam];
  const hpState = new Map<number, number>();
  for (let i = 0; i < all.length; i++) hpState.set(i, all[i].hp);

  yield renderHeader(report);

  const byRound = groupByRound(report.events);
  for (const [round, events] of byRound) {
    yield renderRoundHeader(round);
    for (const ev of events) {
      const actor = all[ev.actorIdx];
      const target = all[ev.targetIdx];
      if (!actor || !target) continue;
      // Update HP tracking so we can print "HP 150 → 105".
      const beforeHp = hpState.get(ev.targetIdx) ?? target.hp;
      const afterHp = Math.max(0, Math.min(target.hp, beforeHp + ev.hpDelta));
      hpState.set(ev.targetIdx, afterHp);
      yield renderEvent(ev, actor, target, beforeHp, afterHp, opts.skillMeta);
    }
    yield ""; // blank line between rounds for breathing room
  }

  yield renderFooter(report, opts);
}

/** `⚔️  江湖论剑 · Round N` */
export function renderRoundHeader(round: number): string {
  return `${bold(`⚔️  江湖论剑 · Round ${round}`)}\n${DIVIDER}`;
}

/**
 * Render a single action + damage-delta line (2 lines):
 *
 *   🗡️  唐门·飞燕  →  穿心刺
 *       └─→ 少林·圆智  HP 150 → 105  (-45)  💥 暴击!
 */
export function renderEvent(
  ev: BattleEvent,
  actor: Hero,
  target: Hero,
  beforeHp: number,
  afterHp: number,
  skillMeta?: Record<number, SkillMeta>,
): string {
  const skill = skillMeta?.[ev.skillId];
  const skillName = skill?.name ?? `技能#${ev.skillId}`;
  const skillKind = skill?.kind;

  const actorIcon = actorKindIcon(skillKind, ev.flags);
  const actorLabel = heroLabel(actor);
  const targetLabel = ev.actorIdx === ev.targetIdx ? "自身" : heroLabel(target);
  const isSelfTarget = ev.actorIdx === ev.targetIdx;

  const head = `${actorIcon}  ${actorLabel}  →  ${colorizeSkill(skillName, skillKind, ev.flags)}`;

  if (hasFlag(ev.flags, FLAG_MISS)) {
    return [head, `    └─→ ${targetLabel}  ${faint("未命中")}  ${statusColor("✦ MISS")}`].join("\n");
  }

  const deltaStr = renderDelta(ev.hpDelta);
  const hpStr = isSelfTarget && skillKind === SkillKind.Buff
    ? buffSummary(skillName) // no HP change for pure buffs
    : `HP ${beforeHp} → ${afterHp}  ${deltaStr}`;
  const suffix = eventSuffix(ev.flags);

  return [head, `    └─→ ${targetLabel}  ${hpStr}${suffix ? "  " + suffix : ""}`].join("\n");
}

// ── report sections ─────────────────────────────────────────────────────────

function renderHeader(report: BattleReport): string {
  const when = new Date(report.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
  const atk = formatTeam(report.attackerTeam);
  const def = formatTeam(report.defenderTeam);
  return [
    bold("🏯 侠客擂台 · 战报"),
    faint(`battleId: ${report.battleId}  ${when} UTC`),
    `${bold("Attacker")} ${shortAddr(report.attacker)}  ${atk}`,
    `${bold("Defender")} ${shortAddr(report.defender)}  ${def}`,
    "",
  ].join("\n");
}

function renderFooter(report: BattleReport, opts: RenderBattleReportOptions): string {
  const lines: string[] = [DIVIDER];
  const winnerLine = renderWinnerLine(report.winner, opts.youSide);
  lines.push(winnerLine);

  const totalRounds = report.events.length === 0 ? 0 : report.events[report.events.length - 1].round;
  lines.push(`⏱️  总计 ${totalRounds} 回合`);

  if (report.winner !== 2) {
    lines.push(`💰 江湖声望 ${report.winner === 0 ? "+25" : "-10"}`);
  }

  if (report.txHash) {
    const base = opts.explorerBase ?? "https://sepolia.basescan.org";
    lines.push(`🔗 tx: ${linkColor(`${base}/tx/${report.txHash}`)}`);
  }
  return lines.join("\n");
}

function renderWinnerLine(winner: 0 | 1 | 2, youSide?: 0 | 1): string {
  if (winner === 2) return `🤝 ${statusColor("平局")}`;
  if (youSide === undefined) return `🏆 胜者: ${winner === 0 ? "attacker" : "defender"}`;
  const youWon = youSide === winner;
  return youWon
    ? `🏆 胜者: ${healColor("你")} (${winner === 0 ? "attacker" : "defender"})`
    : `💀 败者: ${crColor("你")} (${youSide === 0 ? "attacker" : "defender"})`;
}

// ── formatting helpers ─────────────────────────────────────────────────────

function groupByRound(events: BattleEvent[]): Array<[number, BattleEvent[]]> {
  const map = new Map<number, BattleEvent[]>();
  for (const ev of events) {
    const arr = map.get(ev.round) ?? [];
    arr.push(ev);
    map.set(ev.round, arr);
  }
  return [...map.entries()].sort(([a], [b]) => a - b);
}

function actorKindIcon(kind: SkillKind | undefined, flags: number): string {
  if (hasFlag(flags, FLAG_MISS)) return "💨";
  switch (kind) {
    case SkillKind.Heal:
      return "💚";
    case SkillKind.Buff:
      return "🛡️";
    case SkillKind.Control:
      return "🔗";
    case SkillKind.Dot:
      return "☠️";
    case SkillKind.Damage:
    default:
      return "🗡️";
  }
}

function colorizeSkill(name: string, kind: SkillKind | undefined, flags: number): string {
  if (hasFlag(flags, FLAG_CRIT)) return crColor(name);
  switch (kind) {
    case SkillKind.Heal:
      return healColor(name);
    case SkillKind.Control:
      return ctrlColor(name);
    case SkillKind.Buff:
      return statusColor(name);
    default:
      return name;
  }
}

function renderDelta(hpDelta: number): string {
  if (hpDelta === 0) return faint("(±0)");
  if (hpDelta > 0) return healColor(`(+${hpDelta})`);
  return crColor(`(${hpDelta})`);
}

function eventSuffix(flags: number): string {
  const parts: string[] = [];
  if (hasFlag(flags, FLAG_CRIT)) parts.push(crColor("💥 暴击!"));
  if (hasFlag(flags, FLAG_KILL)) parts.push(crColor("💀 击杀!"));
  return parts.join("  ");
}

function buffSummary(skillName: string): string {
  return statusColor(`施加 ${skillName} 🛡️`);
}

function heroLabel(h: Hero): string {
  return `${SECT_NAMES[h.sect]}·${h.name}`;
}

function formatTeam(team: Hero[]): string {
  if (team.length === 0) return faint("(空)");
  return team.map(heroLabel).join(" · ");
}

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Render a compact "live" status strip showing HP bars for both teams —
 * used between rounds by the live streaming renderer in aiVsAi.
 */
export function renderLiveHpStrip(
  attackerTeam: Hero[],
  defenderTeam: Hero[],
  hpByIdx: Record<number, number>,
): string {
  const lines: string[] = [];
  lines.push(faint("── 场上状态 ─────────────────────────────"));
  for (let i = 0; i < attackerTeam.length; i++) {
    const h = attackerTeam[i];
    const cur = hpByIdx[i] ?? h.hp;
    lines.push(`  A${i + 1} ${heroLabel(h).padEnd(8)} ${hpBar(cur, h.hp)} ${cur}/${h.hp}`);
  }
  for (let i = 0; i < defenderTeam.length; i++) {
    const h = defenderTeam[i];
    const idx = 3 + i;
    const cur = hpByIdx[idx] ?? h.hp;
    lines.push(`  B${i + 1} ${heroLabel(h).padEnd(8)} ${hpBar(cur, h.hp)} ${cur}/${h.hp}`);
  }
  return lines.join("\n");
}
