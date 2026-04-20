# 持续更新游戏内容 — 合约侧架构

> 日期: 2026-04-19
> 背景: 用户问 "以后我还想持续更新游戏内容(加门派/剧情/技能),合约侧怎么办?"
> 这份文档是 **架构原则 + 三种场景的操作手册**。

---

## 0. 核心原则 (三条红线)

```
           ┌────────────────────────────────────┐
 可变内容  │  Stages / Skills-metadata / Lore   │  ← 随时 add()
           │  Prices / Paymaster policy         │
           └────────────┬───────────────────────┘
                        │ 管理员 onlyRegistrar
           ┌────────────┴───────────────────────┐
 冻结规则  │  BattleEngine 战斗算法             │  ← 永不改
           │  HeroNFT 属性公式                  │
           │  GachaVault 提款 timelock          │
           └────────────┬───────────────────────┘
                        │
           ┌────────────┴───────────────────────┐
 玩家资产  │  tokenId 属性 (hp/atk/def/spd/crit)│  ← 红线 🚨 永不下调
           │  owner                             │
           └────────────────────────────────────┘
```

**三条红线**
1. **玩家已铸造的 NFT 属性不变** — GACHA_PRD §1.6 已承诺,代码层面靠 "不部署新 HeroNFT = 旧属性不可写" 保证。
2. **战斗算法不升级** — 通过"加技能"/"加门派相克"扩展,不动 `BattleEngine.simulate` 。
3. **提款路径永远 2 天 timelock + owner-only** — Vault 的硬编码常量,即使未来版本也不能绕过。

---

## 1. 三类更新场景

### 1.1 加内容 (高频)

> 例: 加第 4 章、加一个"明教分坛"BOSS、加一个"追魂香"技能珠。

- **怎么做**: 管理员调 `StageRegistry.addStage(...)` / `SkillRegistry.addSkill(...)`
- **触发**: 你(`OWNER`)或单独的 `CONTENT_CURATOR` 热钱包签名一笔交易。
- **玩家感知**: 下次启动 CLI 读 registry,就能看到新内容。不需要重新部署。
- **跨设备一致**: registry 在链上 → CLI 不同版本读到的一致(只要用户不强行锁旧版本)。

### 1.2 加门派 / 加核心枚举 (中频)

> 例: 再加一派"少室派"。

- **问题**: `Sect` 是 Solidity enum,写死在 `Types.sol` 里。一经部署,enum 索引不能增删。
- **本次 (C 档) 先扩到 7 派**,用罗盘一次性把坑占到。
- **以后要再加**: 必须部署 `HeroNFTv2`(旧 NFT 保留,两个合约同时在线)。
  - 玩家可选调 `burnAndMigrate(oldId)`,新合约给 v2 tokenId + 保留原属性。
  - CLI 读 `heroNft` env 指向新合约,旧的通过 `legacyHeroNft` env 继续可读。
- **心态**: 把加门派当成 "小版本号+1",一年不超过一次。

### 1.3 改战斗公式 / 经济核心 (极低频)

> 例: "觉得闪避率算错了"、"想把秒数改成 block 数"。

- **立场**: **不改**。这是和玩家的契约。
- **绕路方案**: 通过新技能调配战况。比如想加"毒"机制 → 不是改 BattleEngine,而是注册一个新的 `SkillKind=Dot` 技能珠。
- **真要改**: 走 §1.2 的 v2 路径 + 至少 30 天公告期。

### 1.4 调价格 / 暂停 / 参数

> 例: 促销周把银票改成 0.003 ETH。

- `HeroNFT.setPrice(newPrice)` onlyOwner — 早就支持。
- `GachaVault.setEmergencyPause(true)` onlyOwner — 急停。
- 这些参数改动立即生效,**事件留痕**,链上可审计。

---

## 2. 本次 C 档就要动的架构变更

```
contracts/src/
├── Types.sol           # Sect enum 从 3 项扩到 7 项
├── SectAffinity.sol    # 新: 7 派相克矩阵 (pure lib)
├── SkillRegistry.sol   # 扩展到 7 派 × 3 = 21 个基础技能 + addSkill()
├── StageRegistry.sol   # 新: 剧情关卡注册表 (owner addStage)
├── HeroNFT.sol         # _generateHero 增加 4 个 sect 分支
├── Arena.sol           # _bossTeam 读 StageRegistry,不再硬编码
└── BattleEngine.sol    # 伤害计算一行乘 SectAffinity 系数
```

**可变入口只新增这两个 admin 函数**:
```solidity
// StageRegistry.sol
function addStage(uint8 stageId, uint8 chapter, Types.Hero[3] calldata bossTeam,
                  bytes32 nameHash, string calldata flavorText) external onlyRegistrar;

// SkillRegistry.sol  
function addSkill(uint8 skillId, Types.Skill calldata skill, bytes32 nameHash)
         external onlyRegistrar;
```

每次你想加内容,准备 JSON → 一笔 tx 推上链 → CLI npm 版本跟着更新前端文案(**文案可以在 TS 侧 patch,不需要链上推**,只要保持 `nameHash` 一致)。

---

## 3. 权限分离建议

```
┌─────────────────────────────────────┐
│  OWNER  (冷钱包 / Ledger)            │   Vault 提款、核心参数
│   └─── 半年动一次                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  CONTENT_CURATOR  (温钱包 / Operator)│   addStage / addSkill
│   └─── 每月动几次                    │
└─────────────────────────────────────┘
```

CURATOR 热钱包被盗 → 最多 push 假内容,被社区发现立即 owner 撤销角色。不能取款、不能改玩家属性。隔离让日常运营轻量,同时保住财务安全。

合约里:

```solidity
// StageRegistry.sol
address public owner;          // 换 curator / 急停
address public contentCurator; // 日常 add
modifier onlyRegistrar() {
    require(msg.sender == owner || msg.sender == contentCurator, "not authorized");
    _;
}
function setCurator(address c) external { require(msg.sender == owner); ... }
```

---

## 4. 长期演进: 社区治理 (可选, v3)

上线稳定后 (>= 10k 玩家),可引入轻量投票:
- 内容提案走 `TimelockController` (7 天延时)
- Hero 持有人按 `playerMintCount` 加权投票
- 通过后自动执行 `addStage` / `setPrice`

这样你不用每周盯着内容,而是把权力分散给"出的钱最多的那群人"。

---

## 5. 总结一张表

| 你想做 | 成本 | 是否动合约 |
|---|---|---|
| 加一关 / 一个 BOSS | 1 tx + TS patch | 动 `StageRegistry.addStage()` |
| 加一个技能珠 | 1 tx + TS patch | 动 `SkillRegistry.addSkill()` |
| 改 BOSS 台词、UI | 只 npm publish | **不动合约** |
| 调抽卡价格 | 1 tx | `HeroNFT.setPrice` |
| 加第 8 派 | 新合约 + 迁移工具 | 动 `HeroNFTv2` |
| 改 crit 算法 | 谢绝改,请加新技能替代 | 除非走 v2 路径 |
| 社区治理 | Timelock + Voting | v3 再做 |

**一句话**: 把合约当成 Unity 的 ECS — **Component (Skill/Stage/Affinity) 可以注册新的, System (BattleEngine) 冻结, Entity (HeroNFT tokenId) 永远不变**。
