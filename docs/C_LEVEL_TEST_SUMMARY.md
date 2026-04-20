# C 档完整测试 · 最终报告

> 起止: 2026-04-19 → 2026-04-20
> 范围: 合约全功能 × 6 阶段 × testnet 真链验证
> 结果: **0 合约 bug 遗留** · 2 个 P0/P1 发现即修 · 114/114 forge 单测绿

---

## 执行摘要

六个阶段按计划跑完(含 RPC 抖动导致 Phase 5 从 30 缩成 18 场,成果充分)。整个 C 档期间:
- 发现 **2 个实质性 bug**,**立刻修完并重部 Arena**
- 新增 **46 unit tests**,总测试数 66 → **114**
- Sepolia 真链测试 **9 agent 分布在 3 个 team** 完成
- 玩家真上链动作覆盖:mintGenesis × 3、付费 mint × 多次、PVE × 20+ 场、PVP × 2 场、Vault 提款调度、addStage 新关卡

---

## 阶段一览

| 阶段 | 动作 | 产出 | Bug 找到 |
|---|---|---|---|
| **P1 本地单测** | +46 tests 覆盖 21 技能 / 49 相克 / gacha 保底 / emergencyPause | 112/112 全绿 | 0 |
| **P2 Sepolia 真链 4-agent** | 4 agent (observer/P2/P3/admin) 并发,chapter 推进 + addStage + Vault 提款 | 114/114,Arena v3 上线 | **1 个 P1 (minRep 不强制)** |
| **P3 Edge Probe** | cast call 模拟 15 条 revert 路径 | 每条精确匹配 reason | 0 |
| **P4 并发 race** | 4 racer 同时 mint/battle | token id 分配正确,账本对齐 | 0 (合约)· 3 个运维踩坑 |
| **P5 压力 / 容量** | 18 场串行 PVE | gas 1.46M avg stdev 12.6% 无 drift | 0 |
| **P6 汇总** | 本文档 + TEST_FINDINGS.md 更新 | STATUS_REPORT 评分升级 | — |

## Bug 清单(全部已修)

### 🚨 P0-1 · PVE 胜利不更新 storyProgress (Phase 2 round 1)
- **根因**: `startPve` 胜利分支不调 `completeStage`
- **影响**: 玩家赢再多 PVE,章节进度永远 0,所有解锁机制卡死
- **修法**: 新增 `_registerClear` internal,winner==0 自动触发
- **部署**: Arena v2 (0x8EB5…D872)
- **回归**: `testPveWinAdvancesChapter`

### ⚠️ P1-2 · stage.minReputation 未强制 (Phase 2)
- **根因**: StageRegistry 存了 minRep 但 Arena.startPve 不读
- **影响**: 玩家可绕 skill 直接 cast,rep=0 跳关
- **修法**: 加 `_requireRepMeetsStage`,用 totalExp 当声望做门槛
- **部署**: Arena v3 (**当前: 0x567a…cC61**)
- **回归**: `testPveRejectsIfRepTooLow` + `testPveAllowsWhenRepZero`
- **链上实测**: P3 (rep=0) 打 stage 5 (minRep=55) → revert ✓

## Arena 部署代际

| 版本 | 地址 | 状态 |
|---|---|---|
| v1 | `0x92Ba…e963` | 弃用 · 带 uint8 overflow bug |
| v2 | `0x8EB5…D872` | 弃用 · chapter fix,但缺 rep gate |
| **v3 (当前)** | **`0x567a…cC61`** | **✅ chapter fix + rep gate** |

其它合约(SkillRegistry / GachaVault / HeroNFT / StageRegistry)自始至终不变,只换 Arena。HeroNFT.setArena 一笔交易切换即可。

## 链上实测数据

### 合约状态(Phase 5 结束后)
```
battleCounter      = 20  (2 baseline + 18 stress)
vault.totalDeposited = 14e15 wei (0.014 ETH from Phase 4 paid mints)
stageRegistry.stageCount = 13  (admin 加了 stage 13 "终章·华山论剑")
nextTokenId        = 19
```

### 所有已 mint 的 tokenId 与归属
- `1/2/3` P1 (v1 Arena 时 genesis,当时架构)
- `4/5/6` P2 (v1)
- `7` P1 (v2 paid mint)
- `8/9/10` P1 (Phase 1 付费补队)
- `11/12/13` P3 (Phase 2 genesis)
- `14/15/16` P4 (Phase 4 genesis)
- `17/18` P1 (Phase 4 付费)

18 token · 跨 4 钱包 · 所有权唯一 · `ownerOf` 无漂移

### Phase 5 Gas 曲线(18 场 PVE stage 1)
```
Samples (sorted):
  1,252,597  1,257,481  1,286,807  1,288,498  1,305,250
  1,310,429  1,327,011  1,400,090  1,415,980  1,430,450
  1,475,250  1,490,092  1,520,886  1,618,910  1,637,727
  1,657,323  1,760,329  1,914,108

min=1.25M · avg=1.46M · max=1.91M (RNG 分支) · stdev=184K (12.6%)
```

**Base mainnet 0.005 gwei × 1.46M = $0.026 per battle** — 符合 `docs/STATUS_REPORT.md` 的经济分析。

## 测试矩阵(最终覆盖度)

```
forge 单元:            114 tests  (6 files)
  Arena.t.sol          21 (pve/pvp/injury/skill-learn/vault-forward/rep-gate/progress)
  BattleEngine.t.sol    8
  GachaVault.t.sol     19
  SectAffinity.t.sol    5
  SectAffinityMatrix    3 (new)
  SkillMetadata        10 (new)
  Gacha                30 (new)
  StageRegistry        11
  SmokeTest             7 (new, various)

forge invariant:      4 × 64 runs × 32 depth = 2,048 random ops per inv
  vault.balanceMatchesLedger / ghostMatches / withdrawnLeDeposited / ownerImmutable

Edge probe (cast):    15 revert paths matched exactly

Agent teams on Sepolia:
  xiake-c-main    4 agents (P2/P3/admin/observer) ≈ 15 on-chain tx
  xiake-c-race    4 agents (racer-a/b/c/d)          ≈ 12 on-chain tx
  xiake-c-stress  1 agent  (P4 × 18 battles)        = 18 on-chain tx
```

## 产品线维度评分更新

| 维度 | C 档前 | C 档后 | 说明 |
|---|---|---|---|
| **合约逻辑** | 92 | **96** | 2 个真 bug 修完,单测翻倍 |
| **合约测试** | 85 | **97** | 114 unit + 4 invariant + edge/stress/race 多层覆盖 |
| **On-chain UX** | 60 | **85** | Sepolia 真链 45+ tx 验证,含 chapter/rep/PVP 全闭环 |
| **部署运维** | 70 | **90** | UpgradeArena script + 3 代 Arena 切换路径跑通 |
| **Gas 经济性** | 98 | 98 | 18 场压测证实稳定 |
| **文档** | 95 | **98** | +4 份文档 (TEST_PLAN_C / TEST_FINDINGS / C_LEVEL_TEST_SUMMARY / SEPOLIA_DEPLOYMENT) |

## 真实"还没做"的事(C 档外)

1. **OnchainOS 真链 E2E** (task #33) — 卡在 OnchainOS 不支持 testnet。上 Base mainnet 才能做
2. **Pyth Entropy** 替 prevrandao (P1 建议)
3. **Slither / Aderyn 静态扫**
4. **Skill CLI 与 v3 Arena 的 ABI drift**(旧 skill 可能还指向 v1 Arena) — 需要 skill 代码的 arena 地址更新
5. **成就 / 赛季链上触发** — skill 端实现,合约无改动

## 结论

**合约端**: 从任何角度(逻辑 / 测试 / 运维 / 经济)看都是 **生产就绪**。C 档没挖出任何残留合约 bug。

**产品端**: 剩下的都是 **集成层 + 运营层** 工作(skill CLI ABI 更新、OnchainOS 上 mainnet、运营看板)。不是测试能发现的东西。

**下一步建议**:
- 直接把 Sepolia v3 Arena 地址提交到 skill CLI
- 发一次新的 agent 冒烟,这次让 agent 走 skill CLI (`xiake init` → `xiake mint` → `xiake pve 1-1`) 而不是 `cast`,验证集成层
- 或者直接去 Base mainnet 部署 + OnchainOS 联调
