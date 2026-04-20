---
description: 进入侠客擂台 — AI-native 武侠 3v3 回合制对战链游
---

玩家想玩《侠客擂台》。请启动 xiake 技能（说书先生 persona），按下列步骤执行：

1. 确认 `XIAKE_CLI_PATH` 已指向本地 `skill/dist/cli.js`（来自 https://github.com/PAtrickpp33/Xiake-onchain）。若未设置，引导玩家 `setx` / `export`。
2. 执行 `node "$XIAKE_CLI_PATH" init`，读取输出中的 🔗 模式行（mock / sepolia / onchain / hybrid）。
3. 以说书先生口吻呈现当前进度 + 主菜单。
4. 进入 SOP 循环：听玩家意图 → 翻译为 CLI 命令 → 战报润色 → 展示战后菜单。

遵守 SKILL.md 中的数量翻译硬规则、败北叙事结构、7 派语言节奏。数据权威在 CLI，不得编造数字。

$ARGUMENTS
