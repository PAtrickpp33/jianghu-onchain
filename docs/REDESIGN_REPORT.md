# 《江湖大乱斗》改进报告 v1.0

> 评审日期: 2026-04-17
> 评审团: 游戏策划 / 合约大师 / Skill 编写大师 / OnchainOS 对接大师
> 协调: lead-architect (team: jianghu-redesign)

---

## 0. 问题诊断 (现状)

| # | 问题 | 出处 | 严重度 |
|---|---|---|---|
| P-01 | "一主三侠" 硬限制: `mint` 在 `heroes.length > 0` 时直接拒绝,与 NFT 累积模型冲突 | `skill/src/cli.ts:153-155` | 🔴 |
| P-02 | `HeroNFT.mintGenesis` 一次性限制 `hasGenesisMinted[to] = true` | `contracts/src/HeroNFT.sol:27,77` | 🔴 |
| P-03 | 无伤病/冷却状态机,战败即重来,缺乏策略深度 | 全局缺失 | 🟡 |
| P-04 | 技能槽恒为 3,无习得新技能机制 | `Types.Hero.skillIds` | 🟡 |
| P-05 | CLI 只跑 mock,链上模式不可达 | `skill/src/cli.ts` | 🟡 |
| P-06 | skill.md 硬编码 Windows 绝对路径,不可移植 | `~/.claude/skills/wuxia-fight/skill.md:21,79` | 🔴 |
| P-07 | MCP Server + CLI 双实现重复,身份混乱 | `src/index.ts` vs `src/cli.ts` | 🟡 |
| P-08 | Frontmatter `triggers` 非官方字段,应为 `when_to_use` | `skill.md:4` | 🟡 |
| P-09 | `isMockMode()` 判断散落各处,无统一模式切换 | `skill/src/tools/mintHero.ts:26` | 🟢 |

---

## 1. 玩家旅程 SOP-01 (权威)

> 本 SOP 是 skill.md 指导 Claude 编排玩家动作的权威依据。

```
 ┌──────────────┐     首次             ┌──────────────┐
 │  进入游戏    │ ────────────────▶   │  招募侠客    │
 │  (init)      │                     │  (mint)      │
 └──────┬───────┘                     └──────┬───────┘
        │ 已有侠客                           │
        ▼                                    ▼
 ┌─────────────────────────────────────────────────┐
 │              主菜单 (状态卡)                    │
 │  声望 / 侠客数 / 伤病中 / 当前章节              │
 └─┬───────┬──────────┬──────────┬──────────┬─────┘
   │       │          │          │          │
   ▼       ▼          ▼          ▼          ▼
 ┌────┐ ┌────┐   ┌─────────┐ ┌──────┐ ┌──────┐
 │闯关│ │擂台│   │ AI 对战 │ │疗伤  │ │习得  │
 │PVE │ │BOSS│   │  PVP    │ │      │ │技能  │
 └─┬──┘ └─┬──┘   └────┬────┘ └──┬───┘ └──┬───┘
   │      │           │         │        │
   └──────┴───────────┴─────────┴────────┘
                      │
                      ▼
              ┌──────────────┐
              │ 战报 + 说书  │
              │ 状态更新     │
              └──────┬───────┘
                     ▼
                  回主菜单
```

| # | 玩家输入 | 触发动作 | 状态变化 |
|---|---|---|---|
| 1 | "玩游戏" / "/wuxia-fight" | `init` → 展示状态卡 + 主菜单 | 无 |
| 2 | "招募侠客" | `mint` — **可累积**,每次 1-3 位 | `heroes[]` 追加,`playerMintCount++` |
| 3 | "查看侠客" | 列出所有持有侠客 + 装备技能 | 无 |
| 4 | "组队 [id1,id2,id3]" | 设置出战阵容 (为下次战斗准备) | `activeTeam = [...]` |
| 5 | "闯 X-Y 关" | `pve X-Y` — 当前阵容战章节 X 的第 Y 关 | 胜: `reputation += stage*50`,20% 概率掉技能珠;败: 1-2 位侠客进入冷却 |
| 6 | "擂台 [BOSS]" | `arena <bossId>` — 打名人 BOSS (声望 ≥ 50 解锁) | 胜: 高声望 + 签名技能珠;败: 重伤冷却更长 |
| 7 | "AI 对战" | `pvp` — 匹配随机/链上防守阵容 | 胜: 声望+25;败: 冷却 |
| 8 | "查看伤病" | 列出受伤侠客 + 剩余冷却 | 无 |
| 9 | "疗伤 [heroId]" | 消耗金疮药 → 清伤病 (v2) | `heroHealth[id].cooldownUntil = 0`,`potionCount--` |
| 10 | "习得技能 [heroId]" | 从该侠客的技能珠池选 1 个装备 | 替换现技能槽 / 存入已学池 |
| 11 | "战绩" | 显示胜负、声望、章节进度、排行 | 无 |

**SOP 硬约束:**
- 任何战斗前,检查 `heroHealth[id].cooldownUntil <= now`,带伤不得出战
- 任何写操作,走统一 `getMode()` 分发到 mock 或 onchain 路径
- 战报渲染一律返回结构化 Markdown,说书由 Claude (skill persona) 事后润色

---

## 2. 核心玩法改进

### 2.1 伤病机制 (Wound System)

| 项 | 设计 |
|---|---|
| **触发** | PVE/PVP 失败 → 随机 1-2 位出战侠客获得 `woundLevel=1` (轻伤) 或 `2` (重伤,BOSS 战) |
| **效果** | `cooldownUntil = now + (12h * woundLevel)` 期间不能出战 |
| **自然恢复** | 时间到期自动清 `woundLevel=0` (链上用 `block.timestamp` 判断,无需 tx) |
| **主动疗伤** | 消耗 "金疮药" (`potionCount--`) 立即清伤 — v2 引入 |
| **设计意图** | 强制轮换侠客,防止单核心碾压;为 v2 道具/医疗 NPC 铺垫 |

### 2.2 技能习得 (Skill Unlock)

| 项 | 设计 |
|---|---|
| **掉落** | PVE 胜利 20% 概率掉 "技能珠",绑定到出战随机侠客 |
| **擂台 BOSS** | 击败名人 BOSS 必掉其签名技能珠 |
| **存储** | `unlockedSkills[tokenId] = uint8[]` 独立映射,不扩 NFT metadata |
| **装备** | 基础 3 技能槽 + 已学池,玩家可随时装配 (替换需经 `equipSkill(tokenId, slot, skillId)` 动作) |
| **技能池 MVP** | 现有 9 + 3 BOSS 签名 = 12 个 |

### 2.3 剧情章节 (3 章 × 4 关 = 12 关)

```
第一章 · 入门江湖 (声望 ≥ 0)
 1-1 少林藏经阁 (玄苦)    1-2 少林达摩堂 (空见)
 1-3 唐门毒障 (飞燕)       1-4 少林绝技 (渡劫) [章节BOSS]

第二章 · 名剑山庄 (声望 ≥ 80)
 2-1 山庄试剑 (张无忌)    2-2 激战石壁 (杨逍)
 2-3 峨眉秘地 (周芷若)     2-4 山庄决战 (谢逊) [章节BOSS]

第三章 · 华山论剑 (声望 ≥ 200)
 3-1 华山绝顶 (岳不群)     3-2 三招决胜 (令狐冲)
 3-3 紫霞秘功 (小龙女)     3-4 武林第一 (张三丰) [终极BOSS]
```

### 2.4 名人擂台 BOSS (v2 扩展)

| BOSS | 派系 | 特色机制 | 签名技能 |
|---|---|---|---|
| 张三丰 | 武当 | 每回合回 20 HP | 太极真功 (+30 DEF 2 回合) |
| 郭靖 | 丐帮 | 伤害递增 +10%/回合 | 降龙十八掌 (群体 200%) |
| 周芷若 | 峨眉 | 每回合全队治疗 | 乾坤大挪移 (转伤害) |
| 黄药师 | 桃花岛 | 每轮眩晕 1 人 | 碧海潮生曲 (沉默 ATK) |
| 欧阳锋 | 白驼山 | 中毒伤害递增 | 蛤蟆功 (群体 DoT) |

---

## 3. 合约改动清单

| 优先级 | 改动 | 文件 | 工作量 |
|---|---|---|---|
| 🔴 P0 | 移除 `hasGenesisMinted`,改 `playerMintCount: uint256` + `mintHero(to, count)` | `HeroNFT.sol` | 2h |
| 🟡 P1 | 新增 `HeroHealth { woundLevel, cooldownUntil, potionCount }` + `heroHealth` 映射 | `HeroNFT.sol` | 3h |
| 🟡 P1 | 新增 `unlockedSkills[tokenId] => uint8[]` + `SkillUnlocked` 事件 | `HeroNFT.sol` | 2h |
| 🟢 P2 | 新增 `StoryProgress { currentChapter, bossDefeated[], totalExp }` | `Arena.sol` | 2h |
| 🟢 P2 | Arena 战前检查 `heroHealth[id].cooldownUntil <= now` | `Arena.sol` / `BattleEngine.sol` | 1h |
| 🔵 P3 | 金疮药库存 + `healHero()` (paymaster 友好,无 msg.value) | `HeroNFT.sol` | 1d |

**Paymaster 兼容注意:** 新增的 `healHero / unlockSkill / rest` 均**不得** `payable`,由 OnchainOS paymaster policy 承担 gas。

---

## 4. Skill 架构决策

**采纳方案 A (纯 MCP) + 方案 B 的 Skill 指令层**,混合如下:

- **MCP Server (`src/index.ts`)** 是事实真相,所有玩家动作走 MCP 工具调用,不再通过 Bash 调 CLI
- **保留 `cli.ts`** 仅作为 CI/E2E 测试入口 (`npm test` / `foundry test` 验证)
- **skill.md** 只剩 3 件事: ① 触发词 ② SOP-01 编排规则 ③ 说书人 persona

### 4.1 skill.md 重构骨架

```yaml
---
name: wuxia-fight
description: 江湖大乱斗 — 3v3 武侠回合制对战,支持剧情关卡、名人擂台、PVP。
when_to_use: 玩游戏、江湖大乱斗、闯关、招募侠客、AI对战、擂台、查看侠客
allowed-tools: mcp__wuxia__*
---

# 你是江湖说书先生

**编排规则**: 严格按 SOP-01 调用 MCP 工具 (见 docs/REDESIGN_REPORT.md §1)。CLI 返回的战报数据是权威,你只润色文字。

**说书风格**: 少林刚猛、唐门阴险、峨眉柔中带刚;暴击渲染"只见寒光一闪";击杀加"应声倒地";每场末了总结 MVP。

**硬规则**:
- 数据来自 MCP,不得编造
- 战败必触发伤病,提示玩家下一步 (疗伤 / 换人)
- 意图不明时,调 `wuxia_init` 回主菜单
```

### 4.2 可移植性修复

| 项 | 改动 |
|---|---|
| 路径 | 删除所有 `D:\项目\jianghu\...`,改走 MCP (无需路径) |
| Frontmatter | `triggers` → `when_to_use` |
| 描述长度 | 压缩到 ≤ 200 字符 |
| Persona | 从 30 行压到 5 行 |

---

## 5. 双模式策略 (本地 / 链上)

### 5.1 模式切换

```bash
WUXIA_MODE=mock     # L0 — 纯本地,默认 (CI / 离线测试)
WUXIA_MODE=onchain  # L3 — 真 OnchainOS + Base Sepolia (生产)
WUXIA_MODE=hybrid   # L1/L2 — 开发调试,viem/gateway 层 mock
```

### 5.2 Mock 分层 (保真度 vs 速度)

| 层 | 范围 | 用途 | 延迟 |
|---|---|---|---|
| **L0 纯 mock** | tool layer 内完成 RNG + 战斗 | CLI 默认 / 离线测试 | < 100ms |
| **L1 viem mock** | 模拟 ABI 调用,无真实签名 | 单元测试 | < 200ms |
| **L2 gateway mock** | 返回 fake txHash,编码路径真实 | 集成测试 | < 500ms |
| **L3 生产** | 真 OnchainOS + Paymaster + RPC | Demo / 实战 | 2-5s |

### 5.3 统一入口

```ts
// src/utils/mode.ts (新增)
export type Mode = "mock" | "onchain" | "hybrid";
export function getMode(): Mode {
  const explicit = process.env.WUXIA_MODE as Mode | undefined;
  if (explicit) return explicit;
  return (process.env.WUXIA_ARENA_ADDRESS && process.env.WUXIA_HERO_ADDRESS) ? "onchain" : "mock";
}
```
所有 tools 的 `isMockMode()` 替换成 `getMode() === "mock"`。

### 5.4 错误处理

- `signAndSendWithRetry()`: 最多 3 次 + 指数退避 (1s → 2s → 4s)
- 错误分级: `E_CONFIG` / `E_VALIDATION` 直接失败;`E_TIMEOUT` / `E_NETWORK` 重试
- 玩家提示: 1 次失败静默重试;2-3 次显示 "正在重发...";终败给原因 + 建议

### 5.5 新动作 TX → Paymaster 映射

| 动作 | 合约调用 | Paymaster 赞助 |
|---|---|---|
| mintHero | `HeroNFT.mintHero` | ✅ 全额 |
| 闯关/擂台 | `Arena.startPve` | ✅ 全额 |
| PVP | `Arena.challenge` | ✅ 全额 |
| 学技能 | `HeroNFT.unlockSkill` | ✅ 全额 |
| 装技能 | `HeroNFT.equipSkill` | ✅ 全额 |
| 疗伤 | `HeroNFT.healHero` | ⚠️ 条件赞助 (防刷) |

---

## 6. 落地节奏

### Week 1 (MVP 基线)
- [ ] P0: 移除 `hasGenesisMinted`,`mintHero` 支持累积 + 修 `cli.ts:153`
- [ ] 统一 `getMode()`,CLI 支持 `WUXIA_MODE` env
- [ ] 新增 "组队" 概念 — 出战 3 人从池中选 (默认最后登记的 3 位)
- [ ] skill.md 路径修复 + frontmatter `when_to_use`
- [ ] L0 mock 模式下所有 SOP 步骤跑通

### Week 2 (核心新玩法)
- [ ] P1: `HeroHealth` + 伤病冷却,战败触发
- [ ] P1: `unlockedSkills` + 技能珠掉落 (20% 概率)
- [ ] 扩展 4 关 → 12 关 (3 章节)
- [ ] Arena 章节进度事件
- [ ] L3 生产模式 + Paymaster 预检

### Week 3+ (v2 扩展)
- [ ] 名人擂台 5 个 BOSS + 签名技能
- [ ] 疗伤指令 + 金疮药库存
- [ ] 技能装备/替换 UI
- [ ] AI 自主修行 (夜间多轮对战)
- [ ] 发布 npm + MCP Registry

---

## 7. 待决策点

| # | 问题 | 建议 |
|---|---|---|
| Q1 | 选方案 A (纯 MCP) 还是 B (纯 CLI)? | **A**,删除 `cli.ts` 作为主入口,保留为测试 |
| Q2 | 伤病冷却用链上时间戳还是链下 tick? | **链上** `block.timestamp`,无需额外 tx |
| Q3 | 技能珠是 ERC-721 / ERC-1155 还是仅 mapping? | **mapping** (省 gas),v3 视情况 token 化 |
| Q4 | 金疮药是链上余额还是链下计费? | **链上 potionCount** + paymaster 条件赞助 |

---

## 附录 · 评审归属

| 章节 | 主笔 |
|---|---|
| §1 SOP / §2 玩法 / §6 节奏 | game-designer |
| §3 合约改动 | contract-master |
| §4 skill.md 重构 | skill-author |
| §5 双模式策略 | onchainos-master |
| §0 / §7 / 合流 | lead-architect |
