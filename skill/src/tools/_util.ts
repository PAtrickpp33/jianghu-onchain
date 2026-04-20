// Shared helpers for tool handlers: error formatting and MCP result packaging.

import { MissingAddressError } from "../chain/client.js";

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

/** Wrap a Markdown string as an MCP tool result. */
export function ok(md: string): McpToolResult {
  return { content: [{ type: "text", text: md }] };
}

/** Wrap a Markdown error message as an MCP tool result with isError=true. */
export function err(md: string): McpToolResult {
  return { content: [{ type: "text", text: md }], isError: true };
}

/** Standardize error → Markdown. Recognizes MissingAddressError specially. */
export function formatError(e: unknown): string {
  if (e instanceof MissingAddressError) {
    return [
      "### 配置错误",
      "",
      e.message,
      "",
      "启动 skill 前请在 MCP config 中补齐合约地址环境变量:",
      "```",
      "XIAKE_HERO_ADDRESS=0x...",
      "XIAKE_ARENA_ADDRESS=0x...",
      "```",
    ].join("\n");
  }
  const msg = e instanceof Error ? e.message : String(e);
  return `### 调用失败\n\n\`\`\`\n${msg}\n\`\`\``;
}

/** Catch-all wrapper for tool handler bodies. */
export async function guard(fn: () => Promise<string>): Promise<McpToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(formatError(e));
  }
}

/** Ensure the current player is set; throw a friendly error otherwise. */
export function requirePlayer<T extends { address: `0x${string}` }>(
  player: T | undefined,
): T {
  if (!player) {
    throw new Error("尚未初始化玩家信息,请先调用 `xiake_init`。");
  }
  return player;
}
