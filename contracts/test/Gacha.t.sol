// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../src/Types.sol";
import {SkillRegistry} from "../src/SkillRegistry.sol";
import {GachaVault} from "../src/GachaVault.sol";
import {HeroNFT} from "../src/HeroNFT.sol";

/// @title GachaTest
/// @notice Covers the economic / pity / referral / exchange surface that the
///         main Arena test file treats as "happy path only". These paths run
///         on-chain for every real player so any drift here hits production.
contract GachaTest is Test {
    SkillRegistry registry;
    GachaVault    vault;
    HeroNFT       nft;

    address alice = address(0xA11CE);
    address bob   = address(0xB0B);
    address carol = address(0xCA401);

    function setUp() public {
        registry = new SkillRegistry();
        vault    = new GachaVault(address(this));
        nft      = new HeroNFT(address(this), registry, vault);
        vault.setHeroNft(address(nft));
        vm.deal(alice, 10 ether);
        vm.deal(bob,   10 ether);
        vm.deal(carol, 10 ether);
    }

    // =====================================================================
    // Pricing / discount
    // =====================================================================

    function testBronzeUnitPrice() public {
        vm.prank(alice);
        nft.mintHeroTier{value: 1e15}(alice, 1, true, 0); // tier 0 = bronze
        assertEq(address(vault).balance, 1e15);
    }

    function testSilverUnitPrice() public {
        vm.prank(alice);
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1);
        assertEq(address(vault).balance, 5e15);
    }

    function testGoldUnitPrice() public {
        vm.prank(alice);
        nft.mintHeroTier{value: 1e16}(alice, 1, true, 2);
        assertEq(address(vault).balance, 1e16);
    }

    function testTenPullAppliesDiscount() public {
        // Silver: 10 × 0.005 × 0.9 = 0.045 ETH
        uint256 expected = 45 * 1e15;
        vm.prank(alice);
        nft.mintHeroTier{value: expected}(alice, 10, true, 1);
        assertEq(address(vault).balance, expected);
    }

    function testPaidMintRefundsOverpayment() public {
        uint256 unit = 5e15;
        uint256 over = unit + 1 ether; // grossly overpay
        uint256 before_ = alice.balance;
        vm.prank(alice);
        nft.mintHeroTier{value: over}(alice, 1, true, 1);
        // refund goes to msg.sender (alice). vault takes exactly `cost`.
        assertEq(address(vault).balance, unit);
        // alice paid `over`, got 1 ether refunded, net = unit
        assertEq(alice.balance, before_ - unit);
    }

    function testPaidMintBadTierReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: bad tier"));
        nft.mintHeroTier{value: 1 ether}(alice, 1, true, 3); // tier 3 doesn't exist
    }

    function testPaidMintInsufficientValueReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: insufficient payment"));
        nft.mintHeroTier{value: 1e14}(alice, 1, true, 1); // need 5e15
    }

    function testCountZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: count out of range"));
        nft.mintHeroTier{value: 0}(alice, 0, false, 1);
    }

    function testCountOverCapReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: count out of range"));
        nft.mintHeroTier{value: 1 ether}(alice, 11, true, 1);
    }

    function testFreeMintNotPayableReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: free mint not payable"));
        nft.mintHeroTier{value: 1}(alice, 1, false, 1);
    }

    // =====================================================================
    // Allowance accounting
    // =====================================================================

    function testFirstMintSeedsFreeAllowance() public {
        vm.prank(alice);
        nft.mintHero(alice, 1, false); // consumes 1 of the 3 seeded
        (uint8 free, , , , uint8 remaining) = nft.getMintAllowance(alice);
        assertEq(free, 3);
        assertEq(remaining, 2);
    }

    function testFreeMintExhausts() public {
        vm.prank(alice);
        nft.mintHero(alice, 3, false); // use all 3
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: no free allowance"));
        nft.mintHero(alice, 1, false);
    }

    // =====================================================================
    // Sect pity (30 threshold)
    // =====================================================================

    function testSectPityCountersIncrement() public {
        vm.prank(alice);
        nft.mintHero(alice, 3, false); // 3 free
        (uint16 current,,) = nft.getPityProgress(alice);
        assertEq(current, 3);
    }

    function testSectPityFiresAt30() public {
        // Alice drains 3 free, then 10-pulls bronze (27 to 30 counter).
        vm.prank(alice);
        nft.mintHero(alice, 3, false);      // 3 in counter

        // 27 more paid mints via silver. 27 at 5e15 = 0.135 ETH.
        // Could do 2 × 10-pull + 1 × 7 ... use straight 10-pulls + fillers.
        vm.prank(alice);
        nft.mintHeroTier{value: 45 * 1e15}(alice, 10, true, 1); // +10 = 13
        vm.prank(alice);
        nft.mintHeroTier{value: 45 * 1e15}(alice, 10, true, 1); // +10 = 23
        vm.prank(alice);
        nft.mintHeroTier{value: 35 * 1e15}(alice, 7, true, 1);  // +7 = 30 → fires, counter = 0

        (uint16 after_,,) = nft.getPityProgress(alice);
        assertEq(after_, 0, "sect pity should reset after firing");
    }

    // =====================================================================
    // Referral
    // =====================================================================

    function testSetReferrer() public {
        vm.prank(alice);
        nft.setReferrer(bob);
        assertEq(nft.referredBy(alice), bob);
    }

    function testCannotReferSelf() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: self referral"));
        nft.setReferrer(alice);
    }

    function testCannotReferZero() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: zero referrer"));
        nft.setReferrer(address(0));
    }

    /// @notice Players who paid before registering a referrer forfeit the
    ///         bonus — the "already paid" guard blocks retroactive referral.
    /// @dev Separate from `testCannotRebindReferrer` which tests the "already
    ///      set" guard. Here nobody has been set first.
    function testCannotReferAfterPaidMint() public {
        vm.prank(alice);
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1); // alice paid, no referrer

        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: already paid"));
        nft.setReferrer(bob);
    }

    function testCannotRebindReferrer() public {
        vm.prank(alice);
        nft.setReferrer(bob);
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: already set"));
        nft.setReferrer(carol);
    }

    function testReferralRewardPaidOnFirstPaidMint() public {
        vm.prank(alice);
        nft.setReferrer(bob);

        vm.prank(alice);
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1);

        assertEq(nft.earnedFromReferral(bob), 2e15, "bob gets 0.002 ETH credit");
        assertTrue(nft.referralRewardPaid(alice));
    }

    function testReferralRewardNotPaidTwice() public {
        vm.prank(alice);
        nft.setReferrer(bob);
        vm.prank(alice);
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1); // first paid

        uint256 earnedAfterFirst = nft.earnedFromReferral(bob);

        vm.prank(alice);
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1); // second paid
        assertEq(nft.earnedFromReferral(bob), earnedAfterFirst, "no second credit");
    }

    // =====================================================================
    // Exchange duplicate + pityBoost
    // =====================================================================

    function testExchangeDuplicateBurnsAndMintsShards() public {
        // Alice needs owned tokens to burn. Use free mint to get 3 heroes.
        vm.prank(alice);
        nft.mintHero(alice, 3, false); // tokens 1-3

        uint256[] memory ids = new uint256[](2);
        ids[0] = 1; ids[1] = 2;
        vm.prank(alice);
        nft.exchangeDuplicate(ids);

        assertEq(nft.shards(alice), 10, "5 shards per duplicate x 2");
        vm.expectRevert(); // ERC721 _requireOwned on burnt token reverts
        nft.ownerOf(1);
    }

    function testExchangeDuplicateRejectsNonOwner() public {
        vm.prank(alice);
        nft.mintHero(alice, 1, false);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.prank(bob);
        vm.expectRevert(bytes("HeroNFT: not owner"));
        nft.exchangeDuplicate(ids);
    }

    function testExchangeDuplicateEmptyReverts() public {
        uint256[] memory ids = new uint256[](0);
        vm.expectRevert(bytes("HeroNFT: empty ids"));
        nft.exchangeDuplicate(ids);
    }

    function testPityBoost() public {
        // Get 2 duplicate exchanges = 10 shards, then boost.
        vm.prank(alice);
        nft.mintHero(alice, 3, false);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1; ids[1] = 2;
        vm.prank(alice);
        nft.exchangeDuplicate(ids); // 10 shards

        (uint16 before_, , ) = nft.getPityProgress(alice);
        // we have 3 from the free mint. boost by 1 (consume 5 shards).
        vm.prank(alice);
        nft.pityBoost(1);
        (uint16 after_, , ) = nft.getPityProgress(alice);

        assertEq(after_, before_ + 1);
        assertEq(nft.shards(alice), 5, "5 shards remaining");
    }

    function testPityBoostInsufficientShardsReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: insufficient shards"));
        nft.pityBoost(1);
    }

    function testPityBoostZeroStepsReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: zero steps"));
        nft.pityBoost(0);
    }

    // =====================================================================
    // Emergency pause
    // =====================================================================

    function testPauseBlocksAllMints() public {
        nft.setEmergencyPause(true);
        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: paused"));
        nft.mintHero(alice, 1, false);

        vm.prank(alice);
        vm.expectRevert(bytes("HeroNFT: paused"));
        nft.mintHeroTier{value: 5e15}(alice, 1, true, 1);
    }

    function testPauseDoesNotBlockViews() public {
        nft.setEmergencyPause(true);
        // views still work even when paused.
        nft.getPoolBalance();
        (uint8 f,,,,) = nft.getMintAllowance(alice);
        assertEq(f, 0); // alice never minted
    }

    function testPauseOwnerOnly() public {
        vm.prank(bob);
        // OZ v5 custom error
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        nft.setEmergencyPause(true);
    }

    function testSetPriceOwnerOnly() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", bob));
        nft.setPrice(1);
    }
}
