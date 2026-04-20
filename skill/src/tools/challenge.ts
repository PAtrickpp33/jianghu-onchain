// Tool: xiake_challenge
// Challenges the defense lineup of `target`. Attacker's team is the attacker's
// current top 3 heroes (contract enforces, skill just passes intent).

import { z } from "zod";
import { encodeFunctionData, decodeEventLog, type Log } from "viem";
import { guard, requirePlayer } from "./_util.js";
import { arenaAbi } from "../chain/abi.js";
import { getAddresses, txUrl } from "../chain/client.js";
import { signAndSend } from "../onchainos/gateway.js";
import { getPublicClient } from "../chain/client.js";
import {
  fetchOwnedHeroIds,
  fetchHeroes,
  fetchDefenseTeam,
  fetchBattleReport,
} from "../chain/reads.js";
import {
  getCurrentPlayer,
  cacheHeroes,
  cacheReport,
  setLastBattleId,
} from "../state/cache.js";
import { renderBattleReport } from "../render/battleReport.js";

export const inputSchema = z
  .object({
    target: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "地址格式错误"),
  })
  .strict();
export type Input = z.infer<typeof inputSchema>;

export const toolDef = {
  name: "xiake_challenge",
  description: "挑战擂台上的其他侠客;会在链上模拟 3v3 战斗并返回战报。",
  inputSchema: {
    type: "object",
    properties: {
      target: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{40}$",
        description: "被挑战者的钱包地址。",
      },
    },
    required: ["target"],
    additionalProperties: false,
  },
} as const;

export async function handler(raw: unknown) {
  return guard(async () => {
    const input = inputSchema.parse(raw);
    const player = requirePlayer(getCurrentPlayer());
    const target = input.target as `0x${string}`;

    if (target.toLowerCase() === player.address.toLowerCase()) {
      throw new Error("不能挑战自己。");
    }

    const { arena } = getAddresses();
    const data = encodeFunctionData({
      abi: arenaAbi,
      functionName: "challenge",
      args: [target],
    });

    const { txHash } = await signAndSend({
      to: arena,
      data,
      from: player.address,
    });

    const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });
    const battleId = extractBattleId(receipt.logs, arena);

    const [attackerIds, defenderIds] = await Promise.all([
      fetchOwnedHeroIds(player.address),
      fetchDefenseTeam(target),
    ]);
    const [attackerTeam, defenderTeam] = await Promise.all([
      fetchHeroes(attackerIds.slice(0, 3)),
      fetchHeroes([...defenderIds]),
    ]);
    cacheHeroes([...attackerTeam, ...defenderTeam]);

    const report = await fetchBattleReport(
      battleId,
      { attackerTeam, defenderTeam },
      txHash,
    );
    cacheReport(report);
    setLastBattleId(battleId);

    return renderBattleReport(report, {
      title: `⚔️ 擂台挑战 → ${target}`,
      txUrl: txUrl(txHash),
    });
  });
}

function extractBattleId(logs: readonly Log[], arenaAddr: `0x${string}`): `0x${string}` {
  for (const log of logs) {
    if (log.address.toLowerCase() !== arenaAddr.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: arenaAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "BattleSettled") {
        return (decoded.args as { battleId: `0x${string}` }).battleId;
      }
    } catch {
      /* skip non-matching log */
    }
  }
  throw new Error("未能从交易收据中解析到 BattleSettled 事件。");
}
