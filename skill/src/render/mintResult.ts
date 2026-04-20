// Renders the result card after mintGenesis succeeds (consumed by xiake_mint_hero).

import type { Hero } from "../types.js";
import { bold, faint, link, status } from "./ansi.js";
import { renderHeroCard } from "./heroCard.js";

export interface MintResultInput {
  txHash: `0x${string}`;
  txUrl?: string;
  heroes: Hero[];
}

export function renderMintResult(input: MintResultInput): string {
  const { txHash, txUrl, heroes } = input;
  const shortTx = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;

  const lines: string[] = [];
  lines.push(bold("⚔️  铸造完成!江湖新晋三杰登场"));
  lines.push("─".repeat(46));
  lines.push(status(`✓ 已成功 mint ${heroes.length} 位侠客`));
  lines.push("");

  for (const hero of heroes) {
    lines.push(renderHeroCard(hero));
    lines.push("");
  }

  lines.push(faint(`tx: ${txUrl ? link(shortTx) + `  (${txUrl})` : shortTx}`));
  lines.push("");
  lines.push(faint("下一步: `xiake_set_defense_team` 设置防守阵容,或 `xiake_start_pve` 打第一关。"));

  return lines.join("\n");
}
