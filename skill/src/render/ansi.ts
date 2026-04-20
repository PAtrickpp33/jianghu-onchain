// ANSI color + terminal-capability helpers for the ASCII battle report renderer.
//
// Authoritative reference: docs/TECHNICAL_DESIGN.md §5.3
//
// Design notes:
//   • Every color helper goes through `paint(color, text)` which NO-OPs when
//     the output stream is not a TTY. This is what the spec calls "plain
//     emoji fallback".
//   • We deliberately keep the exported API narrow (crit / heal / control /
//     status / link / bold / dim) so caller sites stay readable and we don't
//     scatter raw escape codes across the codebase.

/** Whether ANSI escape sequences should be emitted. Evaluated lazily. */
let ansiEnabled: boolean | null = null;

/**
 * Decide once whether colors are OK to emit. Priority:
 *   1. explicit FORCE_COLOR=1 / NO_COLOR=1 env vars (industry convention)
 *   2. `process.stdout.isTTY` detection
 */
export function ansiAvailable(): boolean {
  if (ansiEnabled !== null) return ansiEnabled;
  if (process.env.NO_COLOR) {
    ansiEnabled = false;
    return false;
  }
  if (process.env.FORCE_COLOR === "1" || process.env.FORCE_COLOR === "true") {
    ansiEnabled = true;
    return true;
  }
  ansiEnabled = Boolean(process.stdout && process.stdout.isTTY);
  return ansiEnabled;
}

/** Test-only override. */
export function _setAnsiEnabled(v: boolean | null): void {
  ansiEnabled = v;
}

type ColorName = "crit" | "heal" | "control" | "status" | "link" | "bold" | "dim" | "faint";

const CODES: Record<ColorName, string> = {
  crit: "\x1b[1;31m", // bold red
  heal: "\x1b[1;32m", // bold green
  control: "\x1b[1;35m", // bold magenta
  status: "\x1b[1;33m", // bold yellow
  link: "\x1b[4;36m", // underline cyan
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  faint: "\x1b[90m", // bright black (grey)
};

const RESET = "\x1b[0m";

/**
 * Wrap `text` in the escape sequence for `color`, or return plain text on
 * non-TTY stdout. Handles nested resets correctly by stripping any trailing
 * reset before re-wrapping.
 */
export function paint(color: ColorName, text: string): string {
  if (!ansiAvailable()) return text;
  return `${CODES[color]}${text}${RESET}`;
}

export const crit = (s: string) => paint("crit", s);
export const heal = (s: string) => paint("heal", s);
export const control = (s: string) => paint("control", s);
export const status = (s: string) => paint("status", s);
export const link = (s: string) => paint("link", s);
export const bold = (s: string) => paint("bold", s);
export const dim = (s: string) => paint("dim", s);
export const faint = (s: string) => paint("faint", s);

/**
 * Render a horizontal HP bar, e.g. ████████░░ for 80% HP.
 *
 * @param current  current HP (clamped to [0, max])
 * @param max      max HP
 * @param width    width in cells (default 10 per §5.1)
 */
export function hpBar(current: number, max: number, width = 10): string {
  if (max <= 0) return "░".repeat(width);
  const clamped = Math.max(0, Math.min(current, max));
  const filled = Math.round((clamped / max) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  // Color the bar based on HP percentage for quick visual read.
  if (!ansiAvailable()) return bar;
  const pct = clamped / max;
  if (pct <= 0.25) return paint("crit", bar);
  if (pct <= 0.5) return paint("status", bar);
  return paint("heal", bar);
}

/**
 * Strip all ANSI escape sequences — useful when we want to compute visible
 * width for padding / table alignment. Handles CSI sequences only (enough for
 * our palette).
 */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Visible-width of `s`, treating East Asian wide characters (CJK ideographs,
 * hiragana, katakana, full-width punctuation) as 2 cells. Good enough for the
 * Xiake sect / hero names which are all CJK.
 */
export function visibleWidth(s: string): number {
  const plain = stripAnsi(s);
  let w = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0) ?? 0;
    // Fast path: ASCII.
    if (cp < 0x80) {
      w += 1;
      continue;
    }
    // Rough wide-char ranges (BMP CJK + punctuation + full-width forms).
    if (
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul jamo
      (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, punctuation
      (cp >= 0x3041 && cp <= 0x33ff) || // hiragana/katakana/CJK symbols
      (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
      (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
      (cp >= 0xa000 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) || // full-width
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) // emoji & pictographs
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/**
 * Right-pad `s` with spaces so its visible width reaches `targetWidth`.
 * Truncates (with an ellipsis) when `s` is already wider than `targetWidth`.
 */
export function padRight(s: string, targetWidth: number): string {
  const w = visibleWidth(s);
  if (w >= targetWidth) return s;
  return s + " ".repeat(targetWidth - w);
}

/** Left-pad counterpart to `padRight`. */
export function padLeft(s: string, targetWidth: number): string {
  const w = visibleWidth(s);
  if (w >= targetWidth) return s;
  return " ".repeat(targetWidth - w) + s;
}
