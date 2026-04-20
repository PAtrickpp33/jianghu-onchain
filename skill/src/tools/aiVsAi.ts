// Tool: xiake_ai_vs_ai (CORE demo)
// Delegates to ../caster/runAiVsAi — the orchestrator that runs two agent
// personas against each other, optionally with a streamed commentary layer.
// This handler is mostly input validation + error framing.

import { z } from "zod";
import { guard } from "./_util.js";
import { runAiVsAi } from "../caster/runAiVsAi.js";

const agentIdSchema = z.enum(["claude", "gpt", "mock", "tangmen", "shaolin", "emei"]);

export const inputSchema = z
  .object({
    agentA: agentIdSchema.optional(),
    agentB: agentIdSchema.optional(),
    rounds: z.number().int().min(1).max(5).default(1),
    caster: z.boolean().optional(),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_ai_vs_ai",
  description:
    "侠客擂台 AI 对战。无需任何配置即可运行(自动 mock 模式)。返回逐回合战报,适合让 AI agent 用金庸风格解说。",
  inputSchema: {
    type: "object",
    properties: {
      agentA: {
        type: "string",
        enum: ["claude", "gpt", "mock", "tangmen", "shaolin", "emei"],
        description: "A 方流派。不填自动选择(有 API key 用 claude,否则 mock)。",
      },
      agentB: {
        type: "string",
        enum: ["claude", "gpt", "mock", "tangmen", "shaolin", "emei"],
        description: "B 方流派。不填自动选择。",
      },
      rounds: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        default: 1,
        description: "对战局数。",
      },
      caster: {
        type: "boolean",
        description: "是否启用内置解说(需 ANTHROPIC_API_KEY)。不填自动检测。留空时建议让 Claude Code 自己解说。",
      },
    },
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw ?? {});
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasChain = Boolean(process.env.XIAKE_ARENA_ADDRESS);

    const report = await runAiVsAi({
      agentA: input.agentA ?? (hasApiKey ? "claude" : "mock"),
      agentB: input.agentB ?? (hasApiKey ? "gpt" : "mock"),
      rounds: input.rounds,
      withCaster: input.caster ?? false,
    });

    // Append narration hint so Claude Code auto-generates wuxia commentary
    return report + "\n\n---\n" +
      "📜 **请用金庸说书人的风格,逐回合解说上述战报。** " +
      "每回合用生动的武侠对白描述招式交锋,加入角色性格(少林稳如磐石、唐门狠辣诡秘、峨眉慈悲柔中带刚)。" +
      "最后总结本场 MVP 和精彩瞬间。";
  });
}
