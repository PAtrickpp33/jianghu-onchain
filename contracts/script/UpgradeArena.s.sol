// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {HeroNFT}       from "../src/HeroNFT.sol";
import {Arena}         from "../src/Arena.sol";
import {StageRegistry} from "../src/StageRegistry.sol";

/// @title UpgradeArena
/// @notice Redeploys just the Arena contract and rewires HeroNFT.setArena.
///         Used when an Arena bug surfaces in production and the rest of the
///         stack (HeroNFT / Vault / StageRegistry) is fine.
///
/// @dev    Env:
///           DEPLOYER_PK          — same key that owns HeroNFT (holds Ownable
///                                   ownership for setArena). On Sepolia this
///                                   is the same wallet as OWNER_ADDRESS.
///           XIAKE_HERO_ADDRESS   — existing HeroNFT
///           XIAKE_STAGES_ADDRESS — existing StageRegistry
///           BASE_SEPOLIA_RPC     — rpc url
///
///         Run:
///           forge script script/UpgradeArena.s.sol \
///             --rpc-url $BASE_SEPOLIA_RPC \
///             --broadcast
contract UpgradeArena is Script {
    function run() external returns (Arena newArena) {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address nftAddr    = vm.envAddress("XIAKE_HERO_ADDRESS");
        address stagesAddr = vm.envAddress("XIAKE_STAGES_ADDRESS");

        HeroNFT nft = HeroNFT(payable(nftAddr));
        StageRegistry stages = StageRegistry(stagesAddr);

        console2.log("HeroNFT    :", address(nft));
        console2.log("StageReg   :", address(stages));
        console2.log("Old Arena  :", nft.arenaAddr());

        vm.startBroadcast(pk);

        newArena = new Arena(nft, stages);
        console2.log("New Arena  :", address(newArena));

        // Rewire HeroNFT to point at the new Arena. This revokes the old
        // Arena's setWound / grantBossMint privileges and grants them to the
        // new one atomically.
        nft.setArena(address(newArena));

        vm.stopBroadcast();

        require(nft.arenaAddr() == address(newArena), "Upgrade: setArena drift");
        require(address(newArena.stageRegistry()) == address(stages), "Upgrade: stages drift");

        console2.log("---");
        console2.log("Update .env: XIAKE_ARENA_ADDRESS=%s", address(newArena));
    }
}
