# xiake-skill · 侠客擂台

> A fully on-chain 3v3 wuxia brawler, played from inside **Claude Code / Cursor / Codex** as a skill.

`xiake-skill` ships the CLI engine that powers the `xiake` skill. It handles hero minting, PvE chapters, AI-vs-AI arena matches, wounds, and skill-bead equipment — in mock mode by default, and on Base Sepolia when OnchainOS env is configured.

---

## Install

```bash
npm install -g xiake-skill
```

Requires **Node.js ≥ 20**. Verify the install exposes the `xiake-skill` binary:

```bash
xiake-skill init
# ⛩️  Welcome to Jianghu ...
```

---

## Claude Code skill setup

The skill definition lives at `<repo>/.claude/skills/xiake/skill.md` and invokes the CLI over Bash. Point the skill at the installed binary:

```bash
# macOS / Linux
export WUXIA_CLI_PATH="$(which xiake-skill)"

# Windows (PowerShell)
$env:WUXIA_CLI_PATH = (Get-Command xiake-skill).Source
```

Or call the published entry via `npx`:

```bash
npx -y xiake-skill <command>
```

Minimal `skill.md` snippet (the repo ships a full version):

```markdown
---
name: xiake
description: 侠客擂台 — 武侠 3v3 回合制对战链游
---
Run the CLI via Bash: `xiake-skill <command> [args...]`.
On first call use `init`, then `mint 3`, then `pve 1-1`.
```

State is persisted to `~/.wuxia/state.json` (override via `WUXIA_STATE_DIR`).

---

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| `mock` (default) | no OnchainOS env | heroes minted locally, battles simulated in JS |
| `onchain` | `WUXIA_HERO_ADDRESS` + `OKX_API_KEY` + `OKX_SECRET_KEY` + `OKX_PASSPHRASE` + `OKX_PROJECT_ID` | mints via ERC-721, battles written to Arena contract on Base Sepolia |

Required onchain env vars:

```bash
export BASE_SEPOLIA_RPC="https://sepolia.base.org"
export WUXIA_HERO_ADDRESS="0x..."
export WUXIA_ARENA_ADDRESS="0x..."
export OKX_API_KEY="..."
export OKX_SECRET_KEY="..."
export OKX_PASSPHRASE="..."
export OKX_PROJECT_ID="..."
```

The CLI prints the active mode on the first line of every `init` call.

---

## Command cheatsheet

| Command | Description |
|---------|-------------|
| `xiake-skill init` | Welcome banner + game menu. Always run first in a new session. |
| `xiake-skill mint [1..3]` | Mint 1-3 genesis heroes (mock appends, onchain calls `mintHero`). |
| `xiake-skill heroes` | List owned heroes. `⚕️` = wounded, `🎁` = has skill beads. |
| `xiake-skill team <a> <b> <c>` | Set the active 3v3 roster by tokenId. |
| `xiake-skill stages` | Show PvE chapters with unlock status. |
| `xiake-skill pve <stageId>` | Run a PvE battle. Accepts `1-1` or legacy `1`. |
| `xiake-skill pvp` | Run an AI-vs-AI match with your active team. |
| `xiake-skill wounds` | Show injured heroes and remaining recovery seconds. |
| `xiake-skill equip <heroId> <slot> <skillId>` | Equip a collected skill bead into slot 0-2. |
| `xiake-skill arena` | Arena / leaderboard commands (PvP mode). |
| `xiake-skill status` | Dump current game state (reputation, cleared stages, battle history). |

All commands print human-readable output on stdout and return non-zero on usage errors.

---

## Typical session

```bash
xiake-skill init
xiake-skill mint 3
xiake-skill stages
xiake-skill pve 1-1
xiake-skill wounds
xiake-skill pvp
xiake-skill status
```

---

## Links

- Repo: https://github.com/PAtrickpp33/jianghu
- OnchainOS Skills: https://github.com/okx/onchainos-skills
- Model Context Protocol: https://modelcontextprotocol.io

## License

MIT — see [LICENSE](./LICENSE).
