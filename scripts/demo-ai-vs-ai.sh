#!/usr/bin/env bash
# ============================================================================
# Xiake Arena · AI vs AI demo launcher
# ----------------------------------------------------------------------------
# Opens a tmux session named "xiake-demo" with three panes:
#
#   ┌──────────────────┬──────────────────┐
#   │ (1) Agent A      │ (3) Caster       │
#   │ Claude Sonnet    │ Live narration   │
#   ├──────────────────┤  (Claude Haiku)  │
#   │ (2) Agent B      │                  │
#   │ Claude Haiku     │                  │
#   └──────────────────┴──────────────────┘
#
# Designed for demo day: one command, everything is on screen, cameras love it.
# Falls back to a single-pane log-tail mode if tmux is not available.
#
# Usage:
#   bash scripts/demo-ai-vs-ai.sh                # full tmux demo
#   bash scripts/demo-ai-vs-ai.sh --dry-run      # sanity check, no spend
#   bash scripts/demo-ai-vs-ai.sh --recorded     # replay last cached battle
# ============================================================================

set -Eeuo pipefail

# ── Style ────────────────────────────────────────────────────────────────────
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"
C_CYAN="\033[1;36m"
log()  { printf "${C_CYAN}[demo]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
die()  { printf "${C_RED}[fail]${C_RESET} %s\n" "$*" >&2; exit 1; }

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILL_DIR="${ROOT_DIR}/skill"
LOG_DIR="${ROOT_DIR}/demo/recordings"
mkdir -p "${LOG_DIR}"

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=0
RECORDED=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run)  DRY_RUN=1 ;;
    --recorded) RECORDED=1 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//' ; exit 0 ;;
    *) die "unknown flag: ${arg}" ;;
  esac
done

# ── Env ──────────────────────────────────────────────────────────────────────
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a; source "${ROOT_DIR}/.env"; set +a
else
  die "no .env — run scripts/setup.sh first"
fi

require() { [[ -n "${!1:-}" ]] || die "missing env var: $1"; }
require ANTHROPIC_API_KEY
require HERO_NFT_ADDRESS
require ARENA_ADDRESS

# ── Skill bundle check ───────────────────────────────────────────────────────
SKILL_ENTRY="${SKILL_DIR}/dist/index.js"
if [[ ! -f "${SKILL_ENTRY}" ]]; then
  die "skill not built. Run: bash scripts/setup.sh"
fi

# ── Banner ───────────────────────────────────────────────────────────────────
printf "\n${C_BOLD}"
cat <<'ASCII'
  ╔═══════════════════════════════════════════════════════════╗
  ║   AI  vs  AI   ·   江 湖 论 剑                             ║
  ║   live narrated by caster-agent                            ║
  ╚═══════════════════════════════════════════════════════════╝
ASCII
printf "${C_RESET}\n"

# ── Pick players ─────────────────────────────────────────────────────────────
AGENT_A="${AGENT_A_MODEL:-claude-sonnet-4-5}"
AGENT_B="${AGENT_B_MODEL:-claude-haiku-4-5}"
CASTER="${CASTER_MODEL:-claude-haiku-4-5}"

log "Agent A : ${AGENT_A}  (attacker)"
log "Agent B : ${AGENT_B}  (defender)"
log "Caster  : ${CASTER}"
log "Arena   : ${ARENA_ADDRESS}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  log "dry-run: validating skill and exiting."
  node "${SKILL_ENTRY}" --self-check
  exit 0
fi

# ── Recorded fallback ────────────────────────────────────────────────────────
if [[ "${RECORDED}" -eq 1 ]]; then
  LAST="$(ls -t "${LOG_DIR}"/*.cast 2>/dev/null | head -n1 || true)"
  [[ -z "${LAST}" ]] && die "no recording found in ${LOG_DIR}"
  log "replaying ${LAST}"
  command -v asciinema >/dev/null || die "asciinema not installed"
  exec asciinema play "${LAST}"
fi

# ── tmux layout ──────────────────────────────────────────────────────────────
SESSION="xiake-demo"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_A="${LOG_DIR}/agent-a-${TS}.log"
LOG_B="${LOG_DIR}/agent-b-${TS}.log"
LOG_C="${LOG_DIR}/caster-${TS}.log"

if command -v tmux >/dev/null 2>&1; then
  log "launching tmux session '${SESSION}'..."
  tmux kill-session -t "${SESSION}" 2>/dev/null || true

  # Left column = Agent A (top) + Agent B (bottom). Right column = Caster.
  tmux new-session  -d -s "${SESSION}" -n fight \
       "node ${SKILL_ENTRY} --role=agent --side=A --model=${AGENT_A} 2>&1 | tee ${LOG_A}"

  tmux split-window -h -t "${SESSION}":fight \
       "node ${SKILL_ENTRY} --role=caster --model=${CASTER} 2>&1 | tee ${LOG_C}"

  tmux select-pane  -t "${SESSION}":fight.0
  tmux split-window -v -t "${SESSION}":fight \
       "node ${SKILL_ENTRY} --role=agent --side=B --model=${AGENT_B} 2>&1 | tee ${LOG_B}"

  # Pretty titles.
  tmux select-pane -t "${SESSION}":fight.0 -T "Agent A · ${AGENT_A}"
  tmux select-pane -t "${SESSION}":fight.1 -T "Agent B · ${AGENT_B}"
  tmux select-pane -t "${SESSION}":fight.2 -T "Caster · ${CASTER}"
  tmux set -g pane-border-status top

  # Start the match from the driver pane (window 2).
  tmux new-window -t "${SESSION}" -n driver \
       "node ${SKILL_ENTRY} --role=driver --arena=${ARENA_ADDRESS}; echo; echo 'match ended — press any key'; read -n1"

  tmux select-window -t "${SESSION}":fight
  log "tmux session up. Attaching... (detach with Ctrl-b d)"
  exec tmux attach -t "${SESSION}"
else
  warn "tmux not installed — falling back to single-pane mode"
  log "logs will be tailed to: ${LOG_DIR}"
  node "${SKILL_ENTRY}" --role=driver --arena="${ARENA_ADDRESS}" 2>&1 | tee "${LOG_C}"
fi
