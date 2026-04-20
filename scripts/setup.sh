#!/usr/bin/env bash
# ============================================================================
# Xiake Arena · One-shot setup
# ----------------------------------------------------------------------------
# What this does, in order:
#   1. Verify toolchain (foundry, node, npm, jq).
#   2. Load .env (from repo root).
#   3. cd contracts → forge install → forge build → forge test → forge deploy.
#   4. Parse deployed addresses and write them to skill/.env + repo .env.
#   5. cd skill → npm install → npm run build.
#   6. Print a ready-to-paste mcp.json snippet for Claude Code.
#
# Usage:   bash scripts/setup.sh
#          bash scripts/setup.sh --skip-deploy     # build + test only
#          bash scripts/setup.sh --skip-tests      # faster re-runs
# ============================================================================

set -Eeuo pipefail

# ── Style ────────────────────────────────────────────────────────────────────
C_RESET="\033[0m"
C_BOLD="\033[1m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"
C_CYAN="\033[1;36m"
C_DIM="\033[2m"

log()  { printf "${C_CYAN}[setup]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}[ ok ]${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}[warn]${C_RESET} %s\n" "$*"; }
die()  { printf "${C_RED}[fail]${C_RESET} %s\n" "$*" >&2; exit 1; }

banner() {
  printf "\n${C_BOLD}"
  cat <<'ASCII'
  ╔══════════════════════════════════════════════════════════╗
  ║   江 湖 大 乱 斗  ·  JIANGHU BRAWL                        ║
  ║   one-shot setup                                          ║
  ╚══════════════════════════════════════════════════════════╝
ASCII
  printf "${C_RESET}\n"
}

# ── Path resolution ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/contracts"
SKILL_DIR="${ROOT_DIR}/skill"

# ── Parse flags ──────────────────────────────────────────────────────────────
SKIP_DEPLOY=0
SKIP_TESTS=0
for arg in "$@"; do
  case "${arg}" in
    --skip-deploy) SKIP_DEPLOY=1 ;;
    --skip-tests)  SKIP_TESTS=1 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//' ; exit 0 ;;
    *) die "unknown flag: ${arg}" ;;
  esac
done

banner

# ── 1. Toolchain check ───────────────────────────────────────────────────────
log "checking toolchain..."
check_bin() {
  local bin="$1" hint="$2"
  if ! command -v "${bin}" >/dev/null 2>&1; then
    die "missing '${bin}'. ${hint}"
  fi
  ok "$(printf '%-8s %s' "${bin}" "$(${bin} --version 2>&1 | head -n1)")"
}

check_bin node   "install Node ≥ 20 from https://nodejs.org"
check_bin npm    "bundled with Node"
check_bin forge  "run: curl -L https://foundry.paradigm.xyz | bash && foundryup"
check_bin cast   "bundled with foundry"
check_bin jq     "sudo apt install jq  (needed to parse deploy receipts)"

# Node major version guard.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  die "Node ${NODE_MAJOR} is too old. Need ≥ 20."
fi

# ── 2. Env ───────────────────────────────────────────────────────────────────
log "loading environment..."
if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  if [[ -f "${ROOT_DIR}/.env.example" ]]; then
    warn "no .env found. Copy .env.example → .env and fill it in, then re-run."
    die  ".env missing"
  fi
  die ".env and .env.example both missing — broken checkout?"
fi

# shellcheck disable=SC1091
set -a
source "${ROOT_DIR}/.env"
set +a

require_var() {
  local v="$1"
  if [[ -z "${!v:-}" ]]; then die "env var ${v} is empty — fill .env"; fi
}

if [[ "${SKIP_DEPLOY}" -eq 0 ]]; then
  require_var BASE_SEPOLIA_RPC
  require_var DEPLOYER_PK
fi
require_var ANTHROPIC_API_KEY
require_var OKX_API_KEY
require_var OKX_SECRET_KEY
require_var OKX_PASSPHRASE
require_var OKX_PROJECT_ID
ok "env loaded"

# ── 3. Contracts ─────────────────────────────────────────────────────────────
log "building contracts..."
pushd "${CONTRACTS_DIR}" >/dev/null

if [[ ! -d lib/forge-std ]]; then
  log "installing forge dependencies (first run only)..."
  forge install --no-commit foundry-rs/forge-std
  forge install --no-commit OpenZeppelin/openzeppelin-contracts
fi

forge build
ok "forge build succeeded"

if [[ "${SKIP_TESTS}" -eq 0 ]]; then
  log "running forge tests..."
  forge test -vv
  ok "all tests passed"
else
  warn "tests skipped (--skip-tests)"
fi

if [[ "${SKIP_DEPLOY}" -eq 0 ]]; then
  log "deploying to Base Sepolia..."
  DEPLOY_LOG="${ROOT_DIR}/.deploy-$(date +%s).log"

  VERIFY_FLAG=()
  if [[ -n "${BASESCAN_API_KEY:-}" ]]; then
    VERIFY_FLAG=(--verify --etherscan-api-key "${BASESCAN_API_KEY}")
  else
    warn "BASESCAN_API_KEY not set — skipping verification"
  fi

  forge script script/Deploy.s.sol:Deploy \
    --rpc-url "${BASE_SEPOLIA_RPC}" \
    --private-key "${DEPLOYER_PK}" \
    --broadcast \
    "${VERIFY_FLAG[@]}" \
    --json 2>&1 | tee "${DEPLOY_LOG}"

  # Parse addresses from the Foundry broadcast receipt.
  BROADCAST_JSON="broadcast/Deploy.s.sol/${CHAIN_ID:-84532}/run-latest.json"
  if [[ ! -f "${BROADCAST_JSON}" ]]; then
    die "cannot find broadcast artifact: ${BROADCAST_JSON}"
  fi

  extract_addr() {
    local name="$1"
    jq -r --arg n "${name}" \
      '.transactions[] | select(.contractName == $n) | .contractAddress' \
      "${BROADCAST_JSON}" | head -n1
  }

  HERO_NFT_ADDRESS="$(extract_addr HeroNFT)"
  ARENA_ADDRESS="$(extract_addr Arena)"
  BATTLE_ENGINE_ADDRESS="$(extract_addr BattleEngine)"
  SKILL_REGISTRY_ADDRESS="$(extract_addr SkillRegistry)"

  [[ -n "${HERO_NFT_ADDRESS}" ]]      || die "failed to parse HeroNFT address"
  [[ -n "${ARENA_ADDRESS}" ]]         || die "failed to parse Arena address"

  ok "HeroNFT        ${HERO_NFT_ADDRESS}"
  ok "Arena          ${ARENA_ADDRESS}"
  ok "BattleEngine   ${BATTLE_ENGINE_ADDRESS:-<library>}"
  ok "SkillRegistry  ${SKILL_REGISTRY_ADDRESS:-<n/a>}"
else
  warn "deploy skipped (--skip-deploy) — keeping existing addresses in .env"
fi

popd >/dev/null

# ── 4. Persist addresses ─────────────────────────────────────────────────────
if [[ "${SKIP_DEPLOY}" -eq 0 ]]; then
  log "writing deployed addresses into .env files..."
  update_env() {
    local file="$1" key="$2" value="$3"
    [[ -z "${value}" ]] && return 0
    if [[ -f "${file}" ]] && grep -q "^${key}=" "${file}"; then
      # macOS/BSD sed compatibility: use a temp file.
      sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "${file}" && rm -f "${file}.bak"
    else
      printf "%s=%s\n" "${key}" "${value}" >> "${file}"
    fi
  }

  for f in "${ROOT_DIR}/.env" "${SKILL_DIR}/.env"; do
    [[ -d "$(dirname "${f}")" ]] || continue
    touch "${f}"
    update_env "${f}" HERO_NFT_ADDRESS       "${HERO_NFT_ADDRESS}"
    update_env "${f}" ARENA_ADDRESS          "${ARENA_ADDRESS}"
    update_env "${f}" BATTLE_ENGINE_ADDRESS  "${BATTLE_ENGINE_ADDRESS}"
    update_env "${f}" SKILL_REGISTRY_ADDRESS "${SKILL_REGISTRY_ADDRESS}"
  done
  ok "addresses written to ${ROOT_DIR}/.env and ${SKILL_DIR}/.env"
fi

# ── 5. Skill build ───────────────────────────────────────────────────────────
log "building skill (xiake-skill)..."
pushd "${SKILL_DIR}" >/dev/null
npm install --no-audit --no-fund
npm run build
ok "skill built at ${SKILL_DIR}/dist"
popd >/dev/null

# ── 6. Print mcp.json snippet ────────────────────────────────────────────────
printf "\n${C_BOLD}${C_GREEN}━━━ SETUP COMPLETE ━━━${C_RESET}\n\n"
printf "${C_BOLD}Next step:${C_RESET} paste the following into\n"
printf "  ${C_DIM}~/.config/claude-code/mcp.json${C_RESET}  (Linux/macOS)\n"
printf "  ${C_DIM}%%APPDATA%%\\claude-code\\mcp.json${C_RESET} (Windows)\n\n"

cat <<JSON
{
  "mcpServers": {
    "xiake": {
      "command": "node",
      "args": ["${SKILL_DIR}/dist/index.js"],
      "env": {
        "OKX_API_KEY": "${OKX_API_KEY}",
        "OKX_SECRET_KEY": "${OKX_SECRET_KEY}",
        "OKX_PASSPHRASE": "${OKX_PASSPHRASE}",
        "OKX_PROJECT_ID": "${OKX_PROJECT_ID}",
        "OKX_PAYMASTER_POLICY_ID": "${OKX_PAYMASTER_POLICY_ID:-}",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}",
        "BASE_SEPOLIA_RPC": "${BASE_SEPOLIA_RPC}",
        "HERO_NFT_ADDRESS": "${HERO_NFT_ADDRESS:-}",
        "ARENA_ADDRESS": "${ARENA_ADDRESS:-}"
      }
    }
  }
}
JSON

printf "\n${C_DIM}Then restart Claude Code and run: /xiake${C_RESET}\n\n"
