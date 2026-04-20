# Deploy Playbook

> 把合约从 0 跑起来的最小手册。2026-04-19 本地 anvil 跑通一次记录下来。

## 0. 前置

```bash
forge --version  # Foundry stable
anvil --version
cd contracts && forge install foundry-rs/forge-std openzeppelin/openzeppelin-contracts@v5.0.2
```

## 1. 本地 anvil 烟测 (5 分钟)

**开一个终端:**
```bash
anvil --host 127.0.0.1 --port 8545 --silent
```

**另一个终端:**
```bash
cd contracts
# anvil account 0 = deployer
export DEPLOYER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# anvil account 1 = vault OWNER (刻意不等于 deployer,模拟生产)
export OWNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
# forge script 需要这些存在就行,本地不用真 key
export BASESCAN_KEY=dummy
export BASE_SEPOLIA_RPC=http://127.0.0.1:8545
export BASE_RPC=http://127.0.0.1:8545

forge script script/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

脚本尾部会打印五个地址。保存。

## 2. Owner 钱包签名 `vault.setHeroNft(nft)`

这是**必须的 onchain 动作** — 因为 OWNER != deployer 时,脚本不能代签。

```bash
# anvil account 1 (模拟 OWNER 冷钱包)
export OWNER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
cast send $VAULT_ADDR "setHeroNft(address)" $NFT_ADDR \
  --rpc-url http://127.0.0.1:8545 --private-key $OWNER_PK
```

生产上:OWNER 用 Ledger 签 `cast wallet sign`,或 MetaMask 直接发。

## 3. 冒烟验证 (一分钟)

```bash
# 基本布线
cast call $VAULT    "OWNER()(address)"          --rpc-url $RPC
cast call $VAULT    "heroNft()(address)"        --rpc-url $RPC
cast call $NFT      "vault()(address)"          --rpc-url $RPC
cast call $NFT      "arenaAddr()(address)"      --rpc-url $RPC
cast call $STAGES   "stageCount()(uint256)"     --rpc-url $RPC  # = 12
cast call $ARENA    "stageRegistry()(address)"  --rpc-url $RPC

# 免费 mint 3 侠客
cast send $NFT "mintGenesis(address)" $PLAYER --rpc-url $RPC --private-key $PLAYER_PK
cast call $NFT "playerMintCount(address)(uint256)" $PLAYER --rpc-url $RPC  # = 3

# 跑一场 PVE
cast send $ARENA "startPve(uint256[3],uint8)" "[1,2,3]" 1 \
  --rpc-url $RPC --private-key $PLAYER_PK
cast call $ARENA "battleCounter()(uint256)" --rpc-url $RPC  # = 1

# 付费 mint — 验 vault forward. 注意 --gas-limit,默认估算偶尔偏紧会失败
cast send $NFT "mintHero(address,uint8,bool)" $PLAYER 1 true \
  --value 5000000000000000 --gas-limit 500000 \
  --rpc-url $RPC --private-key $PLAYER_PK
cast call $VAULT "getPoolBalance()(uint256)" --rpc-url $RPC  # = 5e15 wei
```

## 4. 上 Base Sepolia 的差别

只改两件事:

```bash
export BASE_SEPOLIA_RPC=https://sepolia.base.org
export DEPLOYER_PK=<你真正的 test key>
export OWNER_ADDRESS=<你 Ledger 地址>
export BASESCAN_KEY=<basescan API key>

forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $DEPLOYER_PK \
  --broadcast --verify -vvv
```

部署后:
1. 把五个地址填进 `.env` (`XIAKE_HERO_ADDRESS` 等)
2. 从 Ledger 签一笔 `vault.setHeroNft(nft)`
3. 重复 §3 的冒烟验证,但把 RPC 换成 Base Sepolia

## 踩过的坑

- **`console2.log` 最多 4 个参数**。Deploy 脚本里如果要打印 "CONTRACT(addr).method(addr)" 这种多 addr 模板,得拆成多行。
- **`@notice` + 中文 不要紧贴**:`@notice擂台` 解析失败,要 `@notice 擂台`。
- **`MAX_ROUNDS * TOTAL_SLOTS * 4` uint8 溢出** — 早期 bug,解决方法是 `uint256(MAX_ROUNDS) * uint256(TOTAL_SLOTS) * 4`。上线前 `forge test` 一定要跑通,别只看文件数。
- **`via_ir` vs legacy codegen**:BattleEngine+HeroNFT 都曾 stack-too-deep,通过拆 helper (_sectStats / _runRound / _actorTurn) 把局部变量数目压下来,legacy codegen 现在能编。别依赖 `via_ir = true`,它的错误信息没 legacy 友好。
- **anvil + `cast send`** 默认 gas-estimate 偶尔偏紧,对于跨合约调用(paid mint → vault forward)用 `--gas-limit 500000` 稳。
