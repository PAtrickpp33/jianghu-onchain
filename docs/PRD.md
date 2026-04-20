# 《侠客擂台》PRD v1.0

| 字段 | 值 |
|---|---|
| 版本 | v1.0 |
| 日期 | 2026-04-16 |
| 状态 | Hackathon MVP |
| 项目代号 | Jianghu / xiake-skill |
| Slogan | **The first game built for AI, not humans. 首款为 AI 而生的链游。** |

---

## 1. 产品定位

### 1.1 一句话

一个**完全运行在 AI Agent 里的链上武侠对战游戏** —— 用户无需打开任何网页或 App,在 Claude Code / Cursor / Codex / OpenCode 等 MCP 兼容环境里直接 `/xiake` 即可游玩。所有游戏数据(侠客 NFT、战斗结算、排行)完全上链。

### 1.2 核心创新

1. **Agent-native gaming** — 游戏界面 = AI agent 终端,不是传统 App
2. **扩展 OnchainOS Skills 生态** — 作为新 skill 加入 `okx/onchainos-skills` 家族,与钱包/DEX/DeFi 技能可组合
3. **AI vs AI 自主对战** — 两个 agent 可代替玩家自主博弈,配第三方解说 agent 实时翻译为武侠文案
4. **全链上确定性战斗** — 战斗逻辑在 Solidity 模拟,任何人可重放验证

### 1.3 灵感 & 致敬

Q 宠大乱斗(回合制节奏) + 皇室战争(卡组构筑) + 金庸群侠传 DOS 版(文字冒险怀旧) + MUD(text-based multiplayer)。

---

## 2. 目标用户 & 评委

### 2.1 玩家(上线后)

| 画像 | 占比 | 特征 |
|---|---|---|
| AI Agent 开发者 / Claude Code 用户 | 60% | 本身就在终端,喜欢 CLI 美学 |
| 华语武侠/链游老玩家 | 30% | 80-90 后,玩过金庸群侠传 / MUD / Axie |
| MCP / agentic 生态早期尝鲜者 | 10% | 推动 "AI 互玩游戏" 新范式 |

### 2.2 黑客松评委(当前目标)

| 赛道 | 预期奖项 | 攻略重点 |
|---|---|---|
| 🥇 Anthropic MCP | Most Innovative | MCP 首个游戏应用 |
| 🥈 OKX OnchainOS | 赞助商奖 | 用满 WaaS + Paymaster + Gateway |
| 🥉 ETHGlobal AI Agent | 创新奖 | AI vs AI 自主对战 |

---

## 3. 用户故事

### US-1:首次体验(30 秒入门)

```
玩家: /xiake
Claude: ⛩️ 欢迎入江湖。你的钱包尚无侠客。
        要免费招募三位创世侠客吗?(gas 由江湖盟主代付)
玩家: 好
Claude: [调 skill → OnchainOS Paymaster → 链上 mint]
        ✅ 铸造完成 (tx: 0xabc...)
        少林·圆智 / 唐门·飞燕 / 峨眉·静因
```

### US-2:PVE 闯关

```
玩家: 我想打第一关
Claude: 第一关:少林藏经阁。BOSS 武当·张三丰 (战力 200)
玩家: 上
Claude: [skill 模拟战斗 → 链上结算 → 返回战报]
        ⚔️ 战报:第 1 回合... 🏆 胜利,江湖声望 +50
```

### US-3:AI vs AI 自主对战(核心杀招)

```
玩家: 让我睡觉时我的侠客们自己去论剑
Claude: 已授权 AI Sifu 模式,接下来将自主挑战擂台前 5 名...
[8 小时后]
Claude: ☀️ 你睡觉时共打了 12 场,8 胜 4 负,排名 #203 → #87
        战报摘要:[MVP 侠客]、[最精彩一战]
```

### US-4:解说模式(演示专用)

```
[Agent A] vs [Agent B]
[Caster Agent]: "只见东邪唐门·飞燕一记落英神剑!"
                "西毒少林·圆智竟以金钟罩硬接,反震三尺!"
                ...
                "本局 MVP 为峨眉·静因,一招'慈航普渡'全队回血 60 点!"
```

### US-5:复盘分析

```
玩家: 复盘我上一场
Claude: [调 replay tool]
        对手门派组合:武当/明教/丐帮。你用唐门开场是好的...
        但第 3 回合你应该先控制对方丐帮,而不是集火武当...
        下次建议带峨眉净化 debuff。
```

---

## 4. 功能清单

### 4.1 Must(MVP,Week 1-2 必须交付)

| 模块 | 子功能 |
|---|---|
| 侠客系统 | 3 门派 × 3 侠客 = 9 种角色,每派 3 技能 |
| Mint | 免费 mint,OnchainOS Paymaster 代付 |
| PVE | 1 关(或 3 关),硬编码 BOSS 阵容 |
| **AI vs AI 同步对战** | **核心 demo**,两个 agent 互相挑战 |
| **解说 Agent** | **核心 demo**,tool call → 武侠文案 |
| 战报渲染 | ASCII 表格 + ANSI 颜色 + Unicode 血条 + streaming |
| 签名 | OnchainOS WaaS,EIP-712,严禁 export 私钥 |
| 复盘 | 查询历史战报 + LLM 分析 |

### 4.2 Nice(buffer 时间有才做)

- 多关 PVE + 剧情文本
- 真人 PVP(异步挑战列表)
- 赛季排行榜
- 更多门派(武当/丐帮/明教)

### 4.3 Won't(hackathon 范围外)

- NFT Marketplace 挂单交易
- 合成系统 / 秘籍残页
- 代币 / 经济模型
- 移动端 / 网页端
- 多赛季迁移

---

## 5. 玩法规则

### 5.1 门派设计(MVP 3 派)

| 门派 | 定位 | 属性倾向 | 技能示例 |
|---|---|---|---|
| **少林** | 坦克/治疗 | HP↑↑ DEF↑ SPD↓ | 金钟罩 (+30 DEF)、易筋经 (+30 HP 回复)、狮子吼 (群控 1 回合) |
| **唐门** | 刺客/爆发 | ATK↑↑ SPD↑↑ HP↓ | 穿心刺 (单体 150% ATK)、暗器急雨 (群体 80% ATK)、毒针 (持续 10% 最大 HP × 3 回合) |
| **峨眉** | 辅助/净化 | SPD↑ 功能向 | 慈航普渡 (全队 +20 HP)、净心咒 (驱散 debuff)、般若掌 (单体 120% ATK + 沉默 1 回合) |

### 5.2 侠客属性

```
HP       100-200    (最大生命)
ATK       60-100    (攻击)
DEF       40-100    (防御)
SPD       50-100    (速度,决定出手顺序)
CRIT        0-30    (暴击率 %)
```

### 5.3 战斗公式

```
baseDamage  = skillMultiplier × attacker.ATK - defender.DEF × 0.5
critDamage  = baseDamage × 1.5  (若 roll ≤ attacker.CRIT)
finalDamage = max(critDamage, 1)  // 保底 1 点
```

### 5.4 战斗流程

```
1. 3v3 对阵,共 6 个侠客
2. 按 SPD 降序轮流出手(相同 SPD 按侠客 tokenId 稳定排序)
3. 每回合每个存活侠客出手 1 次(技能从 3 个中随机或 AI 选)
4. 存活侠客全部死亡的一方败
5. 最多 30 回合,超时按剩余总 HP 判胜
```

### 5.5 AI vs AI 策略(关键决胜点)

两个 agent 战斗时,每回合通过 prompt 决策(非随机):

```
System prompt 给每个 agent:
  - 自己侠客状态(HP/buff/技能冷却)
  - 对方侠客状态(可见信息)
  - 上回合对方行动
  - 门派克制表

Agent 输出:
  - 出手侠客 + 技能选择 + 目标
  - 一句角色扮演台词(供解说 agent 使用)
```

---

## 6. 成功指标

### 6.1 开发过程

- ✅ Day 1 OnchainOS Skill SDK hello world 跑通
- ✅ Day 7 端到端 PVE 跑通
- ✅ Day 10 AI vs AI + 解说跑通
- ✅ Day 12 demo video 成片
- ✅ Day 14 提交

### 6.2 Demo Day

- Demo 现场 0 故障运行(录屏兜底)
- 评委 30 秒内理解"这是什么"(用 slogan + 开场画面)
- OnchainOS API 调用数 ≥ 5 种(WaaS / Wallet / Gateway / Paymaster / Security)

### 6.3 奖项

- 至少斩获 1 个(Anthropic MCP 或 OKX 赞助商)
- 冲击 Most Innovative

---

## 7. 发布计划

| 阶段 | 时间 | 交付 |
|---|---|---|
| Day 1 | 探雷 | Skill SDK + OnchainOS 链路验通 |
| Day 2-7 | 核心开发 | 合约 + MCP server + OnchainOS 集成 |
| Day 8-10 | 亮点 | ASCII 战报 + AI vs AI + 解说 agent |
| Day 11-12 | 打包 | Demo video + pitch deck + README |
| Day 13-14 | 提交 | GitHub + 黑客松平台提交 |
| Demo Day | 现场 | 3 分钟 pitch + Q&A |
| 赛后 | 可选 | PR 合入 okx/onchainos-skills + npm 发布 |

---

## 8. 非目标 & 已知风险

### 8.1 我们**不做**的事

- 不追求"好玩"(这是品类探索,不是 AAA)
- 不做美术精良(AI 生成 + emoji + ASCII)
- 不考虑长期留存 / 商业化(hackathon 范围外)
- 不做真人 PVP 异步推送(MCP 不支持 push)

### 8.2 已知风险(按严重度)

| 风险 | 概率 | 对策 |
|---|---|---|
| OnchainOS Skill SDK 文档不完整 | 70% | Day 1 探雷,4 小时原则,不通立刻 pivot 回网页版 |
| AI vs AI 变成"掷骰子" | 60% | 门派克制表 + counter-pick prompt + 复盘逻辑 |
| 评委不懂 MCP | 50% | Pitch 前 15 秒讲故事,不讲架构 |
| 现场 RPC 崩 | 70% | 预录高清视频兜底 |
| Prompt injection 导致私钥泄露 | 中 | 严禁 export 私钥进上下文,全走 WaaS API |

---

## 9. 决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| Skill 语言 | TypeScript + MCP SDK | 2 天起步,不需学 Rust |
| 链 | Base Sepolia(MVP)→ 主网可选 | OnchainOS + OKX 都支持,稳定 |
| 战斗 | 全链上确定性模拟 | 可验证,黑客松亮点 |
| 随机数 | `keccak256(prevrandao, ...)` | 伪随机够 demo,评委不查 |
| 美术 | Emoji + ASCII + 1 张封面 | 零成本,符合 CLI 美学 |
| 门派数 | MVP 3 派(可扩 6) | 平衡性 + 工期 tradeoff |
| PVP | 只做同步 AI vs AI | MCP 不支持 async push |

---

## 10. 附录

- 技术方案详见 `TECHNICAL_DESIGN.md`
- OnchainOS Skills 参考: https://github.com/okx/onchainos-skills
- MCP SDK: https://modelcontextprotocol.io
