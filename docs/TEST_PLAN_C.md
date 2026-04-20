# 侠客擂台 · 完整测试计划 (C 档)

> 日期: 2026-04-20
> 测试目标: 全功能覆盖 · 测-修-测循环直至 Critical/High 清零
> 执行模式: Agent Teams 并发 + forge 本地 + Sepolia 实测

## 6 阶段

### Phase 1 · 本地单测扩展(0 成本)
目标 +40 tests,总 105+:
- 21 技能 metadata 一致性(SkillRegistry.skillName ⇔ SkillBook.get)
- 49 种 SectAffinity (attacker × defender) 矩阵
- 所有 `only*` modifiers 反向测试
- HeroNFT gacha 保底(30 sect / 80 boss)、referral、exchange、pityBoost
- Vault emergencyPause 期间 deposit OK / execute 拒绝
- 成就触发 11 路径(skill 侧)

### Phase 2 · Sepolia 4-agent 真链冒烟
Team xiake-c-main:
- `chain-operator` 监控 + 汇总
- `player-1` / `player-2` 深打 chapter 1-4 + PVP
- `admin` 演示 addStage + scheduleWithdrawal

### Phase 3 · Edge Probe(不耗 gas · 用 eth_call)
18 条 revert 路径批量验证,每条匹配精确 revert reason。

### Phase 4 · 并发 Race
4 agent 同时 mint/challenge,验证 nonce 排队 + tokenId 唯一 + 无 storage race。

### Phase 5 · 压力 / 容量
- 50 场 battle(event log 完整性 + gas 曲线)
- 30 抽 gacha(sect-pity 30 抽真触发)

### Phase 6 · 汇总
TEST_FINDINGS.md + STATUS_REPORT.md 更新。

## 覆盖矩阵

| 域 | 已有测试 | Phase 1 新增 | Sepolia 验证 |
|---|---|---|---|
| Mint | 3 | +4 | ✅ P2 |
| Battle (PVE/PVP) | 5 | +5 | ✅ P2,P4,P5 |
| Injury | 2 | +3 | ✅ P2 |
| Skill learn | 1 | +3 | ✅ P2 |
| Vault | 19 | +4 | ✅ P2 admin |
| SkillRegistry | 0 | +8 (21 技能 × 元信息) | — |
| SectAffinity | 5 | +10 (矩阵) | ✅ battle damage |
| StageRegistry | 11 | +4 (curator/pause) | ✅ P2 addStage |
| Gacha 保底 | 0 | +5 | ✅ P5 |
| 成就 | 0 | +11 | ✅ P2 |
| **Total** | **66** | **+57** | — |

## Bug 处理流程

```
Found bug
  ↓
Suspend this phase
  ↓
Add regression test in forge (local)
  ↓
Fix contract or skill code
  ↓
forge test 全绿 + new test green
  ↓
Decide: redeploy Arena (only) OR carry to next deploy
  ↓
docs/TEST_FINDINGS.md 追加条目
  ↓
Resume phase
```

## Stop conditions

- Critical (P0) bug 暴露 → 当场停,修完再继续
- Sepolia ETH 余额 < 0.002 ETH → 暂停,告诉用户充值
- Phase 完成 3/3 次都全绿 → 过
