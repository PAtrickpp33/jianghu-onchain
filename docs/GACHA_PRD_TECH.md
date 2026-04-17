# 抽卡经济 · PRD + 技术方案 v1.0

> 评审日期: 2026-04-17
> 评审团: gacha-contract / gacha-pm / gacha-player / gacha-skill
> 决策风险标注: 🚨 = 玩家社区共识"红线"

---

## 0. 设计原则

**核心一句话:** 付费不是惩罚，是**加速**；所有机制**让玩家看见**，没有隐藏的捕获。

**四方共识红线:**
- 🚨 **绝对不 nerf 抽到的角色** — player 评审明示: "砍卡 > 收费本身 > 开发者跑路" 三者皆是致命毒
- 🚨 **BOSS 不得成为氪金卡点** — 若强制打 BOSS 过关需付费，F2P 玩家 D1 即流失
- 🚨 **提款透明** — 池子余额、历史提款可链上查询

---

## 1. 产品 PRD

### 1.1 免费额度机制

| 路径 | 给几次 | 条件 | 目的 |
|---|---|---|---|
| **新玩家入坑** | 3 次 | 首次 `init` 时初始化 | 体验 MVP |
| **日登福利** | 1 次/天 | 首周每日领 (7 天 × 1) | 留存驱动，对标 Mir4 |
| **BOSS 首杀** | 1 次/每位 BOSS | 每位擂台 BOSS 只给首次 | 探索激励 |
| **梯度里程** | 1 次 ("进阶抽") | 累计击败 3 位不同 BOSS | 广度驱动 |
| **排行赛季** (v2) | 1 次保底重置 | 双周 Top 100 | 鲸鱼互卷 |

**首周合计:** 3 (入坑) + 7 (日登) + 0-5 (BOSS) = **10-15 次**，远超 gacha-contract 提案的 "仅 3+1"（player 评审认为 3+1 严重不够）。

### 1.2 付费定价表

| 档位 | 单抽 (ETH) | 十连 (-10%) | USD 参考 | 定位 |
|---|---|---|---|---|
| 铜票·体验 | 0.001 | 0.009 | $2.5 / $22.5 | 无感试水 |
| **银票·主流** ⭐ | **0.005** | **0.045** | **$12.5 / $112.5** | **65% 用户** |
| 金票·冲刺 | 0.01 | 0.09 | $25 / $225 | 鲸鱼/冲榜 |

**MVP 简化版:** 只上**银票单档 0.005 ETH**，v2 再扩三档。合约 `PRICE_PER_MINT` 保留可调。

### 1.3 双保底机制

- **30 抽保底:** 必出当周期指定派系 (少林→唐门→峨眉→武当，四周轮换)
- **80 抽保底:** 必出限定 BOSS 签名技能珠 ("降龙十八掌·极" 等 5 枚)

**透明度:** `allowance` 命令显示 `[████░░░░░░] 6/30 距派系保底`。

### 1.4 惜败/重复兑换

- 已实装的 **`pityBonus` 惜败彩蛋** (+5%/场) 保留，扩展到抽卡
- **重复英雄兑换**: 1 个重复 = 5 "声望碎片"，5 碎片 = +1 抽保底进度
- 让 "白花钱" 变为 "部分收益"，降低挫败感

### 1.5 留存目标

| 指标 | 目标 | 对标 |
|---|---|---|
| D1 留存 | 65% | Mir4 48% / Axie 35% |
| D7 留存 | 32% | Axie 18% / CK 12% |
| D30 留存 | 14% | CK 8% / Axie 9% |
| D1 首充率 | 8% | Axie 5% |
| 首充→复充 | 45% | Baseline 31% |
| 月均 ARPU | $28 | Mir4 $22 |

### 1.6 nerf 预案（🚨 红线保护）

- 任何调整必须**提前 7 天公告**
- 下调必须**等值补偿卡券**（基于历史充值额度）
- 每周公开掉落率/胜率统计
- 每月开发者社区 Q&A
- 承诺: **已抽到的 NFT 属性永不下调**（代码层面加锁 + 治理声明）

### 1.7 开发者提款透明度

- `getPoolBalance()` 合约公开函数，任意 RPC 可查
- 链上 `WithdrawalExecuted` 事件永久审计
- 游戏内 `status` 命令显示 `🏦 池余额: X ETH / 历史提款: Y ETH`
- 每月生态报告: 入池 / 出池 / 储备 / 健康指标 (目标: 提款 < 入池 5%)

---

## 2. 技术方案

### 2.1 合约数据结构

```solidity
// HeroNFT.sol
struct MintAllowance {
    uint8 freeGranted;       // 初始 3
    uint8 earnedFromBoss;    // BOSS 奖励累积
    uint8 earnedFromDaily;   // 日登累积
    uint16 usedPaid;         // 累计付费次数
}
mapping(address => MintAllowance) public playerAllowance;
mapping(address => mapping(uint8 => bool)) public bossFirstCleared;

// 保底进度
struct PityProgress {
    uint16 currentCount;     // 连续未中次数
    uint8 sectCycle;         // 当前轮派系 (0=shaolin ... 3=wudang)
}
mapping(address => PityProgress) public playerPity;
```

### 2.2 核心函数签名

```solidity
// 改造现有
function mintHero(address to, uint8 count, bool isPaid)
    external payable nonReentrant whenNotPaused
    returns (uint256[] memory tokenIds);

// 新增
function grantBossMint(address player) external onlyArena;
function grantDailyMint(address player) external onlyGame;  // cron 触发
function exchangeDuplicate(uint256[] tokenIds) external;    // 兑换进度
function getMintAllowance(address player) external view
    returns (uint8 free, uint8 boss, uint8 daily, uint16 paid, uint8 remaining);
function getPoolBalance() external view returns (uint256);

// 提款 (2-step + 时间锁)
function scheduleWithdrawal(address target, uint256 amount) external onlyOwner;
function executeWithdrawal(uint256 amount) external onlyOwner nonReentrant;
function setEmergencyPause(bool paused) external onlyOwner;
```

### 2.3 事件清单

```solidity
event MintAllowanceGranted(address indexed player, string source, uint8 amount);
event PaidMintProcessed(address indexed player, uint8 count, uint256 totalCost);
event BossMintGranted(address indexed player, uint8 bossId);
event DailyMintGranted(address indexed player, uint8 day);
event PityProgress(address indexed player, uint16 currentCount, uint16 target, string nextReward);
event DuplicateExchanged(address indexed player, uint256[] tokenIds, uint8 progressGained);
event PriceUpdated(uint256 oldPrice, uint256 newPrice);
event WithdrawalScheduled(uint256 amount, uint256 executeTime);
event WithdrawalExecuted(uint256 amount, address indexed target);
event EmergencyPauseToggled(bool paused);
```

### 2.4 Arena 联动

```solidity
// Arena.sol
function completeStage(address player, uint8 bossId) external onlyGame {
    // 既有逻辑...
    if (bossId >= 5 /* 擂台 BOSS id 起点 */
        && !bossFirstCleared[player][bossId]) {
        bossFirstCleared[player][bossId] = true;
        heroNft.grantBossMint(player);
    }
}
```

### 2.5 OnchainOS 兼容

- **免费 mint** → Paymaster 赞助（按现有策略）
- **付费 mint** → **必须显式 bypass paymaster**:
  ```typescript
  signAndSend({
      to: heroAddr,
      data: encoded,
      value: 0.005 * 1e18,
      bypassPaymaster: true   // 新增参数
  });
  ```
- 玩家付费时 OnchainOS 会让玩家显式确认 ETH 余额

### 2.6 提款机制（🚨 反跑路设计）

1. `scheduleWithdrawal(target, amount)` → 记录 `executeAfter = now + 2 days`
2. **链上事件公开** → 社区有 48h 反应时间
3. `executeWithdrawal(amount)` → 转账到 target
4. **多签推荐:** `target` 设为 Gnosis Safe
5. **紧急暂停:** `setEmergencyPause(true)` 可立即停止新 mint 与提款

### 2.7 安全检查清单

**重入:**
- `mintHero` / `executeWithdrawal` 加 `nonReentrant`
- refund 逻辑在状态改变**之后**

**权限:**
- `mintHero(isPaid=true)` 公开（任何人付）
- `grantBossMint` / `grantDailyMint` 仅 Arena/Game
- `scheduleWithdrawal` / `executeWithdrawal` / `setEmergencyPause` 仅 owner
- **建议**: owner 改 Gnosis Safe 多签

**经济:**
- `usedPaid: uint16` 足够 (65535 次)
- 防整数溢出: Solidity 0.8.24 自带 + 显式类型
- `PRICE_PER_MINT` owner 可调，但必须触发 `PriceUpdated` 事件

**MEV:**
- 单笔 ≤ 3 NFT = 0.03 ETH，MEV 吸引力低
- 价格不依赖预言机，无 oracle 攻击面
- `lastPaidMintTime` 防连续 mint 前置

---

## 3. CLI / Skill 层

### 3.1 命令表（gacha-skill 已落地）

| 命令 | 用途 | 示例 |
|---|---|---|
| `mint [N]` | 自动判断免费/付费 | `mint 1` |
| `mint paid [N]` | 显式付费 | `mint paid 10` |
| `mint paid [N] --dry-run` | 预览不执行 | 防手滑 |
| `allowance` | 额度卡（免费/BOSS/付费价） | — |
| `admin withdraw [amount]` | 开发者提款（owner 签） | 2 天锁 |

### 3.2 allowance 卡样式

```
┌─ 免费额度状态 ──────────────────────────────┐
│ 📅 本周剩余: 5/5 (7 天后重置)                │
│ 🏆 BOSS 奖励: 2  (击败 张三丰 / 郭靖)         │
│ 💰 付费补充: 0.005 ETH/次 (无频率限制)       │
│                                            │
│ 🎁 保底进度: [████░░░░░░] 6/30 (距派系保底) │
│                                            │
│ 快速操作:                                   │
│  • mint 1          — 免费抽 (剩余 5)         │
│  • mint paid 1     — 付费抽                 │
│  • mint paid 10    — 十连 (-10%)             │
└────────────────────────────────────────────┘
```

### 3.3 错误提示表

| 场景 | 文案 | 下一步 |
|---|---|---|
| 额度用完 | "本周免费已用完,下次 BOSS 击败可得 +1" | `mint paid 1 --dry-run` |
| 余额不足 | "需 0.005 ETH, 当前 0.002 ETH" | 充值钱包 |
| 单次超限 | "单次最多 10 个" | 分批 |
| tx 失败 | "gas 不足/网络拥堵, 30s 后重试" | 重试或切 `mock` |
| 未初始化 | "请先 init" | `init` |

---

## 4. 落地节奏

### Week 4 MVP（优先级）

**🔴 P0（必做，一周内）:**
1. 合约: `MintAllowance` struct + `mintHero(isPaid)` payable 版
2. 合约: `grantBossMint` + Arena.completeStage 联动
3. 合约: 2-step 时间锁提款
4. CLI: 已实装（gacha-skill 提前落地，待 code review）
5. skill.md: 已更新（gacha-skill 提前落地）
6. 定价: **单档 0.005 ETH**（MVP 简化）
7. BOSS 首杀奖励（每位 1 次）

**🟡 P1（第二轮）:**
8. 30 抽派系保底 + pityProgress 透明
9. 首周日登福利（合约需 `grantDailyMint`）
10. 重复英雄兑换声望碎片
11. 惜败补偿 +5%（抽卡版）
12. 三档定价（铜/银/金）

**🟢 P2（长期）:**
13. 80 抽 BOSS 签名技能珠保底
14. 友链推荐 K 因子
15. 排行赛季机制
16. 开发者月度生态报告

### 2-Week 实际估算

| 工作流 | 工时 |
|---|---|
| 合约开发 + Foundry 测试 | 3 天 |
| ABI 同步 + CLI 接入链上 | 1 天 |
| skill.md 打磨 + 玩家文案 | 0.5 天 |
| 部署 Base Sepolia + 真机测试 | 1 天 |
| nerf/提款文档 + 社区 Q&A 模板 | 0.5 天 |

---

## 5. 待决策

| # | 问题 | 默认建议 | 需你拍板 |
|---|---|---|---|
| Q1 | MVP 定价单档还是三档? | 单档 0.005 ETH | ⚠️ 建议 |
| Q2 | BOSS 奖励每位 1 次 vs 每次? | 每位仅首次（gacha-pm 共识） | ✅ |
| Q3 | owner 直接是你，还是 Gnosis Safe? | 先你个人，P1 切 Safe | ⚠️ |
| Q4 | MVP 日登福利上不上? | 上（D1 留存关键） | ⚠️ |
| Q5 | gacha-skill 已提前改了 cli.ts/skill.md，要不要回滚? | **不回滚**，合约跟上即可 | ⚠️ |

---

## 6. 评审归属

| 章节 | 主贡献 |
|---|---|
| §1 产品 PRD | gacha-pm |
| §2 合约技术方案 | gacha-contract |
| §3 CLI/Skill | gacha-skill (并已落代码) |
| §1.6 nerf 红线 / §1.7 提款透明 | gacha-player |
| §0 共识红线 / §4-5 | lead-architect |
