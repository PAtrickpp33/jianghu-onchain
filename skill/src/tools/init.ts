// Tool: wuxia_init
// Main game entry point. Works in both mock and on-chain mode.
// Shows welcome screen + character status + game menu.

import { z } from "zod";
import { createHash } from "node:crypto";
import { guard } from "./_util.js";
import { setCurrentPlayer, getHeroCache, cacheHeroes } from "../state/cache.js";
import { renderWelcome, renderMainMenu, type GameMenuState } from "../render/gameMenu.js";

export const inputSchema = z.object({}).strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "wuxia_init",
  description:
    "进入江湖大乱斗。展示欢迎画面和游戏主菜单。首次进入引导创建角色。无需任何配置即可运行。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

function isMockMode(): boolean {
  return !process.env.WUXIA_ARENA_ADDRESS || !process.env.WUXIA_HERO_ADDRESS;
}

export async function handler(raw: unknown) {
  return guard(async () => {
    inputSchema.parse(raw ?? {});
    const mock = isMockMode();

    let address: `0x${string}`;
    let heroes = [...getHeroCache().values()];

    if (mock) {
      // Mock mode: use a fake address, heroes from cache
      address = "0x000000000000000000000000000000000000A001";
      setCurrentPlayer(address);
    } else {
      // On-chain mode: create/fetch OnchainOS wallet
      const { createWalletAccount, getWalletAccount } = await import("../onchainos/wallet.js");
      const { fetchHasMintedGenesis, fetchOwnedHeroIds, fetchHeroes } = await import("../chain/reads.js");

      const accountId = sessionAccountId();
      const existing = await getWalletAccount(accountId).catch(() => null);
      const account = existing ?? (await createWalletAccount({ accountId }));
      address = account.address as `0x${string}`;
      setCurrentPlayer(address);

      const ownedIds = await fetchOwnedHeroIds(address);
      if (ownedIds.length > 0) {
        const fetched = await fetchHeroes(ownedIds);
        cacheHeroes(fetched);
        heroes = fetched;
      }
    }

    const menuState: GameMenuState = {
      address,
      heroes,
      hasDefenseTeam: false, // simplified for mock
      mode: mock ? "mock" : "onchain",
    };

    return renderWelcome() + "\n" + renderMainMenu(menuState);
  });
}

function sessionAccountId(): string {
  if (process.env.WUXIA_PLAYER_ID) return process.env.WUXIA_PLAYER_ID;
  const seed = `${process.pid}:${process.env.HOSTNAME ?? "local"}`;
  return `wuxia-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}
