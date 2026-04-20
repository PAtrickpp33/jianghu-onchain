// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {SkillRegistry} from "../src/SkillRegistry.sol";
import {GachaVault}    from "../src/GachaVault.sol";
import {HeroNFT}       from "../src/HeroNFT.sol";
import {StageRegistry} from "../src/StageRegistry.sol";
import {Arena}         from "../src/Arena.sol";
import {SeedStages}    from "./SeedStages.sol";

/// @title Deploy
/// @notice Deploys the Xiake Arena contract stack (Base Sepolia or any EVM chain).
/// @dev    Env:
///           DEPLOYER_PK         — deployer private key
///           OWNER_ADDRESS       — vault owner. Only this address can withdraw
///                                 gacha proceeds from the vault.
///           CONTENT_CURATOR     — (optional) hot wallet for day-to-day content
///                                 updates (addStage / addSkill). Zero = owner-only.
///           BASE_SEPOLIA_RPC    — RPC url (or BASE_RPC for mainnet)
///
///         Deploy order:
///           1. SkillRegistry        (pure lookup)
///           2. GachaVault           (owner = OWNER_ADDRESS, immutable)
///           3. HeroNFT              (needs vault, registry)
///           4. StageRegistry        (content registry; deployer = owner)
///           5. Arena                (needs HeroNFT, stageRegistry)
///           6. Vault.setHeroNft     (one-shot bind)
///           7. HeroNFT.setArena     (enable wound writeback)
///           8. SeedStages.seed      (register 12 launch stages)
///           9. Hand off curator keys if CONTENT_CURATOR set
contract Deploy is Script {
    function run() external returns (
        SkillRegistry registry,
        GachaVault    vault,
        HeroNFT       nft,
        StageRegistry stages,
        Arena         arena
    ) {
        uint256 pk          = vm.envUint("DEPLOYER_PK");
        address deployer    = vm.addr(pk);
        address vaultOwner  = vm.envAddress("OWNER_ADDRESS");
        address curator     = vm.envOr("CONTENT_CURATOR", address(0));

        require(vaultOwner != address(0), "Deploy: OWNER_ADDRESS unset");

        console2.log("Deployer:", deployer);
        console2.log("Vault owner (OWNER_ADDRESS):", vaultOwner);
        console2.log("Content curator:", curator);
        console2.log("ChainId:", block.chainid);

        vm.startBroadcast(pk);

        registry = new SkillRegistry();
        console2.log("SkillRegistry:", address(registry));

        vault = new GachaVault(vaultOwner);
        console2.log("GachaVault:", address(vault));

        nft = new HeroNFT(deployer, registry, vault);
        console2.log("HeroNFT:", address(nft));

        stages = new StageRegistry();
        console2.log("StageRegistry:", address(stages));

        arena = new Arena(nft, stages);
        console2.log("Arena:", address(arena));

        // Wire Arena <-> HeroNFT for wound / BOSS-reward writeback.
        nft.setArena(address(arena));
        console2.log("HeroNFT.arenaAddr:", address(arena));

        // Seed the 12 launch stages. SeedStages is a library so this still
        // runs under the deployer's broadcast.
        SeedStages.seed(stages);
        console2.log("Stages seeded:", stages.stageCount());

        // Hand off day-to-day content keys to the curator, if provided.
        if (curator != address(0)) {
            stages.setCurator(curator);
            registry.setCurator(curator);
            console2.log("Content curator wired:", curator);
        }

        vm.stopBroadcast();

        // Vault.setHeroNft must be signed by the vault owner, not the deployer.
        if (vaultOwner == deployer) {
            vm.broadcast(pk);
            vault.setHeroNft(address(nft));
            console2.log("Vault -> HeroNFT wired in same tx");
        } else {
            console2.log("---");
            console2.log("Action required: from OWNER_ADDRESS, call:");
            console2.log("  GachaVault:", address(vault));
            console2.log("  .setHeroNft(", address(nft));
            console2.log("  )");
        }

        // Invariants
        require(vault.OWNER() == vaultOwner, "Deploy: vault owner drift");
        require(address(nft.vault()) == address(vault), "Deploy: nft vault drift");
        require(address(arena.stageRegistry()) == address(stages), "Deploy: arena stage drift");
        require(stages.stageCount() == 12, "Deploy: stage seed mismatch");

        console2.log("---");
        console2.log("Copy into skill/src/chain/contracts.ts:");
        console2.log("  registry     =", address(registry));
        console2.log("  vault        =", address(vault));
        console2.log("  heroNft      =", address(nft));
        console2.log("  stageRegistry=", address(stages));
        console2.log("  arena        =", address(arena));
    }
}
