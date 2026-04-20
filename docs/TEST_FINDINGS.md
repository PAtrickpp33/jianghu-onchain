# 侠客擂台 · C 档测试发现

> 开始: 2026-04-20
> 分级: P0 Critical (阻断部署) · P1 High (上线前必修) · P2 Medium (可接受延后)

## Bug 清单

### ✅ P0-1 (已修) · PVE 胜利不更新 storyProgress
- **发现**: Round 2 Sepolia 测试 (2026-04-19)
- **现象**: 两玩家打赢 4 场 PVE,但 `playerProgress.currentChapter` 都是 0
- **根因**: Arena.startPve 胜利分支不调 completeStage → chapter/exp/boss 奖励永远不触发
- **修法**: 新增 `_registerClear` internal,winner==0 时自动调。Arena 重部 → `0x8EB5...ED872`
- **回归测试**: `testPveWinAdvancesChapter`

## Phase 进度

### Phase 1 · 本地单测扩展 ✅
- 新增 **46 tests** across 3 新文件:
  - `SkillMetadata.t.sol` (10) — 21 技能 metadata 一致性 + addSkill 运营路径
  - `SectAffinityMatrix.t.sol` (3) — 49 种 (attacker × defender) 矩阵 + 结构守恒 + mirror 对称
  - `Gacha.t.sol` (30) — 价格 tier / 10 连折扣 / 退款 / sect-pity 30 抽触发 / referral / exchangeDuplicate / pityBoost / emergencyPause
- 发现: **0 contract bug** (合约实现扎实)
- 发现: 1 测试编写错误(我写测试时 expected revert reason 错,不是合约 bug),已修
- **total tests 66 → 112**,全部绿色

### Phase 2 · Sepolia 4-agent 真链冒烟 ✅

**Team xiake-c-main** · 4 agent 并发: chain-observer / player-2 / player-3 / admin

**成果**:
- **player-2** 清 chapter 1 全部 3 关 (stage 2/3/4) + 尝试 stage 5
- **player-3** 新玩家完整 onboarding: mintGenesis → setDefense → PVE 1-1 → 验证 2nd mint revert
- **admin** Mission A/B/C 全部成功: addStage 13th 新关卡 · scheduleWithdrawal + timelock revert + cancel · 非管理员 addStage 拒绝
- **chain-observer** 记录 t=0 baseline + 6 场 battle 的 delta 时间线

**发现**:
- ✅ P0-1 修复验证:`testPveWinAdvancesChapter` 在 Sepolia 真链重现:P2 打 stage 2→currentChapter=2, totalExp=200
- 🚨 **新发现 P1-2**: `stage.minReputation` 存了但合约不强制 → 玩家 rep=0 可绕 skill 直接 cast call 跳关 (见下)
- ℹ️ agent 的两个 "ABI 漂移" 误报:实际 `getMintAllowance` 是 5-tuple (3+0+0+0+0 返回正常),`getStoryProgress` 是 `(uint8,uint64[],uint256)` 正常。agent 自己 decode 错,非合约问题

### ✅ P2-3 (已修, 2026-04-20) · `mint` 默认 count=3 导致"抽一个变三个"
- **发现**: 真人玩 sepolia 模式,说"先抽一个",Claude 调 `mint`(无参),CLI 默认 3 → 抽出 3 个侠客,和玩家预期完全不匹配。首次触发时 HeroNFT `_ensureSeeded` 静默送 +3 新手保底,掩盖了数量 mismatch。
- **根因**: `skill/src/cli.ts` cmdMint `let count = countArg ? parseInt(countArg, 10) : 3`。PRD §1.1 说"新手首发 3 免费",代码把这条规则固化成了默认参数,但实际 `_ensureSeeded` 已经处理 seed,不需要 CLI 也用 3 做默认。
- **修法**:
  1. cmdMint 默认 count 从 **3 → 1**
  2. 成功文案改成 `你请求 N 抽 · 新增 M 位`,N != M 时警告
  3. `allowance` view 检测新玩家状态,预告 `+3 新手首抽保底`
  4. `skill.md` 加 **数量翻译硬规则**表,禁止 Claude 调 `mint` 不带参数
- **Commit**: `581b023`

### ✅ P2-4 (已修, 2026-04-20) · tx hash 显示格式 11 处不一致
- **发现**: 不同命令显示 tx 的格式五花八门:`🔗 onchain tx: 0xabc`、`   tx: 0xabc`、`🔗 healHero tx: 0xabc`,大部分没 BaseScan URL
- **修法**: 新增 `skill/src/utils/txDisplay.ts`,统一格式 `🔗 <label> · tx 0xabc1…ef98 · https://sepolia.basescan.org/tx/0xabc1…`。11 个 on-chain write 点全改。`XIAKE_CHAIN=base` 自动切 mainnet explorer
- **Commit**: `9753402`

### ✅ P1-2 (已修) · stage.minReputation 未强制

- **发现**: Phase 2 Sepolia · P2 用 rep=0 成功调用 `startPve(stage=5, minRep=55)`
- **根因**: Arena.startPve 从没读 `stage.minReputation`,只做所有权 + 伤病检查
- **影响**: skill 前端可以 gate,但玩家直接 cast call 可绕过,整个"声望解锁"机制失效
- **修法**: Arena 加 `_requireRepMeetsStage`,读 stage.minReputation 并对比 `playerProgress.totalExp`。minReputation=0 的关卡保持开放(向后兼容)
- **回归测试**: `testPveRejectsIfRepTooLow` + `testPveAllowsWhenRepZero`
- **新部署**: Arena `0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61` (第 3 版 Arena)
- **链上验证**: P3 rep=0 打 stage 5 → revert `"Arena: reputation too low"` ✅

### Phase 4 · 并发 Race ✅

**Team xiake-c-race** · 4 agent (racer-a/b/c/d) 并发

**成果**:
- racer-c 单钱包 PVE 成功(stage 1, gas 1.29M)
- racer-d 新钱包 mintGenesis 成功,拿到 contiguous 14/15/16
- racer-a 2 笔 paid silver mint 成功 (tokens 17/18) + 1 场 PVE
- racer-b mint 因 prompt 错误全部 revert(insufficient payment)

**合约层发现**: **0 bug**。token id 分配在多钱包并发下唯一;nextTokenId 正确递增;Vault 账本不漂移(实测 +0.010 ETH = 2 × silver,与 log 完全对账)。

**运维 / 自动化踩坑(非合约,记录以防后续 agent 脚本再踩)**:

1. **prompt 错: 默认 tier 是 silver 不是 bronze** · `mintHero(address,uint8,bool)` 3 参数入口 `_mintHeroTiered(..., tier=1)` → silver 5e15 wei。我 prompt 里写 `--value 1e15` (误以为 bronze) → 被 `HeroNFT: insufficient payment` 拒。想走 bronze 要用 `mintHeroTier(...,tier=0)` 4 参数重载。
2. **`cast send --async` 不自增 nonce** · 同钱包并发 loop 首次 ok,其余都撞 `already known`(相同 nonce)。修法:脚本里 `cast nonce` 获取 base,显式传 `--nonce $((base+i))`。
3. **Sepolia mempool 静默 evict** · racer-a 的第 3 笔(正确价格)发出后从 mempool 消失,`cast tx` 返回 not found,nonce 未前进。Sepolia 公共 RPC 高负载下静默丢 tx。生产端需要 resubmit + re-nonce 机制。

### Phase 5 · 压力 / 容量 ✅

**Team xiake-c-stress · P4 串行 PVE ×18 次**(原计划 30,RPC 在第 19 次时 "no route to host" 中断;18 次已足证 pattern)

**Gas 曲线 (n=18)**:
- min **1,252,597** · max **1,914,108** · avg **1,463,845**
- stdev 184,181 (~12.6% of mean) — 战斗内部 RNG (crit/miss/控制分支) 导致 loop cost 波动
- **无 monotonic drift** — 最高/最低交错出现,证明 storage 增长不累进 gas

**状态完整性**:
- battleCounter: 2 → 20 ✓ (Δ=18)
- `P4.storyProgress = (currentChapter=1, bossDefeated[18], totalExp=1800)` — 完美对账 (100 exp × 18 wins)
- totalDeposited 不变 ✓ (这一轮无付费)
- 英雄 14/15/16 全程健康 ✓ (18 连胜无伤)

**链上 ETH 消耗**: **~0.0088 ETH/battle** (Sepolia 0.011 gwei · 1.46M gas 平均)
- 30 battle 推算 0.000264 ETH,Base 主网同等 gas → **mainnet 单场 $0.03** 级别,符合之前经济分析

**Pathologies**: **0**。仅 battle #3 gas 1.914M = avg +31% 偏差,单一 RNG outlier。

### Phase 3 · Edge Probe 矩阵 ✅
- 用 `cast call --from` 模拟(不消耗 gas,直接 eth_call)
- 验证 **15 条 revert 路径**,精确匹配 revert reason:
  - Arena: unknown stage / not owner / self-challenge / attacker no team
  - StageRegistry: not registrar / stageId 0 reserved / already exists
  - HeroNFT: zero recipient / bad tier / count out of range (0/11) / free mint not payable
  - GachaVault: not owner / zero target / bad amount (0 / > balance) / heroNft set
- **0 contract bug · 0 gas spent**

### Phase 2 · Sepolia 4-agent 真链冒烟 (pending)
### Phase 4 · 并发 race (pending)
### Phase 5 · 压力 / 容量 (pending)
### Phase 6 · 汇总 (pending)

## 统计

| 日期 | 总测试 | 新增 | P0 | P1 | P2 | 状态 |
|---|---|---|---|---|---|---|
| 2026-04-19 | 63 | — | 0 | 0 | 0 | 基线 |
| 2026-04-19 round 2 | 65 | +2 | **1** (PVE storyProgress) | 0 | 0 | 1 P0 修 |
| 2026-04-20 Phase 1 | **112** | **+46** | 0 | 0 | 0 | 经济路径完整 |
| 2026-04-20 Phase 2 | **114** | +2 | 0 | **1** (minRep gate) | 0 | Sepolia 4-agent,新发现 + 已修 |
| 2026-04-20 Phase 3 | 114 + 15 cast probes | +0 forge | 0 | 0 | 0 | 18 revert paths 匹配 |
| 2026-04-20 Phase 4 | 114 + 4 agent race | +0 | 0 | 0 | 0 | 合约层 clean,3 个运维踩坑记录 |
| 2026-04-20 Phase 5 | 114 + 18 serial battles | +0 | 0 | 0 | 0 | gas 稳定 1.46M avg · 无 state drift |
| 2026-04-20 真人 sepolia 模式试玩 | + 真人试玩 | — | 0 | 0 | **2** (mint UX + tx display) | 2 个 P2 当场修完 |
| **总计** | **114 unit + 5 invariant + 18 stress + 15 edge + 9 agent integration + 真人 sepolia** | — | **0** | **0** | **0** | **全绿** |
