// Tool: xiake_replay
// Reads a stored BattleReport by battleId and renders it. Accepts the literal
// string "last" to replay the most recent battle in this session.

import { z } from "zod";
import { guard } from "./_util.js";
import { fetchBattleReport } from "../chain/reads.js";
import {
  getCachedReport,
  getLastBattleId,
  cacheReport,
} from "../state/cache.js";
import { renderBattleReport } from "../render/battleReport.js";

export const inputSchema = z
  .object({
    battleId: z
      .string()
      .refine(
        (v) => v === "last" || /^0x[0-9a-fA-F]{64}$/.test(v),
        "battleId 必须是 0x 开头的 32 字节 hex,或字面量 'last'",
      ),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_replay",
  description: "回放历史战报。传入 battleId (bytes32) 或字面量 'last' 重放本会话最后一场。",
  inputSchema: {
    type: "object",
    properties: {
      battleId: {
        type: "string",
        description: "32 字节 hex,例如 0xabc...;或 'last' 取本会话最后一场。",
      },
    },
    required: ["battleId"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw);

    let id: `0x${string}`;
    if (input.battleId === "last") {
      const last = getLastBattleId();
      if (!last) throw new Error("本会话尚未产生战报,请先打一场。");
      id = last;
    } else {
      id = input.battleId as `0x${string}`;
    }

    const cached = getCachedReport(id);
    if (cached) {
      return renderBattleReport(cached, { title: `📜 战报回放 (cached) ${id}` });
    }

    const report = await fetchBattleReport(id);
    cacheReport(report);
    return renderBattleReport(report, { title: `📜 战报回放 ${id}` });
  });
}
