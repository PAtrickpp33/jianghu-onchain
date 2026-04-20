// Tool: xiake_mint_hero
// Creates 3 random heroes. In mock mode, generates locally.
// In on-chain mode, calls HeroNFT.mintGenesis via OnchainOS.

import { z } from "zod";
import { guard } from "./_util.js";
import { getCurrentPlayer, cacheHeroes } from "../state/cache.js";
import { renderCharacterCreation, renderMainMenu, renderStageList, type GameMenuState } from "../render/gameMenu.js";
import { Sect, SkillKind, type Hero } from "../types.js";

export const inputSchema = z.object({}).strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_mint_hero",
  description:
    "招募三位 genesis 侠客。演武模式下本地生成,链上模式通过 OnchainOS paymaster 免费铸造 NFT。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

function isMockMode(): boolean {
  return !process.env.XIAKE_ARENA_ADDRESS || !process.env.XIAKE_HERO_ADDRESS;
}

export async function handler(raw: unknown) {
  return guard(async () => {
    inputSchema.parse(raw ?? {});
    const mock = isMockMode();

    let heroes: Hero[];

    if (mock) {
      // Generate 3 random heroes locally
      heroes = generateMockHeroes();
      cacheHeroes(heroes);
    } else {
      // On-chain mint
      const { encodeFunctionData } = await import("viem");
      const { heroNftAbi } = await import("../chain/abi.js");
      const { getAddresses, txUrl, getPublicClient } = await import("../chain/client.js");
      const { signAndSend } = await import("../onchainos/gateway.js");
      const { fetchOwnedHeroIds, fetchHeroes } = await import("../chain/reads.js");

      const playerObj = getCurrentPlayer();
      if (!playerObj) throw new Error("请先调用 xiake_init 进入游戏。");
      const playerAddr = playerObj.address;

      const { hero } = getAddresses();
      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "mintGenesis",
        args: [playerAddr],
      });

      const { txHash } = await signAndSend({ to: hero, data, from: playerAddr });
      await getPublicClient().waitForTransactionReceipt({ hash: txHash });

      const ownedIds = await fetchOwnedHeroIds(playerAddr);
      heroes = await fetchHeroes(ownedIds);
      cacheHeroes(heroes);
    }

    // Show character cards + main menu
    const menuState: GameMenuState = {
      heroes,
      hasDefenseTeam: false,
      mode: mock ? "mock" : "onchain",
    };

    return (
      renderCharacterCreation(heroes) +
      "\n" +
      renderStageList() +
      "\n" +
      renderMainMenu(menuState)
    );
  });
}

// ── Mock hero generation ────────────────────────────────────────────────────

const HERO_POOL: Array<{ sect: Sect; name: string; baseHp: number; baseAtk: number; baseDef: number; baseSpd: number; baseCrit: number; skillIds: number[] }> = [
  { sect: Sect.Shaolin, name: "圆智", baseHp: 180, baseAtk: 70, baseDef: 95, baseSpd: 55, baseCrit: 500, skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "玄苦", baseHp: 200, baseAtk: 75, baseDef: 100, baseSpd: 50, baseCrit: 400, skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "空见", baseHp: 190, baseAtk: 65, baseDef: 105, baseSpd: 45, baseCrit: 300, skillIds: [1, 0, 2] },
  { sect: Sect.Shaolin, name: "渡劫", baseHp: 170, baseAtk: 80, baseDef: 90, baseSpd: 60, baseCrit: 600, skillIds: [2, 0, 1] },
  { sect: Sect.Tangmen, name: "飞燕", baseHp: 100, baseAtk: 95, baseDef: 50, baseSpd: 90, baseCrit: 1500, skillIds: [3, 4, 5] },
  { sect: Sect.Tangmen, name: "无名", baseHp: 110, baseAtk: 90, baseDef: 55, baseSpd: 85, baseCrit: 1800, skillIds: [3, 5, 4] },
  { sect: Sect.Tangmen, name: "夜鸮", baseHp: 95, baseAtk: 100, baseDef: 45, baseSpd: 95, baseCrit: 2000, skillIds: [4, 3, 5] },
  { sect: Sect.Tangmen, name: "柳如烟", baseHp: 105, baseAtk: 88, baseDef: 52, baseSpd: 88, baseCrit: 1600, skillIds: [5, 3, 4] },
  { sect: Sect.Emei, name: "静因", baseHp: 130, baseAtk: 65, baseDef: 70, baseSpd: 80, baseCrit: 800, skillIds: [6, 7, 8] },
  { sect: Sect.Emei, name: "灭绝", baseHp: 120, baseAtk: 80, baseDef: 65, baseSpd: 75, baseCrit: 1200, skillIds: [8, 6, 7] },
  { sect: Sect.Emei, name: "风陵", baseHp: 125, baseAtk: 72, baseDef: 68, baseSpd: 82, baseCrit: 1000, skillIds: [6, 8, 7] },
  { sect: Sect.Emei, name: "周芷若", baseHp: 115, baseAtk: 85, baseDef: 60, baseSpd: 78, baseCrit: 1400, skillIds: [8, 7, 6] },
];

function generateMockHeroes(): Hero[] {
  const seed = Date.now();
  let s = seed | 0 || 1;
  const rng = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };

  // Shuffle and pick 3 with at least 2 different sects
  const shuffled = [...HERO_POOL].sort(() => rng() - 0.5);
  const picked: typeof HERO_POOL = [];
  const sects = new Set<Sect>();

  for (const h of shuffled) {
    if (picked.length >= 3) break;
    if (picked.length === 2 && sects.size === 1 && sects.has(h.sect)) continue;
    picked.push(h);
    sects.add(h.sect);
  }
  while (picked.length < 3) picked.push(shuffled[picked.length]);

  return picked.map((h, i) => ({
    tokenId: BigInt(i + 1),
    sect: h.sect,
    name: h.name,
    hp: h.baseHp + Math.floor((rng() - 0.5) * 20),
    atk: h.baseAtk + Math.floor((rng() - 0.5) * 10),
    def: h.baseDef + Math.floor((rng() - 0.5) * 10),
    spd: h.baseSpd + Math.floor((rng() - 0.5) * 10),
    crit: h.baseCrit + Math.floor((rng() - 0.5) * 200),
    skillIds: h.skillIds,
  }));
}
