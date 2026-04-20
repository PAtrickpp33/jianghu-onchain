# ⛩️ 侠客擂台 · Xiake Arena

> **首款为 AI 而生的链游。**
> 一个 Claude Code skill。一条斜杠命令,整个江湖在链上开打。不用网站、不装钱包插件、不记助记词。

**🌐 语言**: [English](./README.md) · **中文**

[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-5B5BD6)](https://claude.ai/code) [![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io) [![Base Sepolia](https://img.shields.io/badge/Base_Sepolia-已部署-0052FF)](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) [![OnchainOS](https://img.shields.io/badge/OnchainOS-已集成-00d1b2)](https://web3.okx.com/onchain-os/dev-portal) [![Tests](https://img.shields.io/badge/forge_tests-114/114_全绿-brightgreen)](./docs/C_LEVEL_TEST_SUMMARY.md) [![License](https://img.shields.io/badge/license-MIT-green)](#license)

<img width="1148" height="527" alt="Xiake Arena in Claude Code" src="https://github.com/user-attachments/assets/1ee71082-7a06-4a67-b79e-f83799293f01" />

---

## ⚡ 60 秒电梯 Pitch

Web3 游戏之所以死得快,是因为把人类推进浏览器 dApp、助记词、gas 弹窗的地狱。但 **AI Agent 已经是互联网的新主力用户** — 它们读文档、持钱包、自动上链。

**侠客擂台** 是一款 **七大门派 · 3v3 武侠对战链游**,你只需要在 Claude Code 里敲 `/xiake` 就能玩。Skill 自动通过 OKX OnchainOS 开 MPC 钱包,调用 Base 链上纯 Solidity 战斗引擎,再用金庸式白话替你解说整场打斗 — 一条斜杠命令全搞定。

```bash
$ claude
> /xiake
⛩️  你尚无门徒。要招募 3 位侠客吗?(gas 由 Paymaster 代付)
> yes
🥋 少林·圆智   ⚔️ 华山·令狐冲   🔥 明教·张无忌   🔗 tx 0x7a03… on Base
```

**无网页 · 无插件 · 无助记词 · 无私钥管理。**

---

## 🎯 为什么重要

| | |
|---|---|
| **Agent-Native 交互** | "UI" 就是一个 skill.md + CLI。在 Claude / Cursor / Codex 里说 `/xiake`,说书人接管对话,上链交易在幕后完成。 |
| **零摩擦钱包** | OnchainOS MPC 钱包 + Paymaster 白名单:第一次上手的玩家不需要管私钥、不需要持有 ETH、不需要面对弹窗。 |
| **完全上链确定性** | `BattleEngine.simulate()` 是纯 Solidity 函数。30 回合、七环相克、一个 PRNG 种子。无 oracle、无隐藏服务器,链下可完整重放。 |
| **AI vs AI** | 两个 Agent 可以自动对打,第三个 caster Agent 用金庸式语言解说。整场比赛只靠一个 `BattleLog` 事件就能重现。 |

---

## 🏛️ 项目架构

```
 ┌─────────────────────────────────────────────────────────────┐
 │  玩家在 Claude Code / Cursor / Codex 中                     │
 │  输入: /xiake                                               │
 └──────────────────────┬──────────────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │  xiake-skill (TypeScript)  │  ~/.claude/skills/xiake/
          │  说书人 + CLI + 渲染       │  9,606 行
          └─────────────┬──────────────┘
                        │ 签名 & 路由交易
          ┌─────────────▼──────────────┐
          │  OnchainOS WaaS + Paymaster│  OKX Dev Portal
          │  MPC 钱包 · gas 代付       │
          └─────────────┬──────────────┘
                        │ 上链
 ┌──────────────────────▼──────────────────────────────────────┐
 │  Base (当前 Sepolia · 下一步 Mainnet)                       │
 │                                                             │
 │    HeroNFT ── 转发付费 ──→ GachaVault (48 小时 timelock)    │
 │       │                                                     │
 │       ├── setArena ───────→ Arena (v3)                      │
 │       │                        │                            │
 │    SkillRegistry ←── 调用 ─────┤                            │
 │                                ├── 读取 ──→ StageRegistry   │
 │                                │                            │
 │                                └── 模拟 ──→ BattleEngine    │
 │                                                │            │
 │                                    调用 ──→ SectAffinity    │
 └─────────────────────────────────────────────────────────────┘
```

**2,579 行 Solidity · 7 个合约 · 5 部署 + 2 库** — 设计细节见 [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)。

---

## 🌍 Base Sepolia 在线部署

**截至 2026-04-20**:已结算 21 场战斗 · 铸造 21 位侠客 · 金库累积 0.014 ETH · 注册 13 个关卡 — 全部可在 BaseScan 核验。

| 合约 | 地址 |
|---|---|
| **Arena v3** (对战入口) | [`0x567aE39f…FcC61`](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) |
| **HeroNFT** (侠客 NFT + 抽卡) | [`0x056bB8B1…0f4A`](https://sepolia.basescan.org/address/0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A) |
| **GachaVault** (48 小时 timelock 金库) | [`0x47135Ba1…18A44`](https://sepolia.basescan.org/address/0x47135Ba1F3D9674869a63da07f40e42a57318A44) |
| **StageRegistry** (关卡表) | [`0x613497e2…9df7`](https://sepolia.basescan.org/address/0x613497e20D196952f169B316fd7Ad8f8eb519df7) |
| **SkillRegistry** (武功表) | [`0xC1b36B70…f3E1`](https://sepolia.basescan.org/address/0xC1b36B703A349e2fB1B29c4B912C3144Ab69f3E1) |

Skill 每一次上链动作都会输出 `🔗 <动作名> · tx 0x… · basescan.org/tx/…`,评审点进去就能验证。

---

## 🚀 60 秒上手

### Mock 模式 · 离线零配置

```bash
git clone https://github.com/pengpatrick123/Xiake-onchain && cd Xiake-onchain/skill
npm install && npm run build
export XIAKE_CLI_PATH="$PWD/dist/cli.js"

claude
> /xiake
> 招募一个侠客          # 或 mint 1
> 闯第一关              # 或 pve 1-1
```

### Sepolia 模式 · 真实上链,免费水龙头 ETH

```bash
cast wallet new                    # 生成一次性测试网钱包
# 领水:https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

export XIAKE_MODE=sepolia
export XIAKE_PLAYER_PK=0x...       # cast wallet new 输出的私钥
# 合约地址已在 .env.example 预填好

claude
> /xiake
> 领取每日签到
```

```
✅ 今日福利已领取!本周累积 1/7
🔗 grantDailyMint · tx 0xc1e02a…6006 · https://sepolia.basescan.org/tx/0xc1e02ab6…
```

| 模式 | 链 | 签名方 | Gas | 用途 |
|---|---|---|---|---|
| `mock` (默认) | — | — | — | 离线试玩 |
| `sepolia` | Base Sepolia | 本地私钥 | 玩家出(水龙头免费) | Hackathon 演示 |
| `onchain` | Base Mainnet | OnchainOS MPC | Paymaster 代付 | 生产环境 |

---

## 📚 深入阅读

- **架构与合约全景图** — [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)
- **完整测试报告(6 阶段,45+ 上链 tx,9 个 AI Agent 并发)** — [docs/C_LEVEL_TEST_SUMMARY.md](./docs/C_LEVEL_TEST_SUMMARY.md)
- **测出并热修的两个 bug(P0 章节推进 / P1 声望门槛)** — [docs/TEST_FINDINGS.md](./docs/TEST_FINDINGS.md)
- **如何在不重新部署的情况下新增门派/关卡** — [docs/CONTENT_UPDATES.md](./docs/CONTENT_UPDATES.md)
- **Sepolia 部署 runbook** — [docs/DEPLOY_PLAYBOOK.md](./docs/DEPLOY_PLAYBOOK.md)
- **各合约代码评审** — [docs/CODE_REVIEW.md](./docs/CODE_REVIEW.md)

### 关键数字

2,579 行 Solidity · 9,606 行 TypeScript · **114/114 forge 单测全绿** · 4 条 invariant × 2,048 次随机操作 · 2 个生产 bug 实战中发现并通过 `UpgradeArena.s.sol` 热升级修复(已验证两次)。

### 技术栈

**合约** — Foundry · OpenZeppelin v5 · Solidity 0.8.24
**Skill** — TypeScript · viem · axios · MCP · Anthropic SDK
**基础设施** — OKX OnchainOS (WaaS · Paymaster · Gateway) · Base Sepolia

---

## 📜 许可

MIT。提交给 **OnchainOS × Claude Code Hackathon · 2026-04**。

每一次 commit 都由 **Claude Opus 4.7 (1M context)** 结对编程完成。
