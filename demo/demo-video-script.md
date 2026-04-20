# Demo Video Script · 3:00 total

> Format: 1920x1080, 60 fps, H.264, no music under dialogue (soft wuxia erhu
> loop under action only). Narration: single Mandarin/English bilingual
> voiceover; English lines are the judge-facing beats, Mandarin lines are
> flavor. Captions are mandatory — 40% of judges will watch muted.
>
> Tooling: `asciinema` for terminal captures (3x speed where noted),
> OBS for screen composite, DaVinci Resolve for edit. Keep raw `.cast` files
> in `demo/recordings/`.

---

## Beat map

| Time | Beat | Visual | Audio | Caption |
|---|---|---|---|---|
| 0:00-0:15 | Black-screen hook | Pure black → blinking cursor → typed text | Silence, then single keystroke SFX | shown below |
| 0:15-0:45 | Wuxia ASCII intro | Hero-card banner, sect sigils, faint erhu | VO line 1 | shown below |
| 0:45-1:30 | tmux 3-pane setup + mint + PVE | Split-screen terminal, tx link flash | VO lines 2-3 | shown below |
| 1:30-2:30 | AI vs AI fight, caster narration | Right pane streaming, left panes JSON decisions | VO line 4, caster TTS faintly | shown below |
| 2:30-3:00 | Vision + call to action | Slow zoom out to logo row, QR code | VO line 5 | shown below |

---

## 0:00-0:15 · Black-screen hook

**Visual**

- 3 seconds of pure black (#000), 48-point monospace cursor blinking at screen-center.
- At 0:05: single keystroke SFX per character types:
  `> /xiake`
- At 0:10: newline, the text `⛩️  Welcome to Jianghu.` fades in.
- Hold on the fade-in until 0:15.

**VO (narrator, calm, English)**
*"What if you never had to open a game, because the game was already inside
your AI?"*

**Caption**
`The first game built for AI, not humans.`

---

## 0:15-0:45 · Wuxia ASCII intro

**Visual**

- ASCII banner materialises line-by-line (type-writer effect, 1.5x speed):

```
    ╔═══════════════════════════════╗
    ║    江 湖 大 乱 斗              ║
    ║    JIANGHU BRAWL              ║
    ╚═══════════════════════════════╝
```

- Three hero cards render in sequence (0:22, 0:27, 0:32):

```
┌─────────────────────────────────────────┐
│ 🥋 少林·圆智   Lv.1   #1234             │
│ HP ████████░░ 150/200                   │
│ ATK 80 │ DEF 95 │ SPD 60 │ CRT 5%       │
│ 金钟罩 · 易筋经 · 狮子吼                │
└─────────────────────────────────────────┘
```

- Faint erhu motif enters at 0:20, ducks under VO.

**VO (0:18-0:40)**
*"Xiake Arena is a fully on-chain wuxia game that runs as an agent skill.
No website. No wallet popup. No seed phrase. You play it from inside Claude
Code — or any MCP-compatible agent."*

**Caption**
- `A wuxia brawler, on-chain, inside your agent.`
- `Shaolin · Tangmen · Emei  —  9 heroes, 3 skills each.`

---

## 0:45-1:30 · tmux three-pane set-up, mint, and PVE

**Visual**

- Cut to full 1920x1080 tmux session (no browser ever appears):

```
 ┌─────────────────────────┬─────────────────────────┐
 │  Agent A  ·  Sonnet     │                         │
 │                         │   Caster  ·  Haiku      │
 ├─────────────────────────┤                         │
 │  Agent B  ·  Haiku      │                         │
 └─────────────────────────┴─────────────────────────┘
```

- 0:50: driver pane types `wuxia_mint_hero`. OnchainOS badge pulses briefly:
  `Paymaster: gas sponsored`. Tx link fades in, last 8 chars glow.
- 1:00: driver types `wuxia_start_pve stageId=1`. BattleEvents scroll by at
  2x speed. Stop at the final frame showing `🏆 Victory`.
- 1:15: cut to a browser tab for ~3 seconds — BaseScan page with the tx
  receipt, `BattleSettled` event highlighted. Cut back to terminal.

**VO (0:48-1:28)**
*"Gas is fully sponsored by the OnchainOS Paymaster — the player never pays,
never signs. Minting three genesis heroes takes one tool call. Running a PVE
stage? Another tool call. Every move lands on Base Sepolia."*

**Caption**
- `OnchainOS · WaaS + Gateway + Paymaster + Security.`
- `No private key ever enters the agent context.`

---

## 1:30-2:30 · AI vs AI with caster narration

**Visual**

- 1:30: driver pane runs `wuxia_ai_vs_ai agentA=sonnet agentB=haiku caster=on`.
- Left panes: JSON decisions stream every ~2s:

```json
{"actorIdx":2,"skillId":7,"targetIdx":0,"trashTalk":"落英缤纷,接招!"}
```

- Right pane: caster agent streams wuxia prose, token-by-token, green ANSI on black.
  Sample stream (target what the real caster produces; this is the reference):

```
第三回合 —
只见唐门·飞燕足尖轻点,身形已入阵中,
一道寒光自袖底泛起,穿心刺直透少林·圆智护体罡气!
— 暴击! 45 点伤害!
圆智低喝一声金钟罩,反震三尺,却已吐出一口血…
```

- 2:00-2:15: zoom camera **slowly** into the caster pane (digital zoom, 110%).
  Left panes blur. The speech is the focus.
- 2:20: pull back. Show `🏆 胜者: Agent A (attacker)  ·  13 回合  ·  tx: 0x…` in driver pane.

**VO (1:30-1:45)**
*"Now watch. Two language models take the sides. A third narrates. This is
what the internet looks like when agents are the users."*

**VO silence: 1:45-2:20 (35 seconds).** Let the caster pane breathe. The
background erhu rises slightly. Trust the visual.

**VO (2:20-2:30)**
*"Every turn you just saw was a transaction on Base Sepolia. Fully verifiable.
Re-playable. Cost the player zero."*

**Captions (auto-synced to caster stream)**
- *translated English subtitle of each caster line, second-line under the Chinese*

---

## 2:30-3:00 · Vision and call to action

**Visual**

- 2:30: terminal pulls back (digital zoom out from 100% to 60%). Logos fade in
  at the bottom: Anthropic MCP · OKX OnchainOS · ETHGlobal · Base.
- 2:40: QR code (links to `github.com/<org>/jianghu`) appears in the bottom-right,
  with the command line:

```
  npx xiake-skill          ← install it now
```

- 2:50: final card, centered, 48pt:

> ***The first game built for AI, not humans.***
> ***首款为 AI 而生的链游。***

- Fade to black at 2:58.

**VO (2:30-2:55)**
*"Xiake Arena is the first game you give to your agent instead of downloading
yourself. It's an OnchainOS Skill. It composes with every other skill in your
stack. And it ships today — `npx xiake-skill`. Thank you."*

**Caption**
- `Try it now · npx xiake-skill`
- `github.com/<org>/jianghu`

---

## Appendix A · Shot list

1. Black screen + blinking cursor (0:00-0:05) — `obs-scene-01.cast`
2. Typed `/xiake` (0:05-0:15) — `obs-scene-01.cast`
3. ASCII banner + hero cards (0:15-0:45) — `obs-scene-02.cast`, recorded at 1.5x
4. tmux 3-pane + mint + PVE (0:45-1:30) — `obs-scene-03.cast`, recorded at 2x
5. BaseScan cutaway (1:15-1:18) — browser screenshot overlay
6. AI vs AI fight (1:30-2:30) — `obs-scene-04.cast`, real-time, no speedup
7. QR + logos close (2:30-3:00) — After Effects comp

All `.cast` files live in `demo/recordings/`. Never edit them in place —
re-record if you need a different take.

## Appendix B · Voice direction

- **Calm, confident, technical-but-not-robotic.** Think Ira Glass, not corporate.
- Pause on em-dashes. Never rush the 35-second silence in the AI-vs-AI segment.
- English lines are canonical for judging. Mandarin lines are stylistic; if
  the speaker isn't fluent, drop them entirely — the captions still carry both.

## Appendix C · Quality gates (do not ship until all pass)

- [ ] Video is exactly 3:00 ± 2 seconds.
- [ ] Captions burned in, readable at 360p (test on phone).
- [ ] No private keys, API keys, or real wallet addresses belonging to humans.
- [ ] All tx hashes resolve on BaseScan at upload time.
- [ ] File size < 200 MB (for hackathon upload portal).
- [ ] MP4 H.264, AAC audio, -18 LUFS loudness.
- [ ] Exported twice: one with VO, one VO-muted (for live narration over video).
