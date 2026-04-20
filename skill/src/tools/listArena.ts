// Tool: xiake_list_arena
// Reads Arena.listArena(offset=0, limit=10 by default) and renders the
// leaderboard of challengeable players.

import { z } from "zod";
import { guard } from "./_util.js";
import { fetchArenaList } from "../chain/reads.js";
import { renderArenaList } from "../render/arenaList.js";

export const inputSchema = z
  .object({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_list_arena",
  description: "查询擂台上的对手列表,按战力排序。",
  inputSchema: {
    type: "object",
    properties: {
      offset: { type: "integer", minimum: 0, default: 0 },
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
    },
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw ?? {});
    const { players, powers } = await fetchArenaList(
      BigInt(input.offset),
      BigInt(input.limit),
    );
    return renderArenaList({
      offset: input.offset,
      entries: players.map((addr, i) => ({ address: addr, power: powers[i] ?? 0n })),
    });
  });
}
