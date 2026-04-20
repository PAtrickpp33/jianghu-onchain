# Xiake Contracts

On-chain 3v3 wuxia battle contracts for the `xiake-skill` MCP game (侠客擂台).
Target chain: **Base Sepolia** (chainId 84532). Solidity **0.8.24** / **cancun** / optimizer 200.

## Layout

```
src/
  Types.sol          # shared enums + structs (Hero, Skill, BattleEvent, BattleReport)
  SkillRegistry.sol  # 9 hardcoded skills (3 sects × 3), both as contract + pure library
  BattleEngine.sol   # pure memory-only 3v3 simulator, 30-round cap
  HeroNFT.sol        # ERC-721, mintGenesis(to) → 3 heroes per address
  Arena.sol          # PVE/PVP entry, EIP-712 relay, on-chain reports
test/
  BattleEngine.t.sol # damage / heal / crit / control unit tests
  Arena.t.sol        # mint → setDefense → challenge → read integration tests
script/
  Deploy.s.sol       # deploys SkillRegistry + HeroNFT + Arena
foundry.toml
.env.example
```

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`foundryup`)
- Base Sepolia ETH on the deployer account

## Install dependencies

```bash
cd contracts

# OpenZeppelin (v5.x works fine; we use Ownable(initialOwner) constructor)
forge install openzeppelin/openzeppelin-contracts --no-commit

# forge-std (for tests + scripts)
forge install foundry-rs/forge-std --no-commit
```

## Run the tests

```bash
forge test -vv
```

Expected: all tests green. Coverage focuses on core paths (direct damage, heal, crit, control, EIP-712 relay, PVE flow).

## Deploy to Base Sepolia

1. Fund a deployer key with Base Sepolia ETH (faucets):
   - https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
   - https://docs.base.org/docs/tools/network-faucets
   - https://faucet.quicknode.com/base/sepolia
2. Copy `.env.example` → `.env`, fill in `BASE_SEPOLIA_RPC`, `DEPLOYER_PK`, `BASESCAN_KEY`:
   ```bash
   cp .env.example .env
   # edit .env
   source .env
   ```
3. Deploy + verify in one shot:
   ```bash
   forge script script/Deploy.s.sol:Deploy \
     --rpc-url $BASE_SEPOLIA_RPC \
     --private-key $DEPLOYER_PK \
     --broadcast --verify -vvv
   ```
4. Note the three deployed addresses printed at the end (`SkillRegistry`, `HeroNFT`, `Arena`) and paste them into `skill/src/chain/contracts.ts`.

### Local / anvil

```bash
anvil --hardfork cancun
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

## Post-deploy smoke test

```bash
# 1. Mint genesis heroes
cast send $HERO_NFT "mintGenesis(address)" $PLAYER \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PLAYER_PK

# 2. Set defense team
cast send $ARENA "setDefenseTeam(uint256[3])" "[1,2,3]" \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PLAYER_PK

# 3. Launch PVE stage 1
cast send $ARENA "startPve(uint256[3],uint8)" "[1,2,3]" 1 \
  --rpc-url $BASE_SEPOLIA_RPC --private-key $PLAYER_PK

# 4. Read a battle report (grab battleId from BattleSettled event)
cast call $ARENA "getBattleReport(bytes32)" $BATTLE_ID \
  --rpc-url $BASE_SEPOLIA_RPC
```

## Design notes

- **`BattleEngine.simulate` is `pure` + memory-only.** The skill package can run the exact same
  simulation locally to preview/predict battles without sending a tx; results always match.
- **30-round cap + stable SPD tie-break (by tokenId).** Guarantees termination and deterministic replay.
- **Battle reports are dual-sinked**: full `BattleReport` struct written to storage (indexed by `battleId`),
  plus a summary `BattleSettled` event for light indexers / the skill UI.
- **EIP-712 relay via `challengeRelay`** so OnchainOS paymaster can submit the tx while the player signs offline.
  Per-player nonce prevents replay; direct `challenge` does not consume nonce.
- **PVE stages** are hardcoded in `Arena._bossTeam`. Only `stageId == 1` is shipped for the MVP.

## Known simplifications

- Hero stats use a single `keccak256` roll at mint, not Pyth Entropy / VRF.
- No marketplace, no burning, no fusion — heroes are soulbound-ish in practice (ERC-721 still transferable).
- Attacker PVP lineup === their stored defense team (no per-challenge override).
- `listArena` is unsorted (O(n) pagination, no indexing by power).
