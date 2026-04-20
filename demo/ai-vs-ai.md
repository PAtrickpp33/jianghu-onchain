# Demo Day Runbook · AI vs AI

> Audience: live demo-day stage, 3-minute slot, one operator, one laptop.
> Goal: every judge understands "what it is" within 15 seconds, and leaves
> remembering "two AIs played a wuxia chain game by themselves."

---

## 0. Pre-flight (T-60 min)

Run through this checklist **in order**. If anything fails twice, fall back to
the pre-recorded video (see §5).

| # | Check | Pass criteria |
|---|---|---|
| 1 | `bash scripts/setup.sh --skip-deploy` | exits 0, skill built |
| 2 | `node skill/dist/index.js --self-check` | prints `OK` |
| 3 | `cast call $ARENA_ADDRESS "listArena(uint256,uint256)(address[],uint256[])" 0 5 --rpc-url $BASE_SEPOLIA_RPC` | returns ≥ 3 defenders |
| 4 | `curl -s https://sepolia.base.org` reachable | 200 |
| 5 | OnchainOS key quota check (`curl -H ... /api/v5/system/time`) | 200, no 429 |
| 6 | Laptop: battery > 80%, Wi-Fi + tether both joined | dual network |
| 7 | `asciinema rec demo/recordings/backup-$(date +%s).cast` rehearsal | saved |
| 8 | Terminal: font size ≥ 18pt, high-contrast theme, `NO_COLOR=0` | readable from row 5 |

Keep these two files pre-opened on a second desktop:
- `demo/recordings/backup-final.cast` (full asciinema recording)
- `demo/recordings/backup-final.mp4` (mp4 with captions, for projector-only rooms)

---

## 1. Stage layout (tmux)

```
 ┌─────────────────────────┬─────────────────────────┐
 │                         │                         │
 │  Agent A  (Dongxie)     │                         │
 │  Claude Sonnet 4.5      │                         │
 │  attacker, aggressive   │  Caster-agent           │
 │                         │  Claude Haiku 4.5       │
 ├─────────────────────────┤  wuxia narration        │
 │                         │  streaming output       │
 │  Agent B  (Xidu)        │                         │
 │  Claude Haiku 4.5       │                         │
 │  defender, counter-pick │                         │
 │                         │                         │
 └─────────────────────────┴─────────────────────────┘
```

Launched by `bash scripts/demo-ai-vs-ai.sh`.

The **right pane is the hero** — it shows the wuxia commentary that turns
`BattleEvent{skillId=7, dmg=45, crit=true}` into
*"只见飞燕一道寒光,穿心刺直透护体罡气!暴击!"*
Judges watch this pane. The left panes are proof-of-work (real LLMs thinking).

---

## 2. Narrative beats (3 min, memorize these)

You, the operator, are a **guide**, not a programmer. Avoid jargon until beat 4.

| Time | Beat | What to say | What's on screen |
|---|---|---|---|
| 0:00-0:15 | **Hook** | "Web3 games die because humans hate them. But AIs don't. Watch." | Black terminal, just the cursor |
| 0:15-0:30 | **One-liner** | Type `/xiake`. "This is a fully on-chain wuxia game. No website. No wallet popup. It lives inside Claude Code." | ASCII banner, hero cards appear |
| 0:30-1:00 | **Setup** | "The League sponsors gas via OnchainOS Paymaster — players never sign a tx." Fire `wuxia_mint_hero`. | Three hero cards render, tx link appears |
| 1:00-2:30 | **AI vs AI** | "Now I leave. These two agents will play each other. A third agent will narrate. This is what the internet looks like when AIs are the users." Hit enter on driver pane. | Left panes: JSON decisions stream. Right pane: wuxia narration streams. Audience's eyes go right. |
| 2:30-2:50 | **Proof** | "Every turn you just watched is on Base Sepolia — here's the tx." Paste tx hash into BaseScan tab on second monitor. | BaseScan page with `BattleSettled` event |
| 2:50-3:00 | **Close** | "The first game built for AI, not humans. Ship it to every agent, composed with every skill. Thank you." | Return to terminal, show `demo/pitch-deck.md` QR code for contact |

**Don't** read JSON aloud. **Do** point at the caster pane and let it breathe
for 10 seconds mid-battle — silence sells it.

---

## 3. Exact commands (cheat-sheet — tape to keyboard)

```bash
# T-0: already in project root, .env loaded
bash scripts/demo-ai-vs-ai.sh

# Inside tmux — only needed if the pre-wired driver hangs:
node skill/dist/index.js --role=driver --arena=$ARENA_ADDRESS

# If you need to reset a hero's defense team mid-demo:
cast send $ARENA_ADDRESS "setDefenseTeam(uint256[3])" '[1,2,3]' \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $DEPLOYER_PK

# Quick health ping (BEFORE going on stage):
curl -s -o /dev/null -w "%{http_code}\n" https://sepolia.base.org
node skill/dist/index.js --self-check
```

---

## 4. Contingency playbook

Every failure mode we've actually seen, with a 20-second recovery path.

### 4.1 RPC is down / slow (`> 5s` per call)

**Symptom:** tx submission hangs, `getBattleReport` view call times out.

**Recovery:**
1. Press `Ctrl-b :` in tmux → `send-keys -t 0 C-c Enter`.
2. Swap RPC: `export BASE_SEPOLIA_RPC=https://base-sepolia-rpc.publicnode.com`.
3. Re-run `bash scripts/demo-ai-vs-ai.sh`.
4. If still slow → escalate to §5 (pre-recorded).

**Prevention:** we keep three RPC URLs pre-exported in `.env.backup`:
`sepolia.base.org`, `base-sepolia-rpc.publicnode.com`, `base-sepolia.g.alchemy.com/v2/...`.
Cycle them with `source .env.backup.<n>`.

### 4.2 OnchainOS 429 / rate-limit

**Symptom:** `wuxia_mint_hero` or `wuxia_challenge` returns
`{ "error": "rate_limit_exceeded" }`.

**Recovery:**
1. Switch to the backup project id: `export OKX_PROJECT_ID=${OKX_PROJECT_ID_BACKUP}` (we have two).
2. `wuxia_replay <battleId>` on a battle we ran during pre-flight — same visual payoff, no new writes.
3. Narrate over it: "rate-limited by popularity, here's the one we ran earlier…" (plausible, even true).

### 4.3 LLM slow / streaming stalls

**Symptom:** caster pane silent for > 10 s, or agent decision > 15 s.

**Recovery:**
1. **Keep talking.** Don't acknowledge the stall. Buy 15 seconds with:
   *"While it thinks — notice the hero cards here are ERC-721, and the skill table is a Solidity library…"*
2. If still stalled: press `Ctrl-c` in the caster pane, re-run
   `node skill/dist/index.js --role=caster --model=claude-haiku-4-5 --replay-from=$LAST_EVENT_ID`.
3. If Anthropic API itself is down: swap caster to `claude-sonnet-4-5` (still cached keys work) or fall back to static template narration (`--caster=template`), which the skill supports as a last-resort mode.

### 4.4 Claude Code can't find the skill

**Symptom:** `/xiake` yields "unknown command".

**Recovery:**
1. `ls skill/dist/index.js` — if missing, `cd skill && npm run build`.
2. Validate `mcp.json` path is absolute (not `~/...`) and points at compiled JS, not TS.
3. Restart Claude Code (`claude --quit` then `claude`).
4. Worst case: skip `/xiake` and call tools directly via the driver script — same effect, less magic.

### 4.5 Private key panic

**Symptom:** someone in the audience says "did you paste your private key?"

**Answer (rehearse this):** "No — signing is delegated to OnchainOS's MPC
wallet. The agent context never sees a key. Prompt-injection can't exfiltrate
what isn't there. That's the whole point of building on WaaS."

### 4.6 Full meltdown

All else fails → §5.

---

## 5. Pre-recorded fallback

One command:

```bash
bash scripts/demo-ai-vs-ai.sh --recorded
```

This plays `demo/recordings/backup-final.cast` with `asciinema play`. Looks
identical to the live version at normal speaking cadence. Keep `backup-final.mp4`
on the desktop too — if the projector strips ANSI, mp4 is pixel-safe.

Narration pacing for the recording is tuned to **3:02**. Practice once so your
timing matches the visual beats.

---

## 6. Post-demo (T+5 min)

- Screenshot the BaseScan tx list, post to the project Telegram and the
  hackathon Discord.
- Save `demo/recordings/session-<date>.cast` as the official submission artifact.
- If judges ask follow-ups beyond the 3-minute slot: hand them the
  `demo/pitch-deck.md` outline and invite them to the dev hall booth.

---

## 7. Known-safe demo state (use if unsure)

- Deployed `HeroNFT` on Base Sepolia with token ids `1..12` pre-minted to
  `$DEMO_WALLET_A` and `$DEMO_WALLET_B`.
- `$DEMO_WALLET_A.defenseTeam = [1, 2, 3]`, `$DEMO_WALLET_B.defenseTeam = [4, 5, 6]`.
- One successful `challengeRelay` has already landed as `$PROOF_BATTLE_ID` —
  always replayable via `wuxia_replay`.
- `.env.backup.*` each hold a clean, independent OnchainOS project id +
  distinct RPC URL. Cycle them freely.

When in doubt: `wuxia_replay $PROOF_BATTLE_ID`. It always works.
