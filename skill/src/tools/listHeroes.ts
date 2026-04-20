// Tool: xiake_list_heroes
// Lists every hero NFT owned by the current wallet and renders ASCII cards.

import { z } from "zod";
import { guard, requirePlayer } from "./_util.js";
import { fetchOwnedHeroIds, fetchHeroes } from "../chain/reads.js";
import { getCurrentPlayer, cacheHeroes } from "../state/cache.js";
import { renderHeroCard } from "../render/heroCard.js";

export const inputSchema = z.object({}).strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_list_heroes",
  description:
    "列出当前钱包持有的所有侠客 NFT,逐个渲染 ASCII 属性卡。",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    inputSchema.parse(raw ?? {});
    const player = requirePlayer(getCurrentPlayer());

    const ids = await fetchOwnedHeroIds(player.address);
    if (ids.length === 0) {
      return [
        "### 你还没有侠客",
        "",
        "调用 `xiake_mint_hero` 领取 3 位 genesis 侠客 NFT(paymaster 代付)。",
      ].join("\n");
    }

    const heroes = await fetchHeroes(ids);
    cacheHeroes(heroes);

    const cards = heroes.map((h) => renderHeroCard(h)).join("\n\n");
    return [`### 你的侠客 (${heroes.length})`, "", cards].join("\n");
  });
}
