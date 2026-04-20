# ⛩️ Xiake Arena · 侠客擂台

> **The first chain-game built for AI, not humans.**
> A Claude Code skill. A Solidity 3v3 wuxia brawler. No website, no wallet extension, no seed phrase.

**🌐 Language**: **English** · [中文](./README.zh.md)

[![Claude Code](https://img.shields.io/badge/Claude_Code-skill-5B5BD6)](https://claude.ai/code) [![MCP](https://img.shields.io/badge/MCP-compatible-blueviolet)](https://modelcontextprotocol.io) [![Base Sepolia](https://img.shields.io/badge/Base_Sepolia-deployed-0052FF)](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) [![OnchainOS](https://img.shields.io/badge/OnchainOS-integrated-00d1b2)](https://web3.okx.com/onchain-os/dev-portal) [![Tests](https://img.shields.io/badge/forge_tests-114/114_green-brightgreen)](./docs/C_LEVEL_TEST_SUMMARY.md) [![License](https://img.shields.io/badge/license-MIT-green)](#license)

<img width="1148" height="527" alt="Xiake Arena in Claude Code" src="https://github.com/user-attachments/assets/1ee71082-7a06-4a67-b79e-f83799293f01" />

---

## ⚡ The 60-Second Pitch

Web3 games die because they push humans through browser dApps, seed phrases, and gas popups. But **AI agents are the new dominant users of the internet** — they read docs, hold wallets, and execute on-chain.

**Xiake Arena** is a **7-sect wuxia 3v3 brawler** you play by typing `/xiake` inside Claude Code. The skill creates an MPC wallet via OKX OnchainOS, runs deterministic Solidity combat on Base, and narrates the fight in Jin Yong prose — all from one slash command.

```bash
$ claude
> /xiake
⛩️  你尚无门徒。要招募 3 位侠客吗?(gas 由 Paymaster 代付)
> yes
🥋 少林·圆智   ⚔️ 华山·令狐冲   🔥 明教·张无忌   🔗 tx 0x7a03… on Base
```

**No website · no extension · no seed phrase · no private key management.**

---

## 🎯 Why It Matters

| | |
|---|---|
| **Agent-Native UX** | The "UI" is a skill file + CLI. Say `/xiake` in Claude / Cursor / Codex — the storyteller takes over, issuing on-chain tx behind the scenes. |
| **Zero-Friction Wallet** | OnchainOS MPC wallet + Paymaster whitelist: first-time players never manage keys, never hold ETH, never see a popup. |
| **Fully On-Chain** | `BattleEngine.simulate()` is pure Solidity. 30 rounds, 7-sect rock-paper-scissors, one PRNG seed. No oracle, no hidden server, fully replayable. |
| **AI vs AI** | Two agents duel autonomously while a third caster agent narrates. The entire match replays from a single `BattleLog` event. |

---

## 🏛️ Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │  Player in Claude Code / Cursor / Codex                     │
 │  types: /xiake                                              │
 └──────────────────────┬──────────────────────────────────────┘
                        │
          ┌─────────────▼──────────────┐
          │  xiake-skill (TypeScript)  │  ~/.claude/skills/xiake/
          │  persona + CLI + renderer  │  9,606 LOC
          └─────────────┬──────────────┘
                        │ sign & route tx
          ┌─────────────▼──────────────┐
          │  OnchainOS WaaS + Paymaster│  OKX Dev Portal
          │  MPC wallet · gas sponsor  │
          └─────────────┬──────────────┘
                        │ submit
 ┌──────────────────────▼──────────────────────────────────────┐
 │  Base (Sepolia now · Mainnet next)                          │
 │                                                             │
 │    HeroNFT ── forwards paid fees ──→ GachaVault (48h lock)  │
 │       │                                                     │
 │       ├── setArena ───────→ Arena (v3)                      │
 │       │                        │                            │
 │    SkillRegistry ←── uses ─────┤                            │
 │                                ├── reads ──→ StageRegistry  │
 │                                │                            │
 │                                └── simulates ─→ BattleEngine│
 │                                                   │         │
 │                                       uses ──→ SectAffinity │
 └─────────────────────────────────────────────────────────────┘
```

**2,579 LOC Solidity · 7 contracts · 5 deployed, 2 library** — design details in [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md).

---

## 🌍 Live on Base Sepolia

**As of 2026-04-20**: 21 battles settled · 21 heroes minted · 0.014 ETH in vault · 13 stages registered — all verifiable on BaseScan.

| Contract | Address |
|---|---|
| **Arena v3** | [`0x567aE39f…FcC61`](https://sepolia.basescan.org/address/0x567aE39f1E1081E85a1d13b7135ef2d3Ea1FcC61) |
| **HeroNFT** | [`0x056bB8B1…0f4A`](https://sepolia.basescan.org/address/0x056bB8B1AeaaF4e5eB6a6b016fDE80C60e100f4A) |
| **GachaVault** (48h timelock) | [`0x47135Ba1…18A44`](https://sepolia.basescan.org/address/0x47135Ba1F3D9674869a63da07f40e42a57318A44) |
| **StageRegistry** | [`0x613497e2…9df7`](https://sepolia.basescan.org/address/0x613497e20D196952f169B316fd7Ad8f8eb519df7) |
| **SkillRegistry** | [`0xC1b36B70…f3E1`](https://sepolia.basescan.org/address/0xC1b36B703A349e2fB1B29c4B912C3144Ab69f3E1) |

Every on-chain action the skill takes prints a `🔗 <label> · tx 0x… · basescan.org/tx/…` line — judges click, verify, done.

---

## 🚀 Play in 60 Seconds

### Mock mode · offline, zero setup

```bash
git clone https://github.com/pengpatrick123/Xiake-onchain && cd Xiake-onchain/skill
npm install && npm run build
export XIAKE_CLI_PATH="$PWD/dist/cli.js"

claude
> /xiake
> 招募一个侠客          # or: mint 1
> 闯第一关              # or: pve 1-1
```

### Sepolia mode · real on-chain, free faucet ETH

```bash
cast wallet new                    # throwaway testnet wallet
# fund at: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet

export XIAKE_MODE=sepolia
export XIAKE_PLAYER_PK=0x...       # from `cast wallet new`
# contract addresses come pre-filled from .env.example

claude
> /xiake
> 领取每日签到
```

```
✅ 今日福利已领取!本周累积 1/7
🔗 grantDailyMint · tx 0xc1e02a…6006 · https://sepolia.basescan.org/tx/0xc1e02ab6…
```

| Mode | Chain | Signer | Gas | For |
|---|---|---|---|---|
| `mock` (default) | — | — | — | Offline tryout |
| `sepolia` | Base Sepolia | Local PK | Player pays (faucet) | Hackathon demo |
| `onchain` | Base Mainnet | OnchainOS MPC | Paymaster-sponsored | Production |

---

## 📚 Go Deeper

- **Architecture + contract map** — [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)
- **Full test run (6 phases, 45+ on-chain tx, 9 AI agents)** — [docs/C_LEVEL_TEST_SUMMARY.md](./docs/C_LEVEL_TEST_SUMMARY.md)
- **Bugs found & live-fixed (P0 chapter bug, P1 rep gate)** — [docs/TEST_FINDINGS.md](./docs/TEST_FINDINGS.md)
- **How to add sects/stages without redeploy** — [docs/CONTENT_UPDATES.md](./docs/CONTENT_UPDATES.md)
- **Sepolia deploy runbook** — [docs/DEPLOY_PLAYBOOK.md](./docs/DEPLOY_PLAYBOOK.md)
- **Per-contract code review** — [docs/CODE_REVIEW.md](./docs/CODE_REVIEW.md)

### The Numbers

2,579 LOC Solidity · 9,606 LOC TypeScript · **114/114 forge tests green** · 4 invariants × 2,048 random ops each · 2 production bugs caught and fixed live via `UpgradeArena.s.sol` hot-upgrade (proven twice).

### Stack

**Contracts** — Foundry · OpenZeppelin v5 · Solidity 0.8.24
**Skill** — TypeScript · viem · axios · MCP · Anthropic SDK
**Infra** — OKX OnchainOS (WaaS · Paymaster · Gateway) · Base Sepolia

---

## 📜 License

MIT. Built as a hackathon submission for **OnchainOS × Claude Code · 2026-04**.

Paired with **Claude Opus 4.7 (1M context)** on every commit.
