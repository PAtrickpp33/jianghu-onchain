# 侠客擂台 · Base Sepolia 部署 Runbook

> 目标: 把合约从本地搬到公开测试网, 让玩家在 Claude Code 里 `/xiake` 玩真游戏。
> 预计总时间: **2.5 小时**(你操作 1 小时, 我执行 1.5 小时), 其中一半等区块确认和邮件审核。

---

## 0. 先决条件清单

你需要**先**准备好这 5 件东西。这是瓶颈, 合约代码已经 ready。

| # | 项目 | 你去哪拿 | 时间 |
|---|---|---|---|
| 1 | **Base Sepolia ETH**(deployer 用) | https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet | 1 分钟 |
| 2 | **Deployer 私钥** | MetaMask → 导出 private key (专门建一个, 别用主钱包!) | 1 分钟 |
| 3 | **OWNER 地址** | 你的冷钱包地址(Ledger 或 Trezor 推荐, 只是**地址**, 不是 pk)。这个账户是 Vault 唯一提款人 | 1 分钟 |
| 4 | **OKX Dev Portal API key** | https://www.okx.com/web3/dev-portal → Create Project → API credentials | 20-30 分钟(含 KYC) |
| 5 | **BaseScan API key**(可选, 做合约 verify) | https://basescan.org/myapikey | 5 分钟 |

其中 #4 的 Paymaster Policy 我来帮你配 — 你只要把 API key / secret / passphrase / project id 给我就行。

---

## 1. 填 `.env`(你做, 5 分钟)

把 `.env.example` 拷贝成 `.env`, 把下面这些填上:

```bash
# ─── 1. 链 / 部署 ─────────────────────────────────
BASE_SEPOLIA_RPC=https://sepolia.base.org
CHAIN_ID=84532
DEPLOYER_PK=0x<你导出的 private key>
OWNER_ADDRESS=0x<你的冷钱包地址>
BASESCAN_API_KEY=<可选, 用于 verify>

# ─── 2. OKX OnchainOS ────────────────────────────
OKX_API_KEY=<从 Dev Portal 拿>
OKX_SECRET_KEY=<从 Dev Portal 拿>
OKX_PASSPHRASE=<你自己设的>
OKX_PROJECT_ID=<从 Dev Portal 拿>
OKX_PAYMASTER_POLICY_ID=<先留空, 第 4 步填>
OKX_API_BASE_URL=https://www.okx.com

# ─── 3. Anthropic (AI vs AI 解说用) ───────────────
ANTHROPIC_API_KEY=<https://console.anthropic.com/settings/keys>
CASTER_MODEL=claude-haiku-4-5
AGENT_A_MODEL=claude-sonnet-4-5
AGENT_B_MODEL=claude-haiku-4-5

# ─── 4. 合约地址 (部署后我填回来) ─────────────────
XIAKE_HERO_ADDRESS=
XIAKE_ARENA_ADDRESS=
XIAKE_VAULT_ADDRESS=
```

**检查清单**:
- [ ] `DEPLOYER_PK` 对应的地址有 **≥ 0.5 Sepolia ETH**(部署 + wire 需要)
- [ ] `OWNER_ADDRESS` 跟 `DEPLOYER_PK` 派生地址**不是同一个**(建议, 冷热分离)
- [ ] `.env` **没有** commit 到 git(已被 .gitignore 兜住)

---

## 2. 部署合约到 Sepolia(我做, 15 分钟)

一条命令部署 5 个合约 + seed 12 关 + wire setArena:

```bash
cd contracts

source ../.env
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $DEPLOYER_PK \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvv
```

输出会是:
```
SkillRegistry: 0x...
GachaVault:    0x...
HeroNFT:       0x...
StageRegistry: 0x...
Arena:         0x...
Stages seeded: 12
```

**我自动做的事**:
- 部署 5 个合约(约 5 笔 tx, ~0.05 Sepolia ETH gas)
- 在 StageRegistry 里 seed 12 关剧情(再 13 笔 tx)
- HeroNFT.setArena → 让战斗结算能写伤病
- 在 BaseScan 上 verify 所有合约源码(可选, 给玩家看)
- 往 `.env` 里填回合约地址

**你手动做的一步**(因为 OWNER != deployer): 从你的冷钱包地址用 MetaMask 发一笔:

```
目标合约: GachaVault 地址
方法:     setHeroNft(HeroNFT 地址)
value:    0
```

为什么必须你签:**这是唯一能让 Vault 绑定到 HeroNFT 的动作,而且绑完就不可改**。不交给 deployer key 签,是为了强化"OWNER 才是真正的经济控制人"。

完了后我 `cast call GachaVault.heroNft()` 验证 == HeroNFT 地址。

---

## 3. OKX Dev Portal 配置(你做, 30-40 分钟)

### 3.1 注册 Project

1. 登录 https://www.okx.com/web3/dev-portal
2. 创建 Project, 名字随便(比如 `xiake-arena-sepolia`)
3. 在 Project → **API Credentials** 里生成:
   - API Key
   - Secret Key
   - Passphrase(你自己设, 记住别丢)
   - Project ID(自动分配)
4. 把这 4 个值填进 `.env`

### 3.2 开通 WaaS (MPC wallet)

Project Dashboard → 启用 **Wallet API** / **WaaS**。这个是玩家的 MPC 钱包服务, 默认 free tier 支持足够多用户。

### 3.3 创建 Paymaster Policy

Project Dashboard → **Paymaster** → **Create Policy**。配置:

| 字段 | 填什么 |
|---|---|
| Policy Name | `xiake-game-sponsorship` |
| Target Chain | `Base Sepolia` |
| Whitelisted Contracts | 我第 2 步部署完给你的 HeroNFT + Arena 地址 |
| Whitelisted Methods | 3 个 selector: `mintHeroTier`, `startPve`, `challenge`(我会给你精确 selector bytes) |
| Gas Budget | Sepolia 无成本, 设 `unlimited` 或你舒服的数 |
| Max Per Tx | 不限(Sepolia 免费 gas) |

Policy 创建完会给你一个 **Policy ID**。填进 `.env` 的 `OKX_PAYMASTER_POLICY_ID`。

### 3.4 给我这 4 个 key

我拿到 API key / secret / passphrase / project_id + policy_id 就能接着跑。在聊天里粘贴或者直接让我读 `.env`(**.env 本来就 gitignored, 我访问没事**)。

---

## 4. 构建 skill + 测试 onchain 模式(我做, 30 分钟)

### 4.1 编译 skill

```bash
cd skill
npm install
npm run build
```

产出 `skill/dist/cli.js`。

### 4.2 把合约地址塞进 skill 运行时

skill 读的是 `.env`(或 env vars):
- `XIAKE_HERO_ADDRESS`
- `XIAKE_ARENA_ADDRESS`
- `XIAKE_VAULT_ADDRESS`
- `XIAKE_MODE=onchain`

### 4.3 End-to-end 冒烟

```bash
export XIAKE_MODE=onchain
export XIAKE_STATE_DIR=/tmp/xiake-sepolia-test

# 1. init — 读 mode, 初始化 OnchainOS MPC wallet
node skill/dist/cli.js init

# 2. 招募 3 侠客 (走 free allowance, Paymaster 代付)
node skill/dist/cli.js mint 3

# 3. 查看侠客 (确认链上读成功)
node skill/dist/cli.js heroes

# 4. 闯第一关
node skill/dist/cli.js pve 1-1

# 5. 付费抽卡 (0.005 ETH 真花出去, 进 Vault)
node skill/dist/cli.js mint paid 1

# 6. 查 vault 余额
cast call $XIAKE_VAULT_ADDRESS "getPoolBalance()(uint256)" --rpc-url $BASE_SEPOLIA_RPC
# 应该 == 5e15 wei = 0.005 ETH
```

6 步全绿 = **OnchainOS 全链路通了**。真玩家体验从此开始复制这 6 步。

---

## 5. Skill 注册更新(我做, 5 分钟)

`~/.claude/skills/xiake/skill.md` 已经写好, 最后一处要改:**合约地址写进 skill 默认配置**, 让玩家首次用时不需要手动设 `.env`。

两种做法, 你选:

### 做法 A(推荐): 把 Sepolia 地址写进 skill.md

我在 skill.md 里加一段:
```markdown
## 默认 Sepolia 部署
- HeroNFT:  0x... 
- Arena:    0x...
- Vault:    0x...
每个新玩家默认连这三个地址的 Base Sepolia deployment。
```
玩家 `/xiake` 就直接玩已部署的合约。

### 做法 B: 每人自建 Project

skill.md 提示玩家自己部署。更"去中心化"但用户上手门槛高。

**Sepolia 阶段选 A**, mainnet 阶段再考虑 B(或者走 `onchainos-skills` 包发布)。

---

## 6. Demo 视频 / 对外开放(~30 分钟, 可选)

做完 5 步后:

- **AI vs AI 真·自动对战**: `node skill/dist/cli.js pvp --ai-vs-ai` 跑一场 Claude Sonnet vs Claude Haiku, caster-agent 实时解说, 录屏 2 分钟
- **分享部署地址**: 往社区/Twitter 发 `https://sepolia.basescan.org/address/<ARENA>`, 邀请人 `/xiake` 试玩
- **Dune 看板**: 2 小时起一个, 看 mint 数 / vault 池子 / DAU

---

## 总时间 / 依赖链

```
  [你: OKX KYC + Paymaster]  30-40 min  ┐
                                         ├─→ [我: 合约部署]     15 min
  [你: Sepolia ETH 充值]      1 min   ┘        │
                                              ├─→ [你: owner setHeroNft]  2 min
                                              │     │
                                              │     ├─→ [我: skill build + E2E 冒烟]  30 min
                                              │     │
                                              │     ├─→ [我: 默认地址写 skill.md]    5 min
                                              │     │
                                              │     └─→ 玩家可 /xiake 玩 ✅
```

**瓶颈是 OKX 注册 + Paymaster 配置的 30-40 分钟**。那段我在旁边等你 key 就好, 不阻塞其它准备工作。

---

## 应急清单

| 状况 | 怎么办 |
|---|---|
| Sepolia ETH 不够 | 再去一次 faucet, 每天能领 0.05 ETH |
| Deploy 失败(verify 慢) | `--no-verify` 先部署, 之后单独 verify |
| `setHeroNft` 忘了签 | 付费 mint 会 revert, 随时补一笔 |
| OnchainOS 403 | 检查 API key / IP 白名单 / Paymaster policy chain |
| 玩家 `/xiake` 报错 `OKX_API_KEY missing` | 改 skill.md 加上明确提示 |
| 想回滚 | Sepolia 合约无法删, 但可以 `setEmergencyPause(true)` 冻结 mint, `scheduleWithdrawal` 把 Vault 里的钱抽回 |

---

## 现在轮到你做的三件事

1. **充 Sepolia ETH** 到 deployer 地址(1 分钟)
2. **去 OKX Dev Portal 注册 + 申请 API key + 开 Paymaster policy**(30-40 分钟, 卡在 KYC 上)
3. **填好 `.env`**(除了合约地址 + Policy ID), 告诉我可以开工

我等你 ping。你把 OKX key 准备好, 我 15 分钟内部署完第 2 步, 加上 skill 冒烟一共 45 分钟搞定。
