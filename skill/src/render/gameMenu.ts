// Game menu renderer — the "GUI" layer for terminal-based gameplay.
// Every tool response should end with a contextual menu so the player
// always knows what to do next.

import { bold, faint, status, crit, heal } from "./ansi.js";
import { SECT_NAMES, SECT_ICON, type Hero } from "../types.js";

// ── Main game menu (shown after init or when player asks "what can I do") ───

export interface GameMenuState {
  playerName?: string;
  address?: string;
  heroes: Hero[];
  hasDefenseTeam: boolean;
  mode: "mock" | "onchain";
}

export function renderWelcome(): string {
  return [
    "",
    bold("╔══════════════════════════════════════════════════╗"),
    bold("║          ⚔️  江 湖 大 乱 斗  ⚔️                ║"),
    bold("║     The first game built for AI, not humans     ║"),
    bold("╚══════════════════════════════════════════════════╝"),
    "",
    "  武侠世界的大门已为你敞开。",
    "  在这里,少林刚猛、唐门诡秘、峨眉柔中带刚。",
    "  三大门派,九种绝学,谁主江湖?",
    "",
    faint("─".repeat(50)),
  ].join("\n");
}

export function renderMainMenu(state: GameMenuState): string {
  const lines: string[] = [];

  if (state.heroes.length === 0) {
    // New player flow
    lines.push("");
    lines.push(bold("🎭 你是一位初入江湖的侠客,尚无门徒。"));
    lines.push("");
    lines.push(status("👉 下一步: 招募你的第一批侠客"));
    lines.push("");
    lines.push("  请说: " + bold('"招募侠客"') + " 或调用 " + faint("xiake_mint_hero"));
    lines.push("");
  } else {
    // Returning player
    lines.push("");
    lines.push(bold(`🏯 你的江湖 (${state.mode === "mock" ? "演武模式" : "链上模式"})`));
    lines.push(faint("─".repeat(50)));
    lines.push(`  侠客: ${state.heroes.length} 位在册`);

    // Show team preview
    for (const h of state.heroes.slice(0, 3)) {
      const sect = SECT_NAMES[h.sect];
      const icon = SECT_ICON[h.sect] ?? "⚔️";
      lines.push(`  ${icon} ${sect}·${h.name}  HP${h.hp} ATK${h.atk} SPD${h.spd}`);
    }

    lines.push("");
    lines.push(bold("📜 可用指令:"));
    lines.push("");
    lines.push("  " + crit("⚔️  [1] 闯关 (PVE)") + "      — 挑战武林关卡,获取声望");
    lines.push("  " + status("🏟️  [2] 擂台 (PVP)") + "      — 挑战其他侠客的防守阵容");
    lines.push("  " + heal("🤖 [3] AI 对战") + "        — 观看两个 AI 门派对决");
    lines.push("  " + faint("👥 [4] 查看侠客") + "        — 查看你的侠客详细属性");
    if (!state.hasDefenseTeam) {
      lines.push("  " + faint("🛡️  [5] 设置防守阵容") + "    — 在擂台挂上你的阵容");
    }
    lines.push("");
    lines.push(faint("说出数字或直接描述你想做的事,我来执行。"));
  }

  return lines.join("\n");
}

// ── PVE Stage descriptions ──────────────────────────────────────────────────

export interface StageInfo {
  id: number;
  name: string;
  description: string;
  difficulty: "简单" | "普通" | "困难" | "地狱";
  difficultyStars: string;
  bossTeam: string;
  reward: string;
}

export const PVE_STAGES: StageInfo[] = [
  {
    id: 1,
    name: "少林藏经阁",
    description: "少林后山藏经阁,三位武僧把守。传闻阁内藏有失传已久的《易筋经》残卷。",
    difficulty: "简单",
    difficultyStars: "⭐",
    bossTeam: "少林·玄苦 / 少林·空见 / 少林·渡劫",
    reward: "江湖声望 +50",
  },
  {
    id: 2,
    name: "唐门密室",
    description: "蜀中唐门暗器密室,机关重重。唐门三杰以暗器和毒术闻名,一不留神便中招。",
    difficulty: "普通",
    difficultyStars: "⭐⭐",
    bossTeam: "唐门·飞燕 / 唐门·夜鸮 / 唐门·柳如烟",
    reward: "江湖声望 +100",
  },
  {
    id: 3,
    name: "峨眉金顶",
    description: "峨眉金顶之巅,云雾缭绕。峨眉弟子以慈悲心法和般若掌法守护山门。",
    difficulty: "普通",
    difficultyStars: "⭐⭐",
    bossTeam: "峨眉·灭绝 / 峨眉·风陵 / 峨眉·周芷若",
    reward: "江湖声望 +100",
  },
];

export function renderStageList(): string {
  const lines: string[] = [];
  lines.push(bold("📋 武林关卡"));
  lines.push(faint("─".repeat(50)));

  for (const stage of PVE_STAGES) {
    lines.push("");
    lines.push(bold(`  ${stage.difficultyStars}  第 ${stage.id} 关: ${stage.name}`));
    lines.push(faint(`     ${stage.description}`));
    lines.push(`     BOSS: ${stage.bossTeam}`);
    lines.push(`     难度: ${stage.difficulty}  |  奖励: ${stage.reward}`);
  }

  lines.push("");
  lines.push(faint("说 \"闯第1关\" 或调用 xiake_start_pve(stageId=1) 开始挑战。"));
  return lines.join("\n");
}

// ── Character creation card ─────────────────────────────────────────────────

export function renderCharacterCreation(heroes: Hero[]): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(bold("🎉 恭喜!你招募到三位江湖豪杰!"));
  lines.push(faint("═".repeat(50)));

  for (const hero of heroes) {
    const sect = SECT_NAMES[hero.sect];
    const icon = SECT_ICON[hero.sect] ?? "⚔️";
    lines.push("");
    lines.push(bold(`  ${icon} ${sect}·${hero.name}  #${hero.tokenId}`));
    lines.push(`     ❤️  HP ${hero.hp}  |  ⚔️  ATK ${hero.atk}  |  🛡️  DEF ${hero.def}`);
    lines.push(`     💨 SPD ${hero.spd}  |  💥 暴击 ${(hero.crit / 100).toFixed(1)}%`);

    const skillNames = hero.skillIds.map(id => {
      const meta: Record<number, string> = {
        0: "金钟罩", 1: "易筋经", 2: "狮子吼",
        3: "穿心刺", 4: "暗器急雨", 5: "毒针",
        6: "慈航普渡", 7: "净心咒", 8: "般若掌",
      };
      return meta[id] ?? `技能#${id}`;
    });
    lines.push(`     🎯 技能: ${skillNames.join(" / ")}`);
  }

  lines.push("");
  lines.push(faint("═".repeat(50)));
  return lines.join("\n");
}
