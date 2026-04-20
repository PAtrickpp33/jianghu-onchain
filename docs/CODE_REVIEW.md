# 侠客擂台 · Code Review

> 日期: 2026-04-19
> 范围: Xiake 重构后的 `contracts/src`, `contracts/test`, `skill/src` 核心目录
> 目标: 为 `GachaVault` 落地 + `Xiake` 统一命名 + 注入伤病/习得技能后的全栈做一次 PR-level 审阅
> 评级: 🚨 Critical (must-fix before deploy) / ⚠️ High / 🟡 Medium / 🟢 Low

---

## 0. TL;DR

- **Gacha Vault 成型**: `GachaVault.sol` 独立持币, 48h 2-step 提款 +
  `cancelWithdrawal` + `emergencyPause`, `HeroNFT` 付费路径已经 forward
  到 vault。`OWNER_ADDRESS` 从 `.env` 进入, deployer key 无权取款。
- **残局修复**: Arena 现在在 PVE / PVP 结束时对败方三位英雄调用
  `setWound(level=1)`, 并在开战前 `_requireAvailable` 拒收受伤英雄。
  `learnSkill` 在完成 `SKILL_LEARN_MILESTONE` 章节后解锁。
- **命名统一**: `wuxia_*` → `xiake_*`, `JianghuArena` EIP-712 domain →
  `XiakeArena`, ERC-721 token 名称 `江湖侠客/JHHERO` → `侠客/XIAKE`。
  `.wuxia` / `WUXIA_*` 保留 fallback 兼容旧存档。
- **清理**: `docs/REDESIGN_REPORT.md`, `docs/BATTLE_REPORT_V2.md` 已删除
  (过期且内含 wuxia-fight 死链接)。
- **CI**: `.github/workflows/ci.yml` 添加 forge + tsc/vitest 流水线。

下面按文件分块列出风险 / 建议, 顺序从链上往链下走。

---

## 1. 合约 (`contracts/src/*.sol`)

### 1.1 `GachaVault.sol`

| 级别 | 位置 | 说明 |
|---|---|---|
| 🟡 | `GachaVault.sol:55` `WITHDRAWAL_DELAY = 2 days` | 硬编码 2 天; 与 Gacha PRD §1.7 "提款透明" 一致, 但如果未来要和社区约定更长 (7 天) 延时, 需要升级 vault。建议写进 README 的 "Immutable parameters" 清单, 明确这是设计决策而不是疏忽。 |
| 🟡 | `GachaVault.sol:104-109` `receive() + deposit()` | `receive()` 和 `deposit()` 都走 `_deposit`, 功能重复但都有场景: `receive` 让普通 ETH 转账也能进账 (例如 `selfdestruct(vault)`); `deposit()` 让 `HeroNFT` 的显式调用在区块浏览器里有可读 selector。保留两个。 |
| 🟢 | `GachaVault.sol:114-117` `_deposit` zero-guard | `amount == 0` 时静默返回而不 revert。目的是让 `receive()` 空调用不阻断 — 但在测试里意味着 `totalDeposited` 不会变。合理取舍。 |
| 🟡 | 无 `renounceOwnership` / 不可换人 | 设计就是 "OWNER 不可变", `OWNER` 没法转移。丢钥匙 = 丢池子。这是用户明示要求的, 记进 README "Known tradeoff" 即可。若要加 emergency backup owner, 必须新合约。 |
| 🟢 | `cancelWithdrawal` | 允许 owner 在 timelock 没到前撤销, 不影响安全模型 (社区窗口期本来就是防止执行, 不是防止发起)。 |

### 1.2 `HeroNFT.sol`

| 级别 | 位置 | 说明 |
|---|---|---|
| ⚠️ | `HeroNFT.sol:369-376` vault forward | 付费 mint 里 `call{value:cost}(deposit())` 失败就 revert 整笔 mint。OK — 但注意 cost 是已经扣完退款后的净值, 语义正确。后续如果 Vault 被 `emergencyPaused` (仅影响提款, deposit 不受影响), 该路径仍可 forward。 |
| 🟡 | `HeroNFT.sol:74` `pricePerMint` 保留但未使用 | 所有 tier 用 `PRICE_BRONZE/SILVER/GOLD`, `pricePerMint` + `setPrice` + `PriceUpdated` 成了 dead weight。建议删掉以降低阅读成本, 或把 `pricePerMint` 做成 silver 的别名 view。 |
| 🟡 | `HeroNFT.sol:304-322` `mintGenesis` 无限调用 | REDESIGN P-01/P-02 已拆掉 `hasGenesisMinted` 保护, 玩家可以无限触发 `mintGenesis` 白送三个英雄 (不消耗 allowance)。这是刻意的 "积累, 不是一主三侠", 但要记录在 README, 避免审计人误读。 |
| 🟡 | `HeroNFT.sol:296-301` 事件 `GenesisMinted` | genesis 发三个时走独立事件, 而非 `HeroMinted` × 3 — 下游 indexer 需要两条路径都订阅, 容易漏一半。建议 indexer 文档点名。 |
| 🟢 | `heroHealth.woundLevel` 类型 `uint8` + `setWound(level)` 未封顶 | 传 `> 2` 的值不会 revert, 仅把 `cooldownUntil` 拉到 `12h × level`。Arena 里只传 `1`, 但留个 bound check 更防御: `require(woundLevel <= 2, "bad level")`. |

### 1.3 `Arena.sol`

| 级别 | 位置 | 说明 |
|---|---|---|
| 🚨 | `Arena.sol:241-244` `_woundTeam` | 调 `heroNft.setWound` 需要 `arenaAddr == address(this)` (见 HeroNFT `onlyArena`)。Deploy 脚本已经加了 `nft.setArena(address(arena))`, 但如果有人重新部署 Arena 忘了配线, 整个 PVE/PVP 会 revert 在第一次败方结算时。**上线 checklist 必含 `nft.arenaAddr() == arena`**, 已加入 `Deploy.s.sol` 的 invariant 断言。 |
| 🟡 | `Arena.sol:210` `_requireAvailable(attackerIds)` 不防守方 | 刻意设计 — 防守方不受 availability 检查, 否则玩家会 self-grief 自己的阵容逃避挑战。加了注释, 但未来如果出现 "刷低段位" 问题, 需要另一种缓冲机制。 |
| 🟡 | `Arena.sol:285-287` 平局 `winner == 2` | 平局不发伤, 等于 draw 可无限互刷不受惩罚。Hackathon 没问题, 但如果要上成赛季, 应该也扣双方 50% cooldown。 |
| 🟡 | `Arena.sol:343-356` `learnSkill` | 门槛只是 `currentChapter >= 3`, 无消耗。玩家可以对同一英雄反复调用 `learnSkill(x, skillId=1), learnSkill(x, skillId=2)...`, `_unlockedSkills` 数组无上限。建议加 per-hero 上限 (`require(_unlockedSkills[tokenId].length < 5)`) 或要求消耗 `shards`。 |
| 🟡 | `Arena.sol:126-132` `setDefenseTeam` 无 injury check | 玩家可以把带伤英雄放进防守队列。由于防守方不会被 `_requireAvailable` 再次拦截, 算一致的。记录即可。 |
| 🟢 | EIP-712 domain 从 `JianghuArena` 换成 `XiakeArena` | 破坏了任何历史 signed challenges, 但 chain 上没部署, 无影响。 |

### 1.4 `BattleEngine.sol`

未在本次改动范围, 简单扫读:

| 级别 | 位置 | 说明 |
|---|---|---|
| 🟡 | `BattleEngine.sol:102` `skillIds[rand % skillIds.length]` | `_unlockedSkills` 不会自动进入 battle (只进入 `_unlockedSkills` 映射, 不进 `_heroes[tokenId].skillIds`)。符合当前设计: 习得技能要玩家显式 `equip` 到 3 个主动槽。**README 里应明确这点**, 否则玩家以为学了就直接生效。 |

### 1.5 测试覆盖

- `GachaVault.t.sol`: 14 个测试, 覆盖 ownership / timelock / cancel / pause / ledger。
- `Arena.t.sol`: 加了 `testGenesisCanBeCalledAgain`, `testInjuryBlocksPve`, `testLearnSkillGated`, `testPvpAppliesWoundsOnLoss`。
- **缺口** (⚠️ High): 没有 "vault forward 路径成功写进 vault" 的端到端测试。建议加一条: 在 `Arena.t.sol` 里 `mintHeroTier(paid=true)` → 读 `vault.getPoolBalance() == cost`。
- **缺口** (🟡 Medium): 没有 fuzz 测试 vault withdrawal 反注入 (`call{value}` 到 reverting contract)。`nonReentrant` 已防, 但 fuzz 能兜底。

---

## 2. TypeScript Skill (`skill/src`)

### 2.1 `cli.ts` (3832 行)

| 级别 | 位置 | 说明 |
|---|---|---|
| ⚠️ | `cli.ts:36-44` state dir fallback | 三级 fallback (`XIAKE_STATE_DIR` → `WUXIA_STATE_DIR` → 检测 `~/.wuxia/state.json`)。兼容性好, 但 `existsSync` 是同步 I/O, 每次 process 启动都跑。单次 CLI 调用无感, 不修改。 |
| 🟡 | `cli.ts` overall length | 3800+ 行单文件, 承担 state / mint / pve / pvp / admin / achievements / season / arena / refer / exchange / pity-boost / auto-train。命令与渲染耦合。下一次大重构建议拆成 `commands/*.ts` + `state/*.ts`, 当前只影响可维护性, 不影响功能。 |
| 🟢 | `cli.ts:1068` 菜单 banner | 统一成 `⚔️ 侠 客 擂 台 ⚔️`, ASCII 宽度手测过。 |

### 2.2 `chain/client.ts`

| 级别 | 位置 | 说明 |
|---|---|---|
| 🟡 | 未 export vault 地址读取 | Rebrand 后 mcp.json 新增 `XIAKE_VAULT_ADDRESS`, 但 `getAddresses()` 仍只返回 `{hero, arena}`。当 skill 要渲染 "池余额 X ETH / 历史提款 Y" 时需要 vault 地址。建议扩展: `{hero, arena, vault: validateAddress(process.env.XIAKE_VAULT_ADDRESS, "vault")}`。 |

### 2.3 `onchainos/*`

| 级别 | 位置 | 说明 |
|---|---|---|
| 🟢 | `gateway.ts`, `paymaster.ts`, `wallet.ts` | 纯重命名 `Jianghu` → `Xiake`, 逻辑未改。Gas sponsorship 逻辑保留。 |

### 2.4 `tools/*` MCP 工具

| 级别 | 位置 | 说明 |
|---|---|---|
| ⚠️ | MCP 工具名 `xiake_*` | Breaking change vs 发布的 `wuxia-skill@0.2.0`。任何已经缓存 `wuxia_init` 的 client 调用都会 404。建议在 `src/index.ts` 注册时, **同时 export 旧名字 alias** (`wuxia_init` → same handler) 至少一个版本, 或者在 package CHANGELOG 强调 major 升级。 |

### 2.5 `render/*`

纯文案 / ANSI 渲染, 不做状态变更。重命名后没看到逻辑漂移。

### 2.6 缺失的 vault UI

🟡 Medium: `cmdAdminWithdraw`, `cmdAdminExecute` 现在指向 HeroNFT 的 proxy view, 能读但不能写 (`scheduleWithdrawal` 已从 HeroNFT 移除)。需要改成直接调用 Vault:
- `schedule` → `vault.scheduleWithdrawal(target, amount)`
- `execute` → `vault.executeWithdrawal(amount)`
- `cancel` → `vault.cancelWithdrawal()` (新功能)

这个改动没在本次落地, **列为 DEV 阶段剩余项**。

---

## 3. 经济不变量 (Vault)

设 `sum(deposit_i) = D`, `sum(executeWithdrawal_i) = W`。期望:

| 不变量 | 描述 | 实测 |
|---|---|---|
| I1 | `totalDeposited - totalWithdrawn == address(this).balance` (在没有 `selfdestruct` 注入的前提) | `testLedgerView` 覆盖 |
| I2 | `OWNER` 永远是构造传入值 | `testOwnerIsImmutable` 覆盖 |
| I3 | 非 OWNER 调用 schedule/execute/cancel 必 revert | 3 条独立测试 |
| I4 | `heroNft` 一经设定不可更改 | `testSetHeroNftOneShot` |
| I5 | execute 前必须 schedule, 且 delay 满足 | `testWithdrawalRequiresDelay` |
| I6 | `emergencyPaused` 屏蔽 execute 不屏蔽 deposit | `testPauseBlocksExecution` + `testPauseDoesNotBlockDeposits` |

**未覆盖**: I1 在发生直接 ETH 转账 (非 `deposit()`) 后会出现 `balance > deposited - withdrawn`。这是 ERC 通用陷阱, 不是 bug — 记录一句在 README。

---

## 4. Action Items (按优先级)

### 🚨 Deploy 前必做 (Blocker)
1. 生产部署必须确保 `HeroNFT.arenaAddr() == Arena`, 否则所有战斗结算 revert。`Deploy.s.sol` 已强制, 但如果改用脚本拆分多步部署需再次校验。

### ⚠️ 上线前最好做 (High)
2. 加 "vault forward 成功" 端到端测试 (Arena/HeroNFT + GachaVault 集成)。
3. 旧名字 MCP alias (`wuxia_*`) 至少保留一个 minor 版本, 避免 client 缓存炸。
4. 把 vault 地址纳入 `chain/client.ts.getAddresses()` 并改写 `cmdAdminWithdraw / Execute` 调用 vault 而非 HeroNFT。
5. 发布前 bump `skill/package.json` 到 `0.3.0` (已完成) + 在 CHANGELOG 写清楚 breaking changes。

### 🟡 下个迭代 (Medium)
6. `Arena.learnSkill` 加 per-hero 技能上限或 shards 消耗。
7. 删除 `HeroNFT.pricePerMint` + `setPrice` (dead code)。
8. `setWound(uint8 level)` 加 `require(level <= 2)`。
9. 战斗平局 (`winner == 2`) 加 50% cooldown 惩罚。
10. `cli.ts` 拆分为 `commands/*` + `state/*` (可维护性)。

### 🟢 Nice-to-have (Low)
11. Vault 添加 `renounceOwnership` 明确 "永久锁仓" 场景的语义 (可选, 用户不要也 OK)。
12. Indexer 文档: genesis mint 走独立事件这一点要点名。
