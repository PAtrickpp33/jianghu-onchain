// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test}    from "forge-std/Test.sol";
import {Vm}      from "forge-std/Vm.sol";

import {Types}         from "../src/Types.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {GachaVault}    from "../src/GachaVault.sol";
import {HeroNFT}       from "../src/HeroNFT.sol";
import {StageRegistry} from "../src/StageRegistry.sol";
import {Arena}         from "../src/Arena.sol";

/// @title Arena integration tests
/// @notice End-to-end path: mint -> setDefense -> challenge / startPve -> read report.
contract ArenaTest is Test {
    SkillRegistry registry;
    GachaVault    vault;
    HeroNFT       nft;
    StageRegistry stages;
    Arena         arena;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);

    function setUp() public {
        registry = new SkillRegistry();
        vault    = new GachaVault(address(this));
        nft      = new HeroNFT(address(this), registry, vault);
        vault.setHeroNft(address(nft));
        stages   = new StageRegistry();
        arena    = new Arena(nft, stages);
        // Authorise Arena to mutate hero wound state after battles.
        nft.setArena(address(arena));

        // Register a minimal stage 1 so startPve works under the test harness.
        Types.Hero[3] memory bossTeam;
        bossTeam[0] = _bossHero(1001, Types.Sect.Shaolin, 200, 80, 100, 60, 500,  0, 1, 2);
        bossTeam[1] = _bossHero(1002, Types.Sect.Tangmen, 130, 95, 50,  95, 2000, 3, 4, 5);
        bossTeam[2] = _bossHero(1003, Types.Sect.Emei,    160, 75, 70,  85, 1000, 6, 7, 8);
        stages.addStage(1, 1, keccak256("stage1"), "test stage 1", 0, bossTeam);

        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
    }

    function _bossHero(
        uint256 tokenId, Types.Sect sect,
        uint16 hp, uint16 atk, uint16 def, uint16 spd, uint16 crit,
        uint8 s1, uint8 s2, uint8 s3
    ) internal pure returns (Types.Hero memory h) {
        uint8[] memory sk = new uint8[](3);
        sk[0] = s1; sk[1] = s2; sk[2] = s3;
        h = Types.Hero({
            tokenId: tokenId, sect: sect,
            hp: hp, atk: atk, def: def, spd: spd, crit: crit,
            skillIds: sk
        });
    }

    // ---------------------------------------------------------------------
    // Mint
    // ---------------------------------------------------------------------
    function testMintGenesis() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(ids[2], 3);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.ownerOf(2), alice);
        assertEq(nft.ownerOf(3), alice);

        // Genesis now uses the 7-sect random pool (not the legacy
        // Shaolin/Tangmen/Emei hard wiring). Assert only shape invariants.
        Types.Hero memory h0 = nft.getHero(ids[0]);
        Types.Hero memory h1 = nft.getHero(ids[1]);
        Types.Hero memory h2 = nft.getHero(ids[2]);
        assertTrue(uint8(h0.sect) < 7, "sect < 7");
        assertTrue(uint8(h1.sect) < 7, "sect < 7");
        assertTrue(uint8(h2.sect) < 7, "sect < 7");
        assertEq(h0.skillIds.length, 3);
        assertEq(h1.skillIds.length, 3);
        assertEq(h2.skillIds.length, 3);

        // Allowance accounting: seed = 3, used = 3, remaining = 0.
        (uint8 free,,, uint16 paid, uint8 remaining) = nft.getMintAllowance(alice);
        assertEq(free, 3);
        assertEq(paid, 0);
        assertEq(remaining, 0);
    }

    /// @notice mintGenesis now consumes the free allowance pool (3 free seed).
    ///         A second call before the player earns more allowance must revert
    ///         — otherwise anyone could spam mintGenesis forever and bloat storage.
    function testGenesisCannotBeSpammed() public {
        vm.prank(alice);
        nft.mintGenesis(alice);

        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: no free allowance"));
        nft.mintGenesis(alice);
    }

    /// @notice After earning a BOSS first-clear reward (+1 free), the player
    ///         can free-mint exactly one more hero — not another full 3-pack.
    function testGenesisAfterBossRewardOnlyOneFree() public {
        vm.prank(alice);
        nft.mintGenesis(alice); // seed 3 → used 3

        // Simulate Arena granting a BOSS first-clear reward.
        vm.prank(address(arena));
        nft.grantBossMint(alice, 5);

        // Second mintGenesis still reverts (needs 3, only 1 available).
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: no free allowance"));
        nft.mintGenesis(alice);

        // But mintHero(count=1) succeeds.
        vm.prank(alice);
        nft.mintHero(alice, 1, false);
        assertEq(nft.playerMintCount(alice), 4);
    }

    /// @notice Regression (2026-04-20): Phase 2 Sepolia testing found stage
    ///         `minReputation` was stored but never enforced by `startPve`,
    ///         so players could jump straight to chapter 3 bosses from rep 0.
    ///         Arena now reads the stage header and gates on `totalExp`.
    function testPveRejectsIfRepTooLow() public {
        // Register a stage with a non-zero minReputation.
        Types.Hero[3] memory bossTeam;
        bossTeam[0] = _bossHero(1001, Types.Sect.Shaolin, 200, 80, 100, 60, 500, 0, 1, 2);
        bossTeam[1] = _bossHero(1002, Types.Sect.Tangmen, 130, 95, 50,  95, 2000, 3, 4, 5);
        bossTeam[2] = _bossHero(1003, Types.Sect.Emei,    160, 75, 70,  85, 1000, 6, 7, 8);
        stages.addStage(9, 2, keccak256("stage9-rep500"), "rep 500 req", 500, bossTeam);

        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        // Alice has totalExp=0, stage 9 requires 500. Should revert.
        vm.prank(alice);
        vm.expectRevert(bytes("Arena: reputation too low"));
        arena.startPve(ids, 9);
    }

    /// @notice Stages with minReputation=0 stay freely accessible (backwards-
    ///         compatible for launch-seeded content before the gate landed).
    function testPveAllowsWhenRepZero() public {
        // Stage 1 has minReputation=0 (from setUp). Alice at rep=0 should succeed.
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);
        vm.prank(alice);
        arena.startPve(ids, 1); // no revert
    }

    /// @notice Regression: PVE victory must advance `playerProgress.currentChapter`.
    ///         Round-2 Sepolia smoke surfaced that wins never bumped the ledger,
    ///         stranding players at chapter 0 forever (so `learnSkill` +
    ///         reputation gates + BOSS rewards never unlocked).
    function testPveWinAdvancesChapter() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        Types.StoryProgress memory before = arena.getStoryProgress(alice);
        assertEq(before.currentChapter, 0, "starts at 0");
        assertEq(before.bossDefeated.length, 0);

        vm.prank(alice);
        bytes32 bid = arena.startPve(ids, 1);
        Types.BattleReport memory rep = arena.getBattleReport(bid);

        if (rep.winner == 0) {
            // Win — clear ledger must advance.
            Types.StoryProgress memory after_ = arena.getStoryProgress(alice);
            assertEq(after_.currentChapter, 1, "chapter = stageId after win");
            assertEq(after_.bossDefeated.length, 1);
            assertEq(after_.totalExp, 100, "100 exp per stage");
        } else {
            // If RNG gave a loss, at least confirm chapter did NOT move — the
            // old bug was "chapter doesn't advance regardless", so only winners
            // should register. Losers stay at 0.
            Types.StoryProgress memory after_ = arena.getStoryProgress(alice);
            assertEq(after_.currentChapter, 0, "loss keeps chapter 0");
        }
    }

    /// @notice learnSkill requires the player to have cleared the milestone
    ///         chapter before an extra skill can be taught to one of their heroes.
    function testLearnSkillGated() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        // Before milestone: reverts.
        vm.prank(alice);
        vm.expectRevert(bytes("Arena: milestone not met"));
        arena.learnSkill(ids[0], 7);

        // Fast-forward progress to milestone (owner gates completeStage).
        arena.completeStage(alice, 3);

        vm.prank(alice);
        arena.learnSkill(ids[0], 7);

        uint8[] memory extras = nft.getUnlockedSkills(ids[0]);
        assertEq(extras.length, 1);
        assertEq(extras[0], 7);
    }

    /// @notice The 4 new sects (Wudang..Ming) have their own stat ranges.
    ///         Roll a representative hero each and assert the bands are
    ///         within the designed envelope — mainly a guard against enum
    ///         index drift.
    function testNewSectsGenerateInRange() public {
        // mintGenesis consumes the 3-free seed allowance, so go straight to
        // a paid 10-pull (silver tier = 0.045 ETH after -10% 10-pull discount).
        vm.prank(alice);
        nft.mintGenesis(alice);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        nft.mintHeroTier{value: 0.045 ether}(alice, 10, true, 1);

        // Walk every hero alice owns; assert stats are positive + finite (the
        // formula enforces bounded ranges so any overflow would have reverted
        // at mint).
        uint256 total = nft.playerMintCount(alice);
        assertEq(total, 13); // 3 genesis + 10 paid

        // Verify sect index stays within 0..6 for everyone.
        for (uint256 id = 1; id <= total; id++) {
            Types.Hero memory h = nft.getHero(id);
            assertLt(uint8(h.sect), 7);
            assertGt(h.hp, 0);
            assertGt(h.atk, 0);
        }
    }

    /// @notice End-to-end vault accounting: a paid mint should forward `cost`
    ///         ETH to the GachaVault (not keep it in HeroNFT). Guards against
    ///         future refactors silently breaking the revenue path.
    function testPaidMintForwardsToVault() public {
        uint256 unit = 5e15; // silver tier
        uint256 value = unit; // 1-pull
        vm.deal(alice, 1 ether);

        uint256 vaultBefore = address(vault).balance;
        uint256 nftBefore   = address(nft).balance;

        vm.prank(alice);
        nft.mintHero{value: value}(alice, 1, true);

        assertEq(address(vault).balance, vaultBefore + value, "vault got the cost");
        assertEq(address(nft).balance,   nftBefore,           "nft forwarded everything");
        assertEq(vault.totalDeposited(), vaultBefore + value, "ledger matches balance");
    }

    /// @notice 10-pull discount path + vault accounting. 10 × 0.005 × 0.9 =
    ///         0.045 ETH after the -10% ten-pull discount.
    function testPaidTenPullForwardsDiscounted() public {
        uint256 expected = 45 * 1e15; // 0.045 ETH
        vm.deal(alice, 1 ether);

        vm.prank(alice);
        nft.mintHeroTier{value: expected}(alice, 10, true, 1);

        assertEq(address(vault).balance, expected, "vault got discounted cost");
        assertEq(address(nft).balance,   0,        "nft kept nothing");
    }

    /// @notice Wounded heroes cannot enter PVE until cooldown elapses.
    function testInjuryBlocksPve() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        // Simulate a wound on id #1 — owner can call when arenaAddr is unset,
        // but we wired it, so call as arena.
        vm.prank(address(arena));
        nft.setWound(ids[0], 1);

        vm.prank(alice);
        vm.expectRevert(bytes("Arena: hero injured"));
        arena.startPve(ids, 1);

        // After cooldown passes (12h per wound level), PVE succeeds again.
        vm.warp(block.timestamp + 13 hours);
        vm.prank(alice);
        bytes32 bid = arena.startPve(ids, 1);
        assertTrue(bid != bytes32(0));
    }

    // ---------------------------------------------------------------------
    // PVE
    // ---------------------------------------------------------------------
    function testPveFlow() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        vm.prank(alice);
        bytes32 battleId = arena.startPve(ids, 1);
        assertTrue(battleId != bytes32(0), "battleId set");

        Types.BattleReport memory report = arena.getBattleReport(battleId);
        assertEq(report.battleId, battleId);
        assertEq(report.attacker, alice);
        assertEq(report.defender, address(0));
        assertTrue(report.winner <= 2);
        assertTrue(report.totalRounds > 0, "rounds recorded");
        assertTrue(report.seed != 0, "seed stored for replay");
    }

    // ---------------------------------------------------------------------
    // PVP: mint -> setDefense -> challenge -> read
    // ---------------------------------------------------------------------
    function testPvpFlow() public {
        vm.prank(alice);
        uint256[3] memory aliceIds = nft.mintGenesis(alice);

        vm.prank(bob);
        uint256[3] memory bobIds = nft.mintGenesis(bob);

        vm.prank(alice);
        arena.setDefenseTeam(aliceIds);

        vm.prank(bob);
        arena.setDefenseTeam(bobIds);

        uint256[3] memory savedAlice = arena.getDefenseTeam(alice);
        assertEq(savedAlice[0], aliceIds[0]);
        assertEq(savedAlice[1], aliceIds[1]);
        assertEq(savedAlice[2], aliceIds[2]);

        vm.prank(alice);
        bytes32 battleId = arena.challenge(bob);

        Types.BattleReport memory rep = arena.getBattleReport(battleId);
        assertEq(rep.attacker, alice);
        assertEq(rep.defender, bob);
        assertTrue(rep.totalRounds > 0);
        assertTrue(rep.seed != 0);
    }

    /// @notice After PVP, losing side's heroes pick up a wound so challenges
    ///         have an economic cost beyond gas. The winning side stays fresh.
    function testPvpAppliesWoundsOnLoss() public {
        vm.prank(alice);
        uint256[3] memory aIds = nft.mintGenesis(alice);
        vm.prank(bob);
        uint256[3] memory bIds = nft.mintGenesis(bob);

        vm.prank(alice); arena.setDefenseTeam(aIds);
        vm.prank(bob);   arena.setDefenseTeam(bIds);

        vm.prank(alice);
        bytes32 bid = arena.challenge(bob);
        Types.BattleReport memory r = arena.getBattleReport(bid);

        // Exactly one of the two teams should be unavailable (winner stays
        // fresh, loser is wounded). Draws (winner=2) are rare with these rolls
        // but handled by skipping the assertion.
        if (r.winner == 0) {
            for (uint8 i = 0; i < 3; i++) assertFalse(nft.isAvailable(bIds[i]) == true, "defender should be wounded");
            for (uint8 i = 0; i < 3; i++) assertTrue(nft.isAvailable(aIds[i]));
        } else if (r.winner == 1) {
            for (uint8 i = 0; i < 3; i++) assertFalse(nft.isAvailable(aIds[i]) == true, "attacker should be wounded");
            for (uint8 i = 0; i < 3; i++) assertTrue(nft.isAvailable(bIds[i]));
        }
    }

    function testChallengeRequiresTeam() public {
        vm.prank(alice);
        uint256[3] memory aliceIds = nft.mintGenesis(alice);

        vm.prank(alice);
        arena.setDefenseTeam(aliceIds);

        // Bob never set team
        vm.prank(alice);
        vm.expectRevert(bytes("Arena: defender no team"));
        arena.challenge(bob);
    }

    function testSelfChallengeReverts() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        vm.prank(alice);
        arena.setDefenseTeam(ids);

        vm.prank(alice);
        vm.expectRevert(bytes("Arena: self-challenge"));
        arena.challenge(alice);
    }

    // ---------------------------------------------------------------------
    // Defense ownership guard
    // ---------------------------------------------------------------------
    function testSetDefenseRequiresOwnership() public {
        vm.prank(alice);
        uint256[3] memory aliceIds = nft.mintGenesis(alice);

        // Bob tries to use alice's ids
        vm.prank(bob);
        vm.expectRevert(bytes("Arena: not owner"));
        arena.setDefenseTeam(aliceIds);
    }

    // ---------------------------------------------------------------------
    // Arena roster / listing
    // ---------------------------------------------------------------------
    function testListArena() public {
        vm.prank(alice);
        uint256[3] memory a = nft.mintGenesis(alice);
        vm.prank(bob);
        uint256[3] memory b = nft.mintGenesis(bob);

        vm.prank(alice); arena.setDefenseTeam(a);
        vm.prank(bob);   arena.setDefenseTeam(b);

        (address[] memory players, uint256[] memory powers) = arena.listArena(0, 10);
        assertEq(players.length, 2);
        assertEq(powers.length, 2);
        assertTrue(powers[0] > 0);
        assertTrue(powers[1] > 0);

        // Pagination: offset beyond length -> empty
        (address[] memory p2, ) = arena.listArena(100, 10);
        assertEq(p2.length, 0);
    }

    // ---------------------------------------------------------------------
    // EIP-712 relay signature
    // ---------------------------------------------------------------------
    function testChallengeRelay() public {
        uint256 aliceKey = 0xA11CE;
        address aliceAddr = vm.addr(aliceKey);

        // Fund + mint for signer
        vm.deal(aliceAddr, 1 ether);
        vm.prank(aliceAddr);
        uint256[3] memory aliceIds = nft.mintGenesis(aliceAddr);
        vm.prank(aliceAddr);
        arena.setDefenseTeam(aliceIds);

        vm.prank(bob);
        uint256[3] memory bobIds = nft.mintGenesis(bob);
        vm.prank(bob);
        arena.setDefenseTeam(bobIds);

        uint64 nonce = arena.playerNonce(aliceAddr);
        assertEq(nonce, 0);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 domainSep = arena.domainSeparator();

        bytes32 structHash = keccak256(abi.encode(
            arena.CHALLENGE_TYPEHASH(),
            aliceAddr,
            bob,
            nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Relay from bob's address (paymaster-style)
        vm.prank(bob);
        bytes32 battleId = arena.challengeRelay(aliceAddr, bob, deadline, sig);

        assertEq(arena.playerNonce(aliceAddr), 1);
        Types.BattleReport memory rep = arena.getBattleReport(battleId);
        assertEq(rep.attacker, aliceAddr);
        assertEq(rep.defender, bob);
    }

    function testBadRelaySignatureReverts() public {
        uint256 aliceKey = 0xA11CE;
        uint256 eveKey   = 0xEEE;
        address aliceAddr = vm.addr(aliceKey);

        vm.prank(aliceAddr);
        uint256[3] memory aliceIds = nft.mintGenesis(aliceAddr);
        vm.prank(aliceAddr);
        arena.setDefenseTeam(aliceIds);

        vm.prank(bob);
        uint256[3] memory bobIds = nft.mintGenesis(bob);
        vm.prank(bob);
        arena.setDefenseTeam(bobIds);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(
            arena.CHALLENGE_TYPEHASH(),
            aliceAddr,
            bob,
            uint64(0),
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", arena.domainSeparator(), structHash));

        // Sign with WRONG key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(eveKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.expectRevert(bytes("Arena: bad signature"));
        arena.challengeRelay(aliceAddr, bob, deadline, sig);
    }

    // ---------------------------------------------------------------------
    // BattleSettled event emitted
    // ---------------------------------------------------------------------
    function testBattleSettledEmitted() public {
        vm.prank(alice);
        uint256[3] memory ids = nft.mintGenesis(alice);

        vm.recordLogs();
        vm.prank(alice);
        arena.startPve(ids, 1);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("BattleSettled(bytes32,address,address,uint8,uint8,uint64)");
        bool found;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == topic) {
                found = true;
                break;
            }
        }
        assertTrue(found, "BattleSettled event missing");
    }
}
