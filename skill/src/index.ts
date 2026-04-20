#!/usr/bin/env node
// MCP server entry for xiake-skill (《侠客擂台》).
// - Registers the 9 tools (see docs/TECHNICAL_DESIGN.md §4.2)
// - Speaks JSON-RPC over stdio (@modelcontextprotocol/sdk Server)
// - Each tool handler returns Markdown; errors are wrapped to isError=true.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import * as initTool from "./tools/init.js";
import * as mintHero from "./tools/mintHero.js";
import * as listHeroes from "./tools/listHeroes.js";
import * as startPve from "./tools/startPve.js";
import * as setDefenseTeam from "./tools/setDefenseTeam.js";
import * as listArena from "./tools/listArena.js";
import * as challenge from "./tools/challenge.js";
import * as aiVsAi from "./tools/aiVsAi.js";
import * as replay from "./tools/replay.js";

type ToolModule = {
  toolDef: { name: string; description: string; inputSchema: unknown };
  handler: (raw: unknown) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
};

const TOOLS: ToolModule[] = [
  initTool,
  mintHero,
  listHeroes,
  startPve,
  setDefenseTeam,
  listArena,
  challenge,
  aiVsAi,
  replay,
];

const HANDLERS: Record<string, ToolModule["handler"]> = Object.fromEntries(
  TOOLS.map((t) => [t.toolDef.name, t.handler]),
);

async function main(): Promise<void> {
  const server = new Server(
    {
      name: "xiake-skill",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => t.toolDef),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLERS[name];
    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `未知工具: ${name}` }],
        isError: true,
      };
    }
    return handler(args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is fine for operational logs — stdout is reserved for JSON-RPC.
  process.stderr.write("[xiake-skill] MCP server ready on stdio\n");
}

main().catch((e) => {
  process.stderr.write(`[xiake-skill] fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
