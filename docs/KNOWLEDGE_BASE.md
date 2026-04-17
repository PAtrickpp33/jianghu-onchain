# 《江湖大乱斗》知识库

> 最后更新: 2026-04-17 · 版本 v0.2.0 (5 周迭代后)
> 用途: 冷启新 session 时,先读这份就能建立完整心智模型。

---

## 0. 一句话

**一款在 Claude Code / Cursor / Codex 里以 Skill + CLI 方式玩的全链上武侠 3v3 回合制对战游戏**。玩家不用打开任何 App / 网页 / 钱包插件,一句「玩游戏」就进入;战斗确定性、NFT 资产、抽卡经济全部在 Base Sepolia 上结算。

**Slogan:** The first game built for AI, not humans.

---

## 1. 当前状态

| 维度 | 状态 |
|---|---|
| **版本** | v0.2.0 (npm 包已配,未发布) |
| **Skill 入口** | `C:/Users/pengp/.claude/skills/wuxia-fight/skill.md` |
| **CLI 主文件** | `skill/src/cli.ts` |
| **默认模式** | `mock` (本地 RNG + state.json) |
| **链上模式** | 代码就绪,合约未 deploy |
| **5 周累计交付** | 24 个 task (init → 抽卡 v2 深化 → 成就/赛季) |
| **文档** | 5 份 (此文件 + PRD + TECHNICAL_DESIGN + REDESIGN_REPORT + BATTLE_REPORT_V2 + GACHA_PRD_TECH) |

---

## 2. 项目架构

### 2.1 目录结构

```
jianghu/
├── README.md                       原始 README
├── contracts/                      Foundry + Solidity 0.8.24
│   └── src/
│       ├── HeroNFT.sol            ERC-721 + 抽卡付费 + 伤病 + 技能解锁
│       ├── Arena.sol              PVE/PVP 战斗结算 + 章节进度
│       ├── BattleEngine.sol       纯库,确定性模拟
│       ├── SkillRegistry.sol      技能元数据
│       └── Types.sol              Hero / HeroHealth / StoryProgress struct
├── skill/                          TypeScript, npm name: wuxia-skill
│   ├── package.json               v0.2.0, bin = dist/cli.js
│   ├── README.md                  npm 包说明 (publish-eng 造)
│   ├── src/
│   │   ├── cli.ts                 ⭐ 单文件 CLI 入口 (3000+ 行,所有命令)
│   │   ├── index.ts               MCP Server (备选入口,目前未用)
│   │   ├── types.ts               共享类型
│   │   ├── utils/mode.ts          getMode() 判 mock/onchain/hybrid
│   │   ├── state/cache.ts         GameState + session 缓存
│   │   ├── chain/                 链上读写
│   │   │   ├── abi.ts             heroNftAbi / arenaAbi / battleReportTuple
│   │   │   ├── client.ts          viem publicClient
│   │   │   ├── reads.ts           批量读合约 view
│   │   │   └── decode.ts          事件解码
│   │   ├── onchainos/             OnchainOS 集成
│   │   │   ├── client.ts
│   │   │   ├── gateway.ts         ⭐ signAndSend + bypassPaymaster
│   │   │   ├── paymaster.ts
│   │   │   └── wallet.ts
│   │   ├── tools/                 MCP 工具层 (共 10 个),目前主要由 CLI 复用
│   │   ├── render/                ASCII 渲染助手 (heroCard/statusCard/etc.)
│   │   └── caster/                AI vs AI + 说书 streaming
│   └── dist/                      tsc 产物
├── docs/                           本知识库 + 其他设计文档
├── scripts/
│   ├── setup.sh                   一键部署 (未验证)
│   └── demo-ai-vs-ai.sh           AI vs AI 演示
└── demo/                           Pitch 材料
```

### 2.2 技术栈

| 层 | 技术 |
|---|---|
| 合约 | Solidity 0.8.24 + OpenZeppelin v5 + Foundry |
| 链 | Base Sepolia (chain id 84532) — 未 deploy |
| 账户/签名 | OnchainOS WaaS + Paymaster + Gateway |
| Skill | TypeScript (Node ≥ 20) |
| CLI 运行时 | bash via skill.md, `$WUXIA_CLI_PATH` 环境变量 |
| 前端 | 无 (agent-native,终端即 UI) |

### 2.3 Skill + CLI 架构决策

**不是纯 MCP,不是纯 CLI,是混合:**

```
玩家 → skill.md 触发词 → Claude 编排 → Bash "node $WUXIA_CLI_PATH <cmd>"
                                           ↓
                                     cli.ts (mock 或 onchain 分支)
                                           ↓
                                     state.json (mock) 或 OnchainOS Gateway (onchain)
```

`src/index.ts` 保留为 MCP 备选入口,目前所有流量走 CLI。

---

## 3. 核心概念

### 3.1 双模式: mock / onchain

- `WUXIA_MODE=mock` (默认): 纯本地 RNG + 战斗模拟 + state.json,无网络
- `WUXIA_MODE=onchain`: 真合约 + OnchainOS,ABI 调用通过 `gateway.signAndSend`
- `WUXIA_MODE=hybrid`: 部分 mock 部分上链,开发调试用
- **自动检测**: 未设 `WUXIA_MODE` 时,若 `WUXIA_ARENA_ADDRESS` + `WUXIA_HERO_ADDRESS` 都有 → `onchain`,否则 `mock`

### 3.2 战斗系统

- 3v3 回合制,最多 30 回合
- 每位侠客 3 技能槽 + 可解锁的额外技能珠 (id 9-16)
- 5 种技能类型: Damage / Heal / Buff / Control / Dot
- AI 出招策略: 受伤 → 优先治疗;敌 ≥ 2 → AOE 概率 40%;否则单体 damage
- 30 回合 fallback: |aHp - bHp| < 20% → 平局 (不算胜不算败),否则按总 HP 判胜

### 3.3 伤病系统

- PVE 普通关败: 随机 1 位侠客 → woundLevel=1 → 冷却 12 小时
- 章节 BOSS / 擂台败: 随机 2 位 → woundLevel=2 → 冷却 24 小时
- 冷却期间无法出战 (cmdPve/cmdPvp/cmdArena 开战前校验)
- 恢复: 自然到期 or `heal <id>` (消耗金疮药 potionCount)

### 3.4 技能珠 / 抽卡经济

**技能珠掉落:**
- PVE 胜利 20% 概率(+pityBonus 补偿) 掉 id 0-11 随机基础技能
- 章节 BOSS 保底
- 擂台胜利必掉签名技能 id 12-16
- `pityBonus` 每次未中 +5%,出珠归零(上限 80%)

**抽卡付费 (Week 4):**
- 免费路径: 3 (入坑) + 日登 1/天 (上限 7) + BOSS 首杀 +1/位
- 付费: 0.005 ETH/次 (可 `--tier bronze|silver|gold` 三档 0.001/0.005/0.01)
- 十连自动 -10%
- 30 抽派系保底 (少林→唐门→峨眉→武当)
- 80 抽限定 BOSS 签名技能珠保底
- 重复英雄 → 5 碎片 → 可 `pity-boost` 加速保底
- 推荐人首付获 0.002 ETH 卡券 (K 因子)

### 3.5 擂台 / PVP

**擂台 BOSS:** 5 位金庸名人
- `zhang-sanfeng` (武当,太极) — 签名「三丰真功」
- `guo-jing` (丐帮,降龙) — 签名「降龙十八掌·极」
- `zhou-zhiruo` (峨眉,九阴) — 签名「九阴白骨爪」
- `huang-yaoshi` (桃花岛) — 签名「碧海潮生曲」
- `ouyang-feng` (白驼山) — 签名「蛤蟆功」
- 声望 ≥ 50 解锁
- 每位每人首杀必掉技能珠

**真·PVP (Wave 1):** `pvp challenge <address>` 挑战他人 defenseTeam
- `defense <id> <id> <id>` 设置防守阵容
- `list-arena` 查擂台防守榜单 (mock 5 个假对手 / onchain 读 Arena)
- `pvp ai` 仍保留随机对战模式

### 3.6 剧情 / 章节

3 章 × 4 关 = 12 关,声望门槛 0/80/200:
- 第 1 章 入门江湖 (少林)
- 第 2 章 名剑山庄 (唐门)
- 第 3 章 华山论剑 (峨眉)
- 每章第 4 关是 👑 章节 BOSS

### 3.7 成就 / 赛季 / 复盘 (Wave 2)

- **10 个成就** 自动解锁: first_mint / three_sects / first_kill / first_pve / first_boss / first_arena / crit_master / skill_bead_collector / no_deaths_stage / chapter1_clear
- **赛季**: 14 天周期,到期自动清声望 50% + 重置 pity (mock 本地,未接合约)
- **复盘**: 保留最近 20 场完整 events + 阵容 + MVP,`replay [index]` 回放

---

## 4. CLI 命令地图 (25 条)

| 分组 | 命令 | 用途 |
|---|---|---|
| **基础** | `init` | 主菜单 + 状态卡 |
| | `status` | 战绩 / 声望 / 排名 |
| **招募** | `mint [count]` | 自动免费/付费 |
| | `mint paid [count] [--tier b/s/g] [--dry-run]` | 显式付费 |
| | `allowance` | 额度 + pity + 碎片 + 推荐人 |
| | `daily` | 领日登福利 |
| | `exchange <id> ...` | 重复兑换碎片 |
| | `refer <address>` | 设推荐人 |
| | `pity-boost <steps>` | 消耗碎片加速保底 |
| **阵容** | `heroes` | 侠客名册 |
| | `team <id> <id> <id>` | 设出战阵容 |
| | `defense <id> <id> <id>` | 设 PVP 防守阵容 |
| | `equip <heroId> <slot> <skillId>` | 装技能珠 |
| | `heal <id>` | 用金疮药解伤病 |
| | `wounds` | 查伤病 |
| **战斗** | `stages` | 关卡列表 |
| | `pve <X-Y>` | 闯关 (如 pve 1-1 / pve 3-4) |
| | `arena [slug]` | 擂台 BOSS |
| | `pvp challenge <addr>` | 挑战他人 |
| | `pvp ai` | 随机 AI 对战 |
| | `list-arena` | 擂台防守榜 |
| | `auto [N]` | AI 自主修行 N 场 |
| **进阶** | `achievements` | 成就列表 |
| | `replay [index]` | 战报回放 |
| | `season` | 赛季信息 |
| **Admin** | `admin withdraw <amount>` | 调度提款 (2 天锁) |
| | `admin execute <amount>` | 到期执行提款 |
| | `admin status` | 看待执行 |

---

## 5. 合约布局

| 合约 | 核心存储 | 关键函数 |
|---|---|---|
| **HeroNFT.sol** | `playerMintCount` / `playerAllowance(MintAllowance)` / `playerPity(PityProgress)` / `heroHealth` / `_unlockedSkills` / `shards` / `referredBy` / `exchanged` | `mintHero(to,count,isPaid)` payable / `mintHeroTier(...,tier)` / `grantBossMint` / `grantDailyMint` / `healHero` / `unlockSkill` / `exchangeDuplicate` / `setReferrer` / `pityBoost` / `scheduleWithdrawal` / `executeWithdrawal` / `setEmergencyPause` |
| **Arena.sol** | `playerProgress(StoryProgress)` / `bossFirstCleared` / `defenseTeams` | `startPve` / `challenge` / `setDefenseTeam` / `completeStage` (自动触发 grantBossMint) |
| **BattleEngine.sol** | 无 state,纯库 | `simulate(teamA, teamB, seed)` |
| **SkillRegistry.sol** | `sectSkills` | `sectSkills(sect)` view |
| **Types.sol** | struct Hero / HeroHealth / StoryProgress / MintAllowance / PityProgress / BattleReport | — |

**8 个新事件 (Week 4):** `MintAllowanceGranted` / `PaidMintProcessed` / `BossMintGranted` / `DailyMintGranted` / `PriceUpdated` / `WithdrawalScheduled` / `WithdrawalExecuted` / `EmergencyPauseToggled`

**6 个新事件 (Wave 2):** `SectPityReached` / `BossPityReached` / `DuplicateExchanged` / `PityBoosted` / `ReferrerSet` / `ReferralRewardGranted`

---

## 6. 关键决策记录 (ADR)

| # | 决策 | 理由 |
|---|---|---|
| ADR-01 | **Skill + CLI 混合架构** (非纯 MCP 非纯 CLI) | 用户需 OnchainOS 链上,但也要 Skill 入口;MCP 备用 |
| ADR-02 | **mock/onchain 双模式 via getMode()** | 离线 CI 必需;生产 demo 也需要 |
| ADR-03 | **累积 mint,移除 hasGenesisMinted** | 原 "一主三侠" 与 NFT 累积模型冲突 |
| ADR-04 | **伤病冷却用 `block.timestamp`** | 省 tx,天然计时准确 |
| ADR-05 | **技能珠用独立 mapping** | 不扩 ERC-721 metadata,戳中链上战斗就近权威 |
| ADR-06 | **抽卡 MVP 单档 0.005 ETH,v2 三档** | 先验证付费转化率,别上来就复杂 |
| ADR-07 | **提款 2-step 时间锁 2 days + 紧急暂停** | 反跑路,社区有 48h 反应窗 |
| ADR-08 | **战报 v2 分层 lite/full/epic** | 刷关用 lite,章节 BOSS/擂台用 epic |
| ADR-09 | **gacha-skill 越权代码不回滚** | Build 通过,相当于前端先行,合约跟上即可 |
| ADR-10 | **个人 owner (非 Gnosis Safe)** | MVP 快,v2 切多签 |
| ADR-11 | **平局判定 `\|a-b\| < 20%`** | 30 回合熬血按 HP 判不合理,僵局也有意义 |
| ADR-12 | **skill.md 路径用 `$WUXIA_CLI_PATH`** | 可移植,不锁 Windows 绝对路径 |

---

## 7. 红线 🚨 (玩家社区共识,不可触碰)

1. **绝对不 nerf 已抽到的 NFT 属性** — "砍卡" > "收费" > "跑路" 三毒之首
2. **BOSS 不得成为氪金卡点** — 打 BOSS 失败无损失,PVE 也能掉珠
3. **提款必须链上透明** — `getPoolBalance()` 公开 + `WithdrawalExecuted` 事件永久审计

---

## 8. 预期 / Roadmap

### 已完成 (5 周)

| Week | 交付 |
|---|---|
| 1 | 累积 mint / 双模式 / 组队 / skill.md 可移植 |
| 2 | 伤病 / 技能珠 / 12 关 / 派系多样性 |
| 3 | 上链对接 / 擂台 5 BOSS / 战报 v2 / 发布包化 |
| 4 | 抽卡经济 / 付费 / 日登 / 时间锁提款 |
| 5 (Wave1+2) | 真·PVP / heal / AI 修行 / 双保底 / 三档 / K因子 / 10成就 / replay / 赛季 |

### 未完成 (按优先级)

**Wave 3 候选 (前置于真链):**
- P2-1 派系扩展 (武当/丐帮/明教/华山) — 1 天
- P2-2 XP / 升级 — 1 天
- P2-3 装备系统 (需新 ERC-1155 合约) — 2 天
- P2-4 分享链接 (战报 URL) — 半天

**最后一步:**
- 真链部署 Base Sepolia
- OnchainOS WaaS/Gateway/Paymaster env 配齐
- 全流程真链 smoke

---

## 9. 开发约定

### 9.1 Team 工作流

- 每个 epic 派多个 agent 并行,严格工作区划分防互踩
- Agent 分两类:
  - **评审 (Explore)**: 只读分析,产出 PRD/评审意见
  - **实施 (general-purpose)**: 可写代码
- 完成后 `TaskUpdate(status=completed) + SendMessage 通知 team-lead`
- 验收后统一 shutdown

### 9.2 文件所有权 (热点)

当多 agent 改 `cli.ts` 时,必须按**函数块**划分:
- cmdMint / cmdExchange / cmdRefer / cmdPityBoost → 抽卡域
- cmdPvp / cmdSetDefense / cmdListArena → PVP 域
- cmdHeal / 金疮药逻辑 → 伤病域
- cmdAchievements / cmdReplay / cmdSeason → 进度域
- simulateBattle + renderBattleReport → 战斗核心 (不宜多人并写)
- BOSS_TEAMS / ARENA_BOSSES / SKILL_NAMES / SKILL_EFFECT → 数据区

### 9.3 硬性约束

- 每次交付必须 `cd skill && npm run build` ✅
- 合约改动必须同步 `skill/src/chain/abi.ts`
- `nonReentrant` + CEI 顺序 (state change → external call)
- 付费 mint 必须 `bypassPaymaster: true`
- 不写无 why 的注释;不做未请求的抽象

---

## 10. 评审团队历次阵容

| 主题 | 阵容 | 产出文档 |
|---|---|---|
| 游戏重设计 | 游戏策划/合约大师/Skill 编写大师/OnchainOS 对接大师 | `REDESIGN_REPORT.md` |
| 战报 v2 | 游戏策划/产品/玩家/武侠小说家 | `BATTLE_REPORT_V2.md` |
| 抽卡经济 | 合约专家/产品/玩家/Skill 专家 | `GACHA_PRD_TECH.md` |

---

## 11. 已知 bug / 遗留

| # | 问题 | 影响 | 修复方向 |
|---|---|---|---|
| B-1 | `grantDailyMint` 需玩家手动 `daily` 触发 | 生产需 cron 或 indexer | 链下 scheduler 或 skill.md 提示每日领 |
| B-2 | onchain 模式的擂台 / arena sidecar (`arena_defeated.json`) 未上链 | 跨设备不同步 | arena-eng 留的 TODO,合约加 mapping |
| B-3 | "三派汇流" 成就进度显示 `1/1` 但未标 ✅ | UX 瑕疵 | checkAchievements 逻辑小 bug |
| B-4 | 战斗偶现重名展示 | 仅视觉 | 已部分修 (BOSS 加后缀),可继续加 owner 前缀 |
| B-5 | `battleReportTuple` 与合约 struct 字段一致性需回归 | onchain replay 有风险 | legacy-eng 已补齐,但需合约真部署后验证 |
| B-6 | MCP server (`src/index.ts`) 长期未用 | 死代码 | 先留作备选,v2 若发 npm 再决定 |

---

## 12. 文档索引

| 文档 | 定位 |
|---|---|
| `README.md` (项目根) | Hackathon pitch + 5 秒钩子 |
| `docs/PRD.md` | 原始 v1.0 产品需求 (2026-04-16) |
| `docs/TECHNICAL_DESIGN.md` | 原始技术设计 (早于 5 周迭代) |
| `docs/REDESIGN_REPORT.md` | Week 0 重设计报告 + SOP-01 |
| `docs/BATTLE_REPORT_V2.md` | 战报 UX v2 方案 |
| `docs/GACHA_PRD_TECH.md` | 抽卡 PRD + 技术方案 |
| `docs/KNOWLEDGE_BASE.md` | **本文** · 冷启知识库 |
| `skill/README.md` | npm 包用户文档 |
| skill.md (用户目录) | Claude Code Skill 指令 |

---

## 13. 冷启 Checklist (新 session 开工前)

1. 读此文 §0-§3 建立心智模型
2. 读 `skill/src/cli.ts` 的 main switch (§4 命令地图对应)
3. 扫 `contracts/src/HeroNFT.sol` + `Arena.sol` 看最新合约表面积
4. 检查 `git log --oneline -20` 看最近 20 次改动
5. 必要时 `node dist/cli.js init` 实测当前状态 (mock)
6. 未决策问题在 §8 Roadmap 找,或问用户

---

**维护约定**: 每次 Week 迭代完成后,更新此文 §1 状态、§8 已完成、§6 新增 ADR。
