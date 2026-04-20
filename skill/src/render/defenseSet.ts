// Renders the confirmation card after setDefenseTeam succeeds
// (consumed by xiake_set_defense_team).

import type { Hero } from "../types.js";
import { bold, faint, link, status } from "./ansi.js";
import { SECT_NAMES } from "../types.js";

export interface DefenseSetInput {
  heroes: Hero[];
  txHash: `0x${string}`;
  txUrl?: string;
}

export function renderDefenseSet(input: DefenseSetInput): string {
  const { heroes, txHash, txUrl } = input;
  const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;

  const lines: string[] = [];
  lines.push(bold("🛡️  防守阵容已立"));
  lines.push("─".repeat(46));
  lines.push(status("✓ 阵容已上链,挑战者来袭时将自动应战"));
  lines.push("");

  heroes.forEach((hero, idx) => {
    const pos = ["上位", "中位", "下位"][idx] ?? `#${idx + 1}`;
    const sect = SECT_NAMES[hero.sect];
    lines.push(`  ${pos}  ${sect}·${hero.name}  ${faint(`#${hero.tokenId}`)}`);
  });

  lines.push("");
  lines.push(faint(`tx: ${txUrl ? link(shortTx) + `  (${txUrl})` : shortTx}`));
  lines.push("");
  lines.push(faint("下一步: `xiake_list_arena` 查擂台对手,`xiake_challenge` 主动挑战。"));

  return lines.join("\n");
}
