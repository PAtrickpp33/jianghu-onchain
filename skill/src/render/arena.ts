// ASCII renderer for the "擂台" (PVP opponent list).
//
// Consumed by the `xiake_list_arena` tool. Returns a markdown-friendly table
// so it looks reasonable both in a TTY (with ANSI colors) and when piped to a
// non-interactive client like an MCP agent log.

import { padRight, padLeft, bold, faint, status, link } from "./ansi.js";

export interface ArenaEntry {
  /** Rank is 1-based. */
  rank: number;
  address: `0x${string}`;
  /** Optional player nickname. */
  nickname?: string;
  /** Aggregate power (HP + ATK*3 + DEF*2 + SPD, summed across team). */
  power: number;
  /** Win count if known. */
  wins?: number;
  /** Loss count if known. */
  losses?: number;
  /** True when this row is the caller — highlighted differently. */
  isSelf?: boolean;
}

export interface RenderArenaOptions {
  /** Optional title override, defaults to "擂台群雄榜". */
  title?: string;
  /** Optional "as of block N" footer. */
  asOfBlock?: number;
  /** Total entries (for pagination hint). */
  total?: number;
  /** Offset applied (for pagination hint). */
  offset?: number;
}

/**
 * Render the arena list as a fixed-width ASCII table.
 *
 *   🏯 擂台群雄榜 (top 10)
 *   ┌─────┬──────────────────────┬──────────────┬────────┬──────────┐
 *   │  #  │ 侠客                  │ 战力         │ 战绩   │ 地址      │
 *   ├─────┼──────────────────────┼──────────────┼────────┼──────────┤
 *   │   1 │ 💀 暗夜·无名          │  ████ 1,240  │  8/2   │ 0xabc…123 │
 *   │   2 │    青衫·剑客          │  ███  1,080  │  6/3   │ 0xdef…456 │
 *   …
 */
export function renderArena(entries: ArenaEntry[], opts: RenderArenaOptions = {}): string {
  const title = opts.title ?? "🏯 擂台群雄榜";

  if (entries.length === 0) {
    return [bold(title), faint("擂台暂时无人,成为第一位挑战者吧!")].join("\n");
  }

  // Compute column widths based on actual content (visible widths).
  const maxPower = Math.max(...entries.map((e) => e.power));
  const rankW = 4;
  const nameW = 20;
  const powerW = 14;
  const recordW = 8;
  const addrW = 14;

  // Build the three border strings from the pillar glyphs. Each cell has one
  // space of padding on each side in a content row, so the horizontal border
  // must be `─`.repeat(cellW + 2) between pillars to stay aligned.
  const border = (left: string, mid: string, right: string) =>
    left +
    [rankW, nameW, powerW, recordW, addrW].map((w) => "─".repeat(w + 2)).join(mid) +
    right;
  const top = border("┌", "┬", "┐");
  const midBorder = border("├", "┼", "┤");
  const bot = border("└", "┴", "┘");

  const header = row(
    [padLeft("#", rankW), padRight("侠客", nameW), padRight("战力", powerW), padRight("战绩", recordW), padRight("地址", addrW)],
  );

  const rows = entries.map((e) =>
    row([
      padLeft(String(e.rank), rankW),
      padRight(formatName(e), nameW),
      padRight(formatPower(e.power, maxPower), powerW),
      padRight(formatRecord(e), recordW),
      padRight(formatAddr(e.address), addrW),
    ]),
  );

  const lines: string[] = [];
  lines.push(bold(title));
  lines.push(top);
  lines.push(header);
  lines.push(midBorder);
  lines.push(...rows);
  lines.push(bot);

  const footerBits: string[] = [];
  if (opts.total !== undefined) {
    const shown = entries.length;
    const off = opts.offset ?? 0;
    footerBits.push(`显示 ${off + 1}-${off + shown}/${opts.total}`);
  }
  if (opts.asOfBlock !== undefined) {
    footerBits.push(`@block ${opts.asOfBlock}`);
  }
  if (footerBits.length > 0) lines.push(faint(footerBits.join(" · ")));

  return lines.join("\n");
}

// ── helpers ─────────────────────────────────────────────────────────────────

function row(cells: string[]): string {
  return `│ ${cells.join(" │ ")} │`;
}

function formatName(e: ArenaEntry): string {
  const marker = e.isSelf ? "👑 " : "   ";
  const name = e.nickname ?? shortAddr(e.address);
  return `${marker}${e.isSelf ? status(name) : name}`;
}

/**
 * Render power as a mini bar + number, so even non-color terminals can read
 * relative strength at a glance. Width of the bar is capped at 5 cells.
 */
function formatPower(power: number, maxPower: number): string {
  const barW = 5;
  const filled = maxPower > 0 ? Math.max(1, Math.round((power / maxPower) * barW)) : 0;
  const bar = "█".repeat(filled) + "░".repeat(barW - filled);
  return `${bar} ${power.toLocaleString("en-US")}`;
}

function formatRecord(e: ArenaEntry): string {
  if (e.wins === undefined && e.losses === undefined) return faint("—");
  const w = e.wins ?? 0;
  const l = e.losses ?? 0;
  return `${w}/${l}`;
}

function formatAddr(addr: `0x${string}`): string {
  return link(shortAddr(addr));
}

function shortAddr(addr: `0x${string}`): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
