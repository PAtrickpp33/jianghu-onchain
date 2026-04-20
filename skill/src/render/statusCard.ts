// Renders the player's initialization status card (consumed by xiake_init).

import { bold, faint, link, status } from "./ansi.js";

export interface StatusCardInput {
  address: `0x${string}`;
  hasMintedGenesis: boolean;
  heroCount: number;
  chain: string;
}

export function renderStatusCard(input: StatusCardInput): string {
  const { address, hasMintedGenesis, heroCount, chain } = input;
  const shortAddr = `${address.slice(0, 6)}…${address.slice(-4)}`;

  const lines: string[] = [];
  lines.push(bold("⛩️  欢迎入江湖"));
  lines.push("─".repeat(46));
  lines.push(`钱包   ${link(shortAddr)}  ${faint(`(${chain})`)}`);
  lines.push(`侠客   ${heroCount > 0 ? status(String(heroCount)) : "0"} 位在册`);

  if (hasMintedGenesis) {
    lines.push("");
    lines.push(status(`✓ 你已领取 genesis 侠客`));
    lines.push(faint("下一步: 使用 `xiake_list_heroes` 查看阵容,或 `xiake_start_pve` 开始闯关。"));
  } else {
    lines.push("");
    lines.push(bold("🎁 尚未领取 genesis 侠客"));
    lines.push(faint("下一步: 使用 `xiake_mint_hero` 免费铸造三位侠客 (gas 由江湖盟主代付)。"));
  }

  return lines.join("\n");
}
