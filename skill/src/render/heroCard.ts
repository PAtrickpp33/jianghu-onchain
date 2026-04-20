// Render a single Hero as an ASCII "character sheet" card.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §5.1
//
// Output shape (6 lines, fixed width):
//
//   ┌─────────────────────────────────────────┐
//   │ 🥋 少林·圆智  Lv.1  #1234              │
//   │ HP ████████░░ 150/200                   │
//   │ ATK  80  │ DEF  95  │ SPD  60  │ CRT 5%│
//   │ 技能: 金钟罩 · 易筋经 · 狮子吼         │
//   └─────────────────────────────────────────┘

import { hpBar, padRight, visibleWidth, faint, bold } from "./ansi.js";
import { Sect, SECT_NAMES, type Hero } from "../types.js";

/** Inner-width (excluding the side │ borders) of a hero card. */
const CARD_INNER_WIDTH = 44;

/** Emoji prefix for each sect, used in the title line. Local override of the
 *  shared SECT_ICON map because the card uses 🌸 for Emei (more serene)
 *  instead of the menu's ⛩️.
 */
const SECT_ICON: Record<Sect, string> = {
  [Sect.Shaolin]: "🥋",
  [Sect.Tangmen]: "🗡️",
  [Sect.Emei]:    "🌸",
  [Sect.Wudang]:  "☯️",
  [Sect.Beggars]: "🥖",
  [Sect.Huashan]: "⚔️",
  [Sect.Ming]:    "🔥",
};

/**
 * Optional overrides — callers can pass a skill-id → display-name lookup, a
 * current-HP override (for live battle cards), and an alternative nickname.
 */
export interface HeroCardOptions {
  /** If provided, maps skill id → display name for the 技能 line. */
  skillNameById?: Record<number, string>;
  /**
   * Current HP to display. Falls back to the hero's max HP (for "at rest"
   * cards like in `xiake_list_heroes`).
   */
  currentHp?: number;
  /** Display name override (nickname, boss title, …). Defaults to `hero.name`. */
  displayName?: string;
  /** Level line suffix, e.g. "Lv.1". Defaults to "Lv.1" since we don't track levels on-chain. */
  level?: string;
}

/**
 * Render `hero` as a multi-line string ready to `console.log`. Handles CJK
 * width padding so the right border always lines up.
 */
export function renderHeroCard(hero: Hero, opts: HeroCardOptions = {}): string {
  const icon = SECT_ICON[hero.sect] ?? "🀄";
  const sectName = SECT_NAMES[hero.sect] ?? "无门";
  const displayName = opts.displayName ?? hero.name;
  const level = opts.level ?? "Lv.1";
  const tokenId = `#${hero.tokenId.toString()}`;
  const currentHp = opts.currentHp ?? hero.hp;

  const titleLine = `${icon} ${sectName}·${displayName}  ${level}  ${tokenId}`;
  const hpLine = `HP ${hpBar(currentHp, hero.hp, 10)} ${currentHp}/${hero.hp}`;
  const critPct = (hero.crit / 100).toFixed(0); // 0..10000 bps → 0..100%
  const statsLine = `ATK ${padStat(hero.atk)} ${faint("│")} DEF ${padStat(hero.def)} ${faint("│")} SPD ${padStat(hero.spd)} ${faint("│")} CRT ${critPct}%`;
  const skillsLine = `技能: ${formatSkills(hero.skillIds, opts.skillNameById)}`;

  return [
    topBorder(CARD_INNER_WIDTH),
    wrapLine(bold(titleLine), CARD_INNER_WIDTH),
    wrapLine(hpLine, CARD_INNER_WIDTH),
    wrapLine(statsLine, CARD_INNER_WIDTH),
    wrapLine(skillsLine, CARD_INNER_WIDTH),
    bottomBorder(CARD_INNER_WIDTH),
  ].join("\n");
}

/**
 * Convenience: render multiple heroes side-by-side into a single block when
 * the terminal is wide enough, otherwise stack them vertically.
 */
export function renderHeroRoster(heroes: Hero[], opts: HeroCardOptions = {}): string {
  if (heroes.length === 0) return faint("(未招募侠客)");
  return heroes.map((h) => renderHeroCard(h, opts)).join("\n");
}

// ── helpers ─────────────────────────────────────────────────────────────────

function padStat(n: number): string {
  return String(n).padStart(3, " ");
}

function formatSkills(ids: number[], lookup?: Record<number, string>): string {
  if (ids.length === 0) return faint("(无)");
  return ids.map((id) => lookup?.[id] ?? `#${id}`).join(" · ");
}

function topBorder(inner: number): string {
  return "┌" + "─".repeat(inner) + "┐";
}

function bottomBorder(inner: number): string {
  return "└" + "─".repeat(inner) + "┘";
}

/**
 * Wrap `content` between │ borders, padding to `inner` visible width. We add
 * one space of left padding to match the spec's indentation.
 */
function wrapLine(content: string, inner: number): string {
  const padded = padRight(` ${content}`, inner);
  // If content was too wide, truncate (keeps the border aligned). Truncation
  // should be rare — our names max at ~6 chars + sect prefix.
  const w = visibleWidth(padded);
  const safe = w > inner ? hardTruncate(padded, inner) : padded;
  return `│${safe}│`;
}

function hardTruncate(s: string, targetWidth: number): string {
  let acc = "";
  let w = 0;
  for (const ch of s) {
    const chW = visibleWidth(ch);
    if (w + chW > targetWidth) break;
    acc += ch;
    w += chW;
  }
  // Pad remainder in case CJK char boundary left us short by 1.
  while (w < targetWidth) {
    acc += " ";
    w += 1;
  }
  return acc;
}
