# 《侠客擂台》技术方案 v1.0

| 字段 | 值 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-04-16 |
| 关联 | `PRD.md` |

---

## 1. 架构总览

```
 ┌─────────────────────────────────────────────────────────┐
 │  玩家端: Claude Code / Cursor / Codex / OpenCode (MCP)  │
 └────────────────────────┬────────────────────────────────┘
                          │ stdio / JSON-RPC
                          ▼
 ┌─────────────────────────────────────────────────────────┐
 │     xiake-skill  (MCP Server, TypeScript)               │
 │  ┌──────────┬──────────┬──────────┬──────────────────┐ │
 │  │  tools   │  state   │ renderer │ caster-agent     │ │
 │  │ (8 个)   │  (cache) │ (ASCII)  │ (OpenAI/Claude)  │ │
 │  └──────────┴──────────┴──────────┴──────────────────┘ │
 └──────┬──────────────────────────────┬───────────────────┘
        │                              │
        ▼                              ▼
 ┌──────────────────┐          ┌─────────────────────────┐
 │  OnchainOS APIs  │          │   LLM API (解说 agent)  │
 │ - Wallet (WaaS)  │          │ - Claude / GPT-4        │
 │ - Gateway (tx)   │          │ - Streaming 输出        │
 │ - Paymaster      │          └─────────────────────────┘
 │ - Security       │
 └────────┬─────────┘
          │ signAndSend
          ▼
 ┌──────────────────────────────────────────────────────┐
 │    Base Sepolia (以太坊 L2)                          │
 │  ┌──────────────┬──────────────┬──────────────────┐ │
 │  │  HeroNFT.sol │  Arena.sol   │ BattleEngine.sol │ │
 │  │  (ERC-721)   │  (PVP/PVE)   │ (pure library)   │ │
 │  └──────────────┴──────────────┴──────────────────┘ │
 └──────────────────────────────────────────────────────┘
```

---

## 2. 技术栈选型

| 层 | 选择 | 版本 / 备注 |
|---|---|---|
| 合约语言 | Solidity | 0.8.24,EVM version: cancun(锁定) |
| 合约开发 | Foundry | forge + cast + anvil |
| 合约部署链 | Base Sepolia | Chain ID 84532,后续可扩 X Layer |
| Skill 语言 | TypeScript | 5.x |
| MCP SDK | `@modelcontextprotocol/sdk` | 官方 |
| Web3 库 | `viem` | 2.x,比 ethers 轻 |
| LLM(解说) | Anthropic Claude API | streaming |
| OnchainOS | REST API | WaaS / Gateway / Paymaster |
| 打包分发 | npm `xiake-skill` | `npx xiake-skill` 或 MCP config |
| Demo 录屏 | asciinema + tmux | 2x 加速 |

---

## 3. 智能合约设计

### 3.1 合约清单 & LOC 估算

| 合约 | LOC | 职责 |
|---|---|---|
| `HeroNFT.sol` | ~200 | ERC-721,侠客铸造与属性 |
| `BattleEngine.sol` | ~400 | pure library,纯内存战斗模拟 |
| `Arena.sol` | ~250 | PVE/PVP 入口、战报存储、EIP-712 签名校验 |
| `SkillRegistry.sol` | ~150 | 技能元数据与效果分支 |
| `Types.sol` | ~100 | 共享 struct / enum |
| Foundry tests | ~400 | 核心路径测试 |
| **总计** | **~1500 LOC** | 单人 4-5 工作日可达 |

### 3.2 核心数据结构

```solidity
// Types.sol
enum Sect { Shaolin, Tangmen, Emei }
enum SkillKind { Damage, Heal, Buff, Control, Dot }

struct Hero {
    uint256 tokenId;
    Sect    sect;
    uint16  hp;
    uint16  atk;
    uint16  def;
    uint16  spd;
    uint16  crit;        // 0..10000 (basis points)
    uint8[] skillIds;    // 3 个技能 id
}

struct Skill {
    uint16 multiplier;   // 伤害倍率 basis points (10000 = 100%)
    SkillKind kind;
    uint8 duration;      // buff/debuff 持续回合
    bytes32 nameHash;    // keccak256("穿心刺") 校验
}

struct BattleEvent {
    uint8  round;
    uint8  actorIdx;     // 0..5
    uint8  skillId;
    uint8  targetIdx;
    int16  hpDelta;
    uint8  flags;        // bit0: crit, bit1: miss, bit2: kill, ...
}

struct BattleReport {
    bytes32 battleId;
    address attacker;
    address defender;
    uint8   winner;      // 0=attacker, 1=defender, 2=draw
    uint64  timestamp;
    BattleEvent[] events;  // 战报事件流,直接存 storage
}
```

### 3.3 HeroNFT.sol 接口

```solidity
interface IHeroNFT is IERC721 {
    function mintGenesis(address to) external returns (uint256[3] memory tokenIds);
    // 免费 mint,OnchainOS paymaster 代付;每地址限 1 次

    function getHero(uint256 tokenId) external view returns (Hero memory);
    function getHeroes(uint256[] calldata ids) external view returns (Hero[] memory);
    // 批量查询,skill 渲染阵容用
}
```

### 3.4 BattleEngine.sol(纯 library,memory-only)

```solidity
library BattleEngine {
    uint8 constant MAX_ROUNDS = 30;

    function simulate(
        Hero[3] memory a,
        Hero[3] memory b,
        uint256 seed
    ) internal pure returns (uint8 winner, BattleEvent[] memory events) {
        // 1. 初始化 runtime state(HP/buff 数组)
        // 2. 按 SPD 构建 turn order
        // 3. 逐回合循环,每个存活侠客出手(skill 随机或 AI 指定)
        // 4. 计算伤害、应用 buff/debuff、记录 event
        // 5. 胜负判定:一方全灭 OR 30 回合超时
        // 返回 winner + events 数组
    }

    function _damage(
        Hero memory attacker,
        Hero memory defender,
        Skill memory skill,
        uint256 randSeed
    ) internal pure returns (uint16 dmg, bool isCrit);
}
```

**关键**: `pure` + memory only,**零 SSTORE**,确保 gas 成本可控,且可被 off-chain 模拟完全一致(便于 skill 端预演).

### 3.5 Arena.sol 接口

```solidity
interface IArena {
    // 玩家挑战 BOSS
    function startPve(uint256[3] calldata heroIds, uint8 stageId)
        external returns (bytes32 battleId);

    // PVP:attacker 调用,defender 的阵容从 Arena 里取
    function challenge(address defender) external returns (bytes32 battleId);

    // 玩家设防守阵容
    function setDefenseTeam(uint256[3] calldata heroIds) external;

    // AI vs AI: relayer 可代发(通过 EIP-712 双方签名)
    function challengeRelay(
        address attacker,
        address defender,
        bytes calldata attackerSig,
        bytes calldata defenderSig
    ) external returns (bytes32 battleId);

    // 查询
    function getBattleReport(bytes32 battleId) external view returns (BattleReport memory);
    function getDefenseTeam(address player) external view returns (uint256[3] memory);
    function listArena(uint256 offset, uint256 limit)
        external view returns (address[] memory players, uint256[] memory powers);

    event BattleSettled(
        bytes32 indexed battleId,
        address indexed attacker,
        address indexed defender,
        uint8 winner
    );
}
```

### 3.6 签名 & Nonce 管理

- 所有"代发"接口用 **EIP-712** 结构化签名
- **Per-player nonce mapping** 代替账户 nonce,避免 AI 连发 tx 撞车

```solidity
mapping(address => uint64) public playerNonce;

function _verifyChallenge(
    address attacker,
    address defender,
    bytes calldata sig
) internal returns (uint64 usedNonce);
```

### 3.7 随机数

**MVP 方案**: `keccak256(block.prevrandao, battleId, round)` 伪随机。
**升级方案**(buffer 有时间): Pyth Entropy callback 模式。

### 3.8 Gas 预算(Base L2)

| 操作 | 预估 gas | 备注 |
|---|---|---|
| `mintGenesis`(3 个 NFT) | ~350k | 一次性,paymaster 代付 |
| `setDefenseTeam` | ~60k | 低频 |
| `challenge` / `startPve` | ~1.5M-2.5M | **最大头,战斗 + 写战报** |
| `getBattleReport`(view) | 0 | 免费 |

Base 当前 gas price ~0.01 gwei → 一局 **$0.02-0.08**,全程 paymaster 代付玩家零感。

---

## 4. Skill / MCP Server 设计

### 4.1 目录结构

```
xiake-skill/
├── src/
│   ├── index.ts             # MCP server entry
│   ├── tools/               # 每个 tool 一个文件
│   │   ├── init.ts
│   │   ├── mintHero.ts
│   │   ├── listHeroes.ts
│   │   ├── startPve.ts
│   │   ├── setDefenseTeam.ts
│   │   ├── listArena.ts
│   │   ├── challenge.ts
│   │   ├── aiVsAi.ts        # 核心 demo
│   │   └── replay.ts
│   ├── onchainos/           # OnchainOS API 封装
│   │   ├── wallet.ts
│   │   ├── gateway.ts
│   │   └── paymaster.ts
│   ├── chain/               # 链上交互
│   │   ├── contracts.ts     # ABI + 地址
│   │   ├── client.ts        # viem client
│   │   └── types.ts
│   ├── render/              # ASCII 战报
│   │   ├── battleReport.ts
│   │   ├── heroCard.ts
│   │   └── ansi.ts
│   ├── caster/              # 解说 Agent
│   │   ├── caster.ts        # Claude API streaming
│   │   └── prompts.ts
│   └── state/
│       └── cache.ts         # 侠客属性缓存
├── package.json
├── tsconfig.json
├── mcp.json                 # Claude Code 安装配置
└── README.md
```

### 4.2 Tool 定义(MCP)

共 9 个 tool,所有 tool 返回 **Markdown string**(供 agent 渲染):

| Tool | Input | 职责 |
|---|---|---|
| `wuxia_init` | - | 查钱包 / 引导登录 / 状态卡 |
| `wuxia_mint_hero` | - | 调 Arena.mintGenesis,paymaster 代付 |
| `wuxia_list_heroes` | - | 查当前账户 NFT,ASCII 卡片输出 |
| `wuxia_start_pve` | `stageId?: number` | 发 PVE 挑战,返回战报 |
| `wuxia_set_defense_team` | `heroIds: [id,id,id]` | 设防守阵容 |
| `wuxia_list_arena` | `limit?: number` | 查擂台对手列表 |
| `wuxia_challenge` | `target: address` | 向对手发起挑战,返回战报 |
| `wuxia_ai_vs_ai` | `agentA, agentB, caster?` | **核心** AI 对战演示 |
| `wuxia_replay` | `battleId` | 查历史战报 |

**Tool schema 示例**(`challenge`):

```typescript
{
  name: "wuxia_challenge",
  description: "挑战擂台上的其他侠客。会在链上模拟 3v3 战斗并返回战报。",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      useSkills: {
        type: "array",
        items: { type: "number" },
        description: "可选,指定每个侠客使用的技能 id 序列。不填则随机。"
      }
    },
    required: ["target"]
  }
}
```

### 4.3 OnchainOS 集成

| 端点 | 用途 | 文档 |
|---|---|---|
| `POST /api/v5/wallet/account/create-wallet-account` | 玩家首次 init 时建托管钱包 | WaaS Quickstart |
| `GET /api/v5/wallet/asset/balance` | 查 ETH 和 NFT 余额 | Wallet API |
| `POST /api/v5/onchain-gateway/tx/sign-and-send` | 发交易(Arena / HeroNFT) | Gateway |
| Paymaster policy | 全额赞助本项目合约方法 | 配置在 Dev Portal |
| `POST /api/v5/security/scan` | 上链前做合约交互校验 | Security |

**签名流程**(严禁 export 私钥):

```
1. Skill 组装 tx(to=Arena, data=challenge(target))
2. Skill 调 OnchainOS gateway signAndSend
3. OnchainOS 后端用托管 MPC 签名 + paymaster 代付 gas
4. 返回 tx hash 给 skill
5. Skill poll receipt → 从 event 或 view 拿战报 → 渲染
```

**认证**: skill 启动时读 env `OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE / OKX_PROJECT_ID`,HMAC 签名每一个请求。

### 4.4 State 管理

Skill 无持久化存储,所有数据在链上。本地只缓存:

```typescript
interface SkillState {
  currentPlayer?: { address: string; nickname?: string };
  heroCache: Map<bigint, Hero>;       // token id → hero 属性
  lastBattleId?: `0x${string}`;
  // 会话级,session 结束清空
}
```

### 4.5 解说 Agent(caster)

Caster 是 skill 内置的 LLM 调用层,不是独立 MCP server。当 `wuxia_ai_vs_ai` 被调用时:

```typescript
async function runCaster(events: BattleEvent[], heroes: Hero[]) {
  const prompt = buildCasterPrompt(events, heroes);
  // 把纯数据事件翻译成武侠对白
  // 例: event { actor: 唐门·飞燕, skill: 穿心刺, target: 少林·圆智, dmg: 45, crit: true }
  //    →  "只见飞燕一道寒光!穿心刺直透圆智护体罡气!暴击!"

  const stream = await anthropic.messages.stream({
    model: "claude-haiku-4-5",    // 快 & 便宜
    system: CASTER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }]
  });

  for await (const chunk of stream) {
    yield chunk.delta.text;  // 流式输出到玩家终端
  }
}
```

### 4.6 AI vs AI 策略(防掷骰子)

**绝不让 LLM 随机出招**,每次决策前给 agent 完整战场信息:

```typescript
interface AgentDecisionInput {
  mySide: HeroState[3];        // 我方状态 + buff
  enemySide: HeroState[3];     // 对方可见状态
  lastEnemyAction: BattleEvent | null;
  sectChart: Record<Sect, { counters: Sect, weakTo: Sect }>; // 门派克制
  round: number;
}

interface AgentDecisionOutput {
  actorIdx: number;
  skillId: number;
  targetIdx: number;
  trashTalk: string;  // 供解说 agent 使用的台词
}
```

Agent A 和 Agent B **不同的 system prompt**(不同流派风格),确保 counter-pick + 策略记忆。

---

## 5. ASCII 渲染规范

### 5.1 侠客卡片

```
┌─────────────────────────────────────────┐
│ 🥋 少林·圆智  Lv.1  #1234              │
│ HP ████████░░ 150/200                   │
│ ATK  80  │ DEF  95  │ SPD  60  │ CRT 5%│
│ 技能: 金钟罩 · 易筋经 · 狮子吼         │
└─────────────────────────────────────────┘
```

### 5.2 战报(streaming)

```
⚔️  江湖论剑 · Round 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🗡️  唐门·飞燕  →  穿心刺
    └─→ 少林·圆智  HP 150 → 105  (-45)  💥 暴击!

🥋 少林·圆智  →  金钟罩
    └─→ 自身 DEF +30,持续 2 回合 🛡️

...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 胜者: 你 (attacker)
⏱️  总计 9 回合
💰 江湖声望 +25
🔗 tx: 0xabc... (base-sepolia)
```

### 5.3 ANSI 颜色代码

```
暴击:   \x1b[1;31m{text}\x1b[0m   // 红加粗
治疗:   \x1b[1;32m{text}\x1b[0m   // 绿加粗
控制:   \x1b[1;35m{text}\x1b[0m   // 紫加粗
状态:   \x1b[1;33m{text}\x1b[0m   // 黄加粗
链接:   \x1b[4;36m{text}\x1b[0m   // 青下划线
```

Skill 启动时探测终端能力 `process.stdout.isTTY`,不支持时 fallback 为纯 emoji。

---

## 6. 部署 & 配置

### 6.1 合约部署(Foundry)

```bash
# .env
BASE_SEPOLIA_RPC=https://sepolia.base.org
DEPLOYER_PK=0x...
BASESCAN_KEY=...

# 部署
forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --verify

# 输出地址写入 xiake-skill/src/chain/contracts.ts
```

### 6.2 Skill 安装(用户侧)

**方式 A:Claude Code MCP 配置**

```json
// ~/.config/claude-code/mcp.json
{
  "mcpServers": {
    "wuxia": {
      "command": "npx",
      "args": ["-y", "xiake-skill"],
      "env": {
        "OKX_API_KEY": "...",
        "OKX_SECRET_KEY": "...",
        "OKX_PASSPHRASE": "...",
        "OKX_PROJECT_ID": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}
```

**方式 B:本地开发**

```bash
git clone <repo> && cd xiake-skill
npm install && npm run build
# 绝对路径配到 mcp.json 的 command
```

---

## 7. 测试策略

### 7.1 合约测试(Foundry)

| 测试类别 | 覆盖目标 |
|---|---|
| 单元(BattleEngine) | 伤害/治疗/暴击/控制 每种技能一个 case |
| 不变式(invariant) | HP 非负、SPD 排序稳定、30 回合必终止 |
| 模糊(fuzz) | 随机属性输入,确保不 revert / 不死循环 |
| 集成(Arena + HeroNFT) | mint → setDefense → challenge → read report |

**目标覆盖**: 战斗引擎 >90%,其他 >70%。

### 7.2 Skill 测试

- Tool schema 通过 `@modelcontextprotocol/sdk` 自动校验
- OnchainOS 集成用 sandbox key + mock tx
- 端到端:起本地 anvil fork base-sepolia,skill 连到本地链跑完整流程

### 7.3 Demo 演练

Day 11-12 至少演练 3 轮:
1. PVE 单人流程
2. AI vs AI + 解说
3. 故障恢复(RPC 挂、OnchainOS 429)

---

## 8. 安全注意事项

1. **🚫 严禁 export 私钥到 Claude Code 上下文** — prompt injection 风险
   - 所有签名走 OnchainOS WaaS
   - Skill 不能接受 "import private key" 这类指令

2. **Tool call 参数校验** — MCP 输入可能被恶意 agent 注入
   - Zod schema 严格校验每个 tool input
   - 地址正则 `^0x[0-9a-fA-F]{40}$`
   - 数值范围检查

3. **合约 re-entrancy** — Arena 虽然没有 ETH 转账,加 `nonReentrant` modifier 保底

4. **EIP-712 signature replay** — 用 per-player nonce

5. **OnchainOS API key 泄露** — 只存 env,不写代码仓库,`.gitignore` + pre-commit hook

---

## 9. Milestone & DoD(Definition of Done)

### Day 1 DoD(探雷)
- [ ] `okx/onchainos-skills` 本地跑通任意现有 skill
- [ ] hello-world MCP server 在 Claude Code 里被调到
- [ ] Base Sepolia 用 OnchainOS Gateway 发 tx 成功

### Week 1 DoD
- [ ] 所有合约部署到 Base Sepolia + verified
- [ ] Foundry 测试全绿
- [ ] 5 个核心 tool(init/mint/list/pve/replay)可调

### Week 2 DoD
- [ ] `wuxia_ai_vs_ai` + 解说 agent 端到端跑通
- [ ] ASCII 渲染在三种终端(Claude Code/iTerm/Windows Terminal)都正常
- [ ] Demo video 3 分钟成片
- [ ] GitHub README + pitch deck 提交

---

## 10. 关联文档

- PRD: `PRD.md`
- OnchainOS Skills: https://github.com/okx/onchainos-skills
- MCP 规范: https://modelcontextprotocol.io/docs
- Base Sepolia: https://docs.base.org/docs/network-information
- viem: https://viem.sh
- Foundry Book: https://book.getfoundry.sh
