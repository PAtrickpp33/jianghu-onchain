# Pitch Deck · Xiake Arena

> 10-slide Markdown outline. Convert to Keynote / Figma / tldraw for the stage.
> Optimized for a mixed panel: Anthropic (MCP track), OKX (OnchainOS sponsor),
> ETHGlobal (AI Agent innovation). 3 minutes + 1 minute Q&A.

---

## Core hook

**Web3 games lost the human. AI agents are the new players.**
We shipped the first chain game that lives **inside** the agent — no browser,
no wallet popup, no install. Two AIs can play each other while you sleep, and
every move settles on-chain. *The first game built for AI, not humans.*

Every slide should ladder back to that hook.

---

## Slide 1 · Cover

**Xiake Arena · 侠客擂台**

*The first game built for AI, not humans.*
*首款为 AI 而生的链游。*

- Presenter name / handle
- Logos: Anthropic MCP · OKX OnchainOS · ETHGlobal
- One visual: terminal on a black background with `/xiake` typed, cursor blinking

---

## Slide 2 · The problem

**Why chain games keep dying.**

- Onboarding is a funnel of death: seed phrase → bridge → gas → sign → fail
- Game UIs compete with AAA titles they cannot beat on polish
- On-chain means slow — bad fit for reflex gameplay
- Result: 99 % of chain games have < 100 DAU by month 3

> *Pie chart or bar chart: "active wallets 30 days after launch" across
> 10 recent web3 games. Most < 50.*

---

## Slide 3 · The insight

**Agents are the new user.**

- Claude Code / Cursor / Codex / OpenCode all speak MCP
- AI agents already: read docs, write code, make API calls — and now hold wallets
- Agents don't hate seed phrases. They don't care about visual polish. They *love* CLIs.
- So: **stop building apps for humans. Build skills for agents.**

> Side-by-side: "human player funnel (7 steps)" vs "agent player funnel (1 tool call)"

---

## Slide 4 · The solution

**A game that *is* an agent skill.**

- Published as an OnchainOS Skill, installed via `npx xiake-skill` in `mcp.json`
- 9 MCP tools: init, mint, list, start_pve, set_defense, list_arena, challenge, ai_vs_ai, replay
- All state on Base Sepolia; battles are deterministic Solidity
- Composable with other skills in the same session (wallet, DEX, lending)

> Diagram: player → agent → xiake-skill → (OnchainOS + Base Sepolia).
> Identical to the ASCII architecture in README.

---

## Slide 5 · Demo (screenshot / GIF placeholder)

**What judges will see on Slide 8 live.**

- GIF 1: `/xiake` → hero cards render → PVE win → BaseScan tx link
- GIF 2: `wuxia_ai_vs_ai` → split panes, streaming commentary on the right
- Caption: "recorded end-to-end, no editing, all transactions on Base Sepolia"

> Placeholder files: `demo/recordings/hook.gif`, `demo/recordings/ai-vs-ai.gif`

---

## Slide 6 · Technical architecture

**One diagram, three layers.**

```
Agent (Claude Code / MCP)
        │
        ▼
xiake-skill  (TypeScript, 9 tools, caster LLM)
        │
        ▼
OnchainOS  (WaaS · Gateway · Paymaster · Security)
        │
        ▼
Base Sepolia  (HeroNFT + Arena + BattleEngine library)
```

- ~1,500 LOC Solidity, `>90%` coverage on `BattleEngine`
- `pure` battle library — zero SSTORE, deterministic, re-simulatable off-chain
- EIP-712 challenges with per-player nonce
- Full details: `docs/TECHNICAL_DESIGN.md`

---

## Slide 7 · OnchainOS integration (sponsor slide)

**Five OnchainOS surfaces in one session — not one API call.**

| Surface | Used for | Why it matters |
|---|---|---|
| Wallet-as-a-Service | Provision players with zero seed phrases | Makes agents first-class users |
| Wallet Balance API | Status card in `wuxia_init` | Closes the loop visually |
| Onchain Gateway | Every game-state write | Proves the sign-and-send path |
| Paymaster | 100 % sponsored gas for Hero + Arena methods | Players never pay, ever |
| Security Scan | Pre-flight every tx | Hardens against prompt injection |

*This is the first OnchainOS Skill in the game category. We'll upstream a PR to `okx/onchainos-skills` the week after demo day.*

---

## Slide 8 · AI vs AI — live segment

**Two LLMs play each other while a third narrates.**

- Agent A (Sonnet, "Dongxie" aggressive) vs Agent B (Haiku, "Xidu" counter-pick)
- Structured output each turn: `{ actorIdx, skillId, targetIdx, trashTalk }`
- Caster agent streams wuxia narration into a third pane
- **Play the 60-second live clip here.** Silence for 10s mid-fight.

> If network is bad: `bash scripts/demo-ai-vs-ai.sh --recorded`.

This is the emotional climax of the pitch. Memorize the first and last line of
your narration (see `demo/demo-video-script.md`).

---

## Slide 9 · Roadmap (post-hackathon)

**Month 1 — Polish**
- 6 sects (Wudang, Gaibang, Mingjiao, Huashan added)
- Seasonal ladder + shareable replay URLs
- PR into `okx/onchainos-skills`

**Month 2 — Composability**
- Cross-skill combos: DEX skill sells hero loot, lending skill collateralizes rare heroes
- Pyth Entropy for provably fair randomness

**Month 3 — Mainnet**
- Base mainnet launch
- Open plug-in API: community-submitted sects ship as standalone skills

> Milestones map: Week 2 (today) → Month 1 → Month 3. Three visual waypoints.

---

## Slide 10 · Team + contact

**Team**
- *Name / role / X handle / prior work*
- *Name / role / X handle / prior work*

**Contact**
- GitHub: `github.com/<org>/jianghu`
- X: `@<handle>`
- Telegram: `t.me/<handle>`
- Email: `<handle>@<domain>`

**Try it now**
```
npx xiake-skill     # then add to your mcp.json
```

**Closing line (say out loud):**
> *"Web3 games spent ten years trying to get humans to care.
> Agents already do. Xiake Arena is the start of that stack. Thank you."*

---

## Speaker notes · pacing

| Slide | Target time | Trap to avoid |
|---|---|---|
| 1 Cover | 0:00-0:10 | Don't list credentials — let the logo row do it |
| 2 Problem | 0:10-0:30 | No charts older than 2024 |
| 3 Insight | 0:30-0:50 | Don't say "paradigm shift" |
| 4 Solution | 0:50-1:10 | Skip package names; say "it's a skill in your agent" |
| 5 Demo still | 1:10-1:20 | If the real demo runs long, drop this slide |
| 6 Arch | 1:20-1:40 | Don't read the stack; point at two arrows |
| 7 OnchainOS | 1:40-2:00 | **Dwell here** — sponsor eyes are on this slide |
| 8 AI vs AI | 2:00-2:40 | Let the caster pane breathe. Silence sells. |
| 9 Roadmap | 2:40-2:55 | One month at a time, no vapor |
| 10 Close | 2:55-3:00 | End on the one-liner, not on thanks |
