# Xiake Arena · 侠客擂台

> **The first game built for AI, not humans.**
> 首款为 AI 而生的链游。一条斜杠命令,整个江湖在链上开打。

[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-5B5BD6)](https://claude.ai/code) [![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io) [![Base Sepolia](https://img.shields.io/badge/Base_Sepolia-deployed-0052FF)](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) [![OnchainOS](https://img.shields.io/badge/OnchainOS-integrated-00d1b2)](https://web3.okx.com/onchain-os/dev-portal) [![Tests](https://img.shields.io/badge/forge_tests-114/114_green-brightgreen)](./docs/C_LEVEL_TEST_SUMMARY.md) [![License](https://img.shields.io/badge/license-MIT-green)](#license)

---
<img width="1148" height="527" alt="image" src="https://github.com/user-attachments/assets/1ee71082-7a06-4a67-b79e-f83799293f01" />


## 30-Second Pitch

Web3 games die because they force humans into browser dApps, seed phrases, and gas popups. But AI agents are the **new dominant users** of the internet — they read docs, hold wallets, and execute on-chain. The next killer chain-game isn't another web app. It's a **Claude Code skill** that agents invoke on the user's behalf.

**Xiake Arena** is that proof: a **7-sect wuxia 3v3 brawler** running 100% on Base with deterministic Solidity combat, invoked as `/xiake` inside Claude Code. OnchainOS provides MPC wallets + Paymaster so the player never manages keys or ETH.

```bash
$ claude
> /xiake
⛩️  侠客擂台 · 你尚无门徒。要招募 3 位侠客吗?(gas 由 Paymaster 代付)
> yes
🥋 少林·圆智  ⚔️ 华山·令狐冲  🔥 明教·张无忌    tx 0x7a03… on Base
```

No website · no wallet extension · no app install · no private key management.

---

## Live Deployment (Base Sepolia · chainId 84532)

| Contract | Address | Purpose |
|---|---|---|
| **Arena** (v3) | [`0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61`](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) | PVE / PVP entry, battle settlement |
| **HeroNFT** | [`0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A`](https://sepolia.basescan.org/address/0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A) | ERC-721 heroes, gacha economy |
| **GachaVault** | [`0x47135Ba1F3D9674869a63da07f40e42a57318A44`](https://sepolia.basescan.org/address/0x47135Ba1F3D9674869a63da07f40e42a57318A44) | Owner-only revenue sink · 48h timelock |
| **StageRegistry** | [`0x613497e20D196952f169B316fd7Ad8f8eb519df7`](https://sepolia.basescan.org/address/0x613497e20D196952f169B316fd7Ad8f8eb519df7) | 13 stages registered · owner can hot-add more |
| **SkillRegistry** | [`0xC1b36B703A349e2fB1B29c4B912C3144Ab69f3E1`](https://sepolia.basescan.org/address/0xC1b36B703A349e2fB1B29c4B912C3144Ab69f3E1) | 21 baseline skills · 7 sects × 3 each |

Live stats (as of 2026-04-20): **21 battles settled · 21 heroes minted · 0.014 ETH vault revenue · 13 stages registered**, all verifiable on BaseScan. Every on-chain action the skill takes prints a `🔗 <label> · tx 0x… · https://sepolia.basescan.org/tx/…` line so judges can click through.

---

## Table of Contents

1. [The Four Ideas](#the-four-ideas)
2. [Quick Start](#quick-start-2-minutes)
3. [Architecture](#architecture)
4. [Game Content](#game-content)
5. [OnchainOS Integration](#onchainos-integration)
6. [Test Coverage](#test-coverage)
7. [Repo Layout](#repo-layout)
8. [Development](#development)
9. [Roadmap](#roadmap)
10. [License](#license)

---

## The Four Ideas

### 1. Agent-Native UX
The UI isn't a React app. It's a **Claude Code skill** (`skill.md` + TypeScript CLI) that lives at `~/.claude/skills/xiake/`. Say `/xiake` in any Claude session and the storyteller persona takes over, translating game data into 武侠 narration while issuing on-chain tx behind the scenes. Works the same in Cursor, Codex, OpenCode — anywhere MCP runs.

### 2. OnchainOS Composable Wallet
Every player gets an **MPC wallet** from OKX OnchainOS WaaS at first use — zero seed phrase, zero extension install. Gas is sponsored by a **Paymaster policy** whitelisting our three game entrypoints (`mintHeroTier`, `startPve`, `challenge`). Players spend 0.005 ETH per paid pull; everything else is free at the network layer.

### 3. AI vs AI Autonomy
Two agents can challenge each other autonomously while a third **caster agent** narrates the battle in Jin Yong prose. The whole match — teams, seed, event log — is deterministically reproducible from the `BattleLog` event emitted on-chain, so anyone can replay any historical fight client-side.

### 4. Fully On-Chain Determinism
Combat is **a pure Solidity function** (`BattleEngine.simulate`). 30 rounds max, 7-sect rock-paper-scissors damage modifiers (`SectAffinity.multiplierBps`), crit/miss/control/DoT resolved from one PRNG seed. No off-chain oracle, no hidden server — auditable, forkable, MEV-resistant.

---

## Quick Start

### Three Modes

| `XIAKE_MODE` | Who it's for | Chain | Signs with | Gas |
|---|---|---|---|---|
| `mock` (default) | First-time tryout, offline play | — | — | — |
| **`sepolia`** | **Testnet demo** — judge can click into every BaseScan tx | Base Sepolia | Local `XIAKE_PLAYER_PK` | Player pays (free faucet ETH) |
| `onchain` | Production | Base Mainnet | OnchainOS MPC wallet | Paymaster-sponsored |

> **Why three modes?** OnchainOS only supports mainnet chains, but we need a way for hackathon judges to verify real on-chain tx without committing to mainnet ETH. `sepolia` mode bridges that gap: same contract calls, same game logic, just with a local keypair instead of OnchainOS MPC.

### Play in `mock` mode (offline, 2 minutes)

```bash
# 1. Build the CLI
cd skill && npm install && npm run build
export XIAKE_CLI_PATH="$PWD/dist/cli.js"

# 2. Install the Claude skill (one-time, user-level)
mkdir -p ~/.claude/skills/xiake
cp ~/.claude/skills/xiake/skill.md ~/.claude/skills/xiake/  # or copy from repo

# 3. Play in Claude Code
claude
> /xiake
> 招募一个侠客   # or "mint 1"
> 闯第一关       # or "pve 1-1"
```

State persists in `~/.xiake/state.json`. No chain, no keys.

### Play in `sepolia` mode (real on-chain, 5 minutes)

```bash
# 1. Generate a throwaway testnet wallet
cast wallet new
# Address:     0xABC...
# Private key: 0xDEF...

# 2. Fund it from the Coinbase faucet (free)
#    https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
#    → send to 0xABC...

# 3. Point the skill at Sepolia + your wallet
export XIAKE_MODE=sepolia
export XIAKE_PLAYER_PK=0xDEF...
export XIAKE_HERO_ADDRESS=0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A
export XIAKE_ARENA_ADDRESS=0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61
export XIAKE_VAULT_ADDRESS=0x47135Ba1F3D9674869a63da07f40e42a57318A44
export BASE_SEPOLIA_RPC=https://sepolia.base.org

# 4. Play — every action now hits Base Sepolia
claude
> /xiake
> 领取每日签到
```

Output:
```
✅ 今日福利已领取!本周累积 1/7
🔗 grantDailyMint · tx 0xc1e02a…6006 · https://sepolia.basescan.org/tx/0xc1e02ab6...
```

Every on-chain action prints a unified tx line with a clickable BaseScan URL:

```
🔗 mintHeroTier(silver, paid) · tx 0x9100…34be · https://sepolia.basescan.org/tx/0x9100…
🔗 startPve(1-1)              · tx 0xbeef…dead · https://sepolia.basescan.org/tx/0xbeef…
🔗 challenge                   · tx 0xabc1…ef98 · https://sepolia.basescan.org/tx/0xabc1…
🔗 setDefenseTeam              · tx 0x1234…5678 · https://sepolia.basescan.org/tx/0x1234…
```

### As a developer (running tests)

```bash
cd contracts
# Foundry deps are checked in as git submodules — no `forge install` needed
forge test               # 114 tests, all green
forge snapshot           # regenerate gas baseline
```

### As a judge (inspect the live deployment, 1 minute)

- All battles + events: <https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61#events>
- Vault revenue ledger: <https://sepolia.basescan.org/address/0x47135Ba1F3D9674869a63da07f40e42a57318A44>
- Full autonomous test run with 45+ on-chain tx from 9 AI agents: [docs/C_LEVEL_TEST_SUMMARY.md](./docs/C_LEVEL_TEST_SUMMARY.md)

---

## Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Player in Claude Code / Cursor / Codex                      │
 │  types: /xiake                                              │
 └──────────────────────┬──────────────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │  xiake-skill (TypeScript)  │  ~/.claude/skills/xiake/
          │  persona + CLI + renderer  │  9,606 LOC
          └─────────────┬──────────────┘
                        │ 签名 & tx 路由
          ┌─────────────▼──────────────┐
          │  OnchainOS WaaS + Paymaster│  OKX Dev Portal
          │  MPC wallet · gas sponsor  │
          └─────────────┬──────────────┘
                        │ 上链
 ┌──────────────────────▼──────────────────────────────────────┐
 │  Base (Sepolia now · Mainnet next)                          │
 │                                                             │
 │    HeroNFT ─ forwards paid fees ─→ GachaVault (48h timelock) │
 │       │                                                      │
 │       ├─ setArena ──────────→  Arena (v3)                    │
 │       │                         │                            │
 │    SkillRegistry ←──────── uses─┤                            │
 │                                 ├── reads ──→ StageRegistry  │
 │                                 │                            │
 │                                 └── simulates ─→ BattleEngine│
 │                                                    │         │
 │                                        uses ──→ SectAffinity │
 └─────────────────────────────────────────────────────────────┘
```

**2,579 LOC Solidity · 114 unit tests · 4 invariant tests (2,048 random ops each)** — see [docs/CODE_REVIEW.md](./docs/CODE_REVIEW.md).

---

## Game Content

### 7 Sects with a 7-Ring Damage Matrix

| # | Sect | Role | Signature Skills | Counters → |
|---|---|---|---|---|
| 0 | 🥋 少林 Shaolin | Tank · Healer | 金钟罩 / 易筋经 / 狮子吼 | Tangmen (+15%) |
| 1 | 🗡️ 唐门 Tangmen | Assassin · Burst | 穿心刺 / 暗器急雨 / 毒针 | Emei (+15%) |
| 2 | ⛩️ 峨眉 Emei | Support · Cleanse | 慈航普渡 / 净心咒 / 般若掌 | Wudang (+15%) |
| 3 | ☯️ 武当 Wudang | Balanced · Counter | 太极推手 / 梯云纵 / 真武破军 | Beggars (+15%) |
| 4 | 🥖 丐帮 Beggars | Control · Buff | 降龙十八掌 / 打狗棒法 / 醉八仙 | Huashan (+15%) |
| 5 | ⚔️ 华山 Huashan | Swords · High Crit | 独孤九剑 / 紫霞神功 / 华山群剑 | Ming (+15%) |
| 6 | 🔥 明教 Ming | Poison · Armor Break | 圣火令 / 乾坤大挪移 / 毒沙掌 | Shaolin (+15%) |

Full ring: `Shaolin → Tangmen → Emei → Wudang → Beggars → Huashan → Ming → Shaolin`. No sect dominates; team composition matters.

### 12 Story Stages + Dynamic Extensions

3 chapters × 4 stages · reputation gates 0 / 55 / 130 / 240:

- **Ch 1 初入江湖** — Shaolin試煉 → 唐門小試 → 峨眉清談 → 武當坐忘 👑
- **Ch 2 門派恩怨** — 丐幫爭粥 → 華山論劍 → 藏經閣守衛 → 唐門暗堂 👑
- **Ch 3 魔教來襲** — 光明頂前哨 → 四大護教法王 → 聖女勸降 → 教主決戰 👑

The `StageRegistry.addStage` hot-path lets the content curator add new stages via a single tx — **no contract redeploy required**. A 13th stage was added post-launch as a demo.

### Gacha Economy

- **3 free pulls** on first mint (consumed then locked)
- **3 price tiers**: Bronze 0.001 / Silver 0.005 / Gold 0.010 ETH
- **10-pull discount**: -10%
- **Sect-pity (30 抽)** forces the next rotation sect
- **BOSS-pity (80 抽)** guarantees a signature skill bead
- **Duplicate exchange**: burn 1 NFT = 5 reputation shards
- **Referral reward**: referrer gets 0.002 ETH on referee's first paid pull

All revenue lands in `GachaVault`, which only the owner address (set once at deploy) can touch — via a **48-hour timelock**. No rug pull possible by design.

---

## OnchainOS Integration

Xiake Arena is built on top of OKX [OnchainOS](https://web3.okx.com/onchain-os/dev-portal) skills:

- **[okx-agentic-wallet](https://github.com/okx/onchainos-skills/tree/main/skills/okx-agentic-wallet)**: first-run MPC wallet creation, address resolution, per-player TEE signing
- **[okx-onchain-gateway](https://github.com/okx/onchainos-skills/tree/main/skills/okx-onchain-gateway)**: gas estimation, transaction broadcasting, receipt polling
- **Paymaster policy** whitelists `mintHeroTier` / `startPve` / `challenge` selectors so players never need ETH to play

Install the OnchainOS CLI first:
```bash
curl -sSL https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh
onchainos wallet login  # AK login with OKX Dev Portal credentials
```

Then set `XIAKE_MODE=onchain` in `.env` and the skill routes all tx through OnchainOS.

---

## Test Coverage

We treat this game as a financial instrument, not a toy. Results from the **C-level test run (2026-04-20)**:

| Category | Count | Notes |
|---|---|---|
| forge unit tests | **114** | all green, 6 test files |
| forge invariant tests | 4 × 64 runs × 32 depth | vault ledger never drifts across 2,048 random ops |
| edge-probe revert paths | 15 | each matches the exact revert reason |
| Sepolia integration tx | 45+ | from 9 autonomous Claude agents across 3 teams |
| stress-test battles | 18 serial PVE | gas variance only ±12.6% (no drift, no state corruption) |

Two production bugs were found **during testing and fixed live**:
1. **P0** — PVE victory didn't advance `storyProgress.currentChapter` → **fixed** (Arena v2)
2. **P1** — `stage.minReputation` was stored but never enforced by `startPve` → **fixed** (Arena v3)

Arena has been redeployed twice using `script/UpgradeArena.s.sol` without touching the other contracts — players keep all hero NFTs and vault balances.

See:
- [docs/C_LEVEL_TEST_SUMMARY.md](./docs/C_LEVEL_TEST_SUMMARY.md) — full 6-phase playthrough
- [docs/TEST_FINDINGS.md](./docs/TEST_FINDINGS.md) — bug list + root cause
- [docs/CODE_REVIEW.md](./docs/CODE_REVIEW.md) — per-contract review
- [docs/DEPLOY_PLAYBOOK.md](./docs/DEPLOY_PLAYBOOK.md) — step-by-step Sepolia deploy runbook

---

## Repo Layout

```
jianghu/
├── README.md                   ← this file
├── contracts/                  ← Solidity (2,579 LOC)
│   ├── src/
│   │   ├── Arena.sol           PVE + PVP + injury + learnSkill + rep gate
│   │   ├── HeroNFT.sol         ERC-721 + gacha + referral + exchange + pity
│   │   ├── GachaVault.sol      48h timelock revenue sink
│   │   ├── StageRegistry.sol   Hot-add new PVE stages (owner/curator)
│   │   ├── SkillRegistry.sol   21 baseline skills + addSkill admin
│   │   ├── BattleEngine.sol    Pure simulate(teamA, teamB, seed)
│   │   ├── SectAffinity.sol    7-ring rock-paper-scissors (±15% dmg)
│   │   └── Types.sol
│   ├── test/                   ← 114 tests + 4 invariants
│   └── script/
│       ├── Deploy.s.sol        Full stack deploy
│       └── UpgradeArena.s.sol  Arena-only hot-upgrade (proven twice)
│
├── skill/                      ← Claude Code skill (TypeScript · 9,606 LOC)
│   ├── src/
│   │   ├── cli.ts              Main command dispatcher (25 commands)
│   │   ├── onchainos/          OnchainOS WaaS + Paymaster + Gateway
│   │   ├── chain/              viem ABI + on-chain reads
│   │   ├── render/             ANSI battle reports
│   │   ├── caster/             AI vs AI orchestrator
│   │   └── tools/              MCP tool handlers
│   ├── mcp.json                Claude Code MCP manifest
│   └── package.json            → `xiake-skill` on npm (pending publish)
│
└── docs/                       ← 10 design + test documents
    ├── PRD.md
    ├── TECHNICAL_DESIGN.md
    ├── GACHA_PRD_TECH.md        Gacha economy PRD
    ├── CONTENT_UPDATES.md       How to add content post-launch
    ├── CODE_REVIEW.md           Per-contract security/gas review
    ├── TEST_PLAN_C.md           6-phase test methodology
    ├── C_LEVEL_TEST_SUMMARY.md  Full test run report
    ├── TEST_FINDINGS.md         Bug list + fixes
    ├── STATUS_REPORT.md         Completion score & roadmap
    └── DEPLOY_PLAYBOOK.md       Sepolia deploy runbook
```

---

## Development

### Rebuild & test

```bash
cd contracts && forge test
cd ../skill && npm run build && npm test
```

### Re-deploy only the Arena (proven hot-upgrade path)

```bash
cd contracts
forge script script/UpgradeArena.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

The script re-wires `HeroNFT.setArena(newArena)` so historical `HeroNFT` / `Vault` / `StageRegistry` / `SkillRegistry` continue to work — players keep all hero NFTs and vault balances.

### Play on a fresh Sepolia wallet (judge-friendly)

1. Get Sepolia ETH: [Coinbase faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet) (0.05 ETH free per day)
2. Mint genesis:
   ```bash
   cast send 0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A \
     "mintGenesis(address)" $YOUR_ADDR \
     --rpc-url https://sepolia.base.org \
     --private-key $YOUR_PK \
     --gas-limit 2000000
   ```
3. Set defense: `cast send <Arena> "setDefenseTeam(uint256[3])" "[<ids>]" ...`
4. First PVE: `cast send <Arena> "startPve(uint256[3],uint8)" "[<ids>]" 1 --gas-limit 4000000 ...`

Total cost: ≈ **$0.05 in Sepolia gas** to play a full chapter.

---

## Roadmap

| Milestone | Status | Target |
|---|---|---|
| 7 sects · 12 stages · 21 skills on-chain | ✅ deployed | 2026-04 |
| 114 forge tests + invariants | ✅ green | 2026-04 |
| Sepolia · 45+ integration tx from AI agents | ✅ verified | 2026-04 |
| `StageRegistry.addStage` hot-add workflow | ✅ demonstrated | 2026-04 |
| OnchainOS live mainnet E2E (player `/xiake` zero-key) | 🟡 blocked on Base mainnet deploy | 2026-05 |
| `Pyth Entropy` replacing `block.prevrandao` | 🔲 | 2026-06 |
| Slither + Aderyn pre-audit | 🔲 | 2026-06 |
| Dune analytics board | 🔲 | 2026-06 |
| Season rankings + leaderboard on-chain | 🔲 | 2026-07 |
| npm publish `xiake-skill@1.0` | 🔲 | when OnchainOS mainnet live |

---

## License

MIT. Built as a hackathon submission for **OnchainOS × Claude Code · 2026-04**. Contributions welcome.

If you fork this for your own chain-game, the three non-negotiable rules we baked into the code are worth reading first: [docs/CONTENT_UPDATES.md §0](./docs/CONTENT_UPDATES.md) (the three red lines).

**Built with**: Claude Opus 4.7 (1M context) as pair-programmer across every commit · foundry for contracts · viem + axios for skill.
