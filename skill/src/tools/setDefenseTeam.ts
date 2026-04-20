// Tool: xiake_set_defense_team
// Writes the player's 3-hero defense lineup on-chain.

import { z } from "zod";
import { encodeFunctionData } from "viem";
import { guard, requirePlayer } from "./_util.js";
import { arenaAbi } from "../chain/abi.js";
import { getAddresses, txUrl } from "../chain/client.js";
import { signAndSend } from "../onchainos/gateway.js";
import { getPublicClient } from "../chain/client.js";
import { getCurrentPlayer, cacheHeroes } from "../state/cache.js";
import { fetchHeroes } from "../chain/reads.js";
import { renderDefenseSet } from "../render/defenseSet.js";

export const inputSchema = z
  .object({
    heroIds: z.array(z.union([z.string(), z.number()])).length(3),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_set_defense_team",
  description: "在擂台上设置 3 人防守阵容(当有人挑战你时使用)。",
  inputSchema: {
    type: "object",
    properties: {
      heroIds: {
        type: "array",
        items: { type: ["string", "number"] },
        minItems: 3,
        maxItems: 3,
        description: "3 个侠客 tokenId,按上中下位置排序。",
      },
    },
    required: ["heroIds"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw);
    const player = requirePlayer(getCurrentPlayer());

    const [a, b, c] = input.heroIds.map((v) => BigInt(v)) as [bigint, bigint, bigint];
    if (a === b || b === c || a === c) {
      throw new Error("阵容中不允许重复的 heroId。");
    }

    const { arena } = getAddresses();
    const data = encodeFunctionData({
      abi: arenaAbi,
      functionName: "setDefenseTeam",
      args: [[a, b, c]],
    });

    const { txHash } = await signAndSend({
      to: arena,
      data,
      from: player.address,
    });
    await getPublicClient().waitForTransactionReceipt({ hash: txHash });

    const heroes = await fetchHeroes([a, b, c]);
    cacheHeroes(heroes);

    return renderDefenseSet({
      heroes,
      txHash,
      txUrl: txUrl(txHash),
    });
  });
}
