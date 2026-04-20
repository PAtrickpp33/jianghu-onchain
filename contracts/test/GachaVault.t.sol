// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {GachaVault} from "../src/GachaVault.sol";

/// @title GachaVault unit tests
contract GachaVaultTest is Test {
    GachaVault vault;

    address owner  = address(0x0FFEE);
    address bob    = address(0xB0B);
    address carol  = address(0xCA401);
    address heroNft = address(0xDEADBEEF);

    function setUp() public {
        vault = new GachaVault(owner);
        vm.prank(owner);
        vault.setHeroNft(heroNft);
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    function testOwnerIsImmutable() public {
        assertEq(vault.OWNER(), owner);
    }

    function testZeroOwnerReverts() public {
        vm.expectRevert(bytes("Vault: zero owner"));
        new GachaVault(address(0));
    }

    function testSetHeroNftOneShot() public {
        // Already set in setUp. Second call must revert regardless of caller.
        vm.prank(owner);
        vm.expectRevert(bytes("Vault: heroNft set"));
        vault.setHeroNft(address(0xBEEF));
    }

    function testSetHeroNftOnlyOwner() public {
        GachaVault v2 = new GachaVault(owner);
        vm.prank(bob);
        vm.expectRevert(bytes("Vault: not owner"));
        v2.setHeroNft(heroNft);
    }

    // ---------------------------------------------------------------------
    // Deposits
    // ---------------------------------------------------------------------

    function testReceiveDeposit() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok, ) = address(vault).call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(vault.getPoolBalance(), 0.1 ether);
        assertEq(vault.totalDeposited(), 0.1 ether);
    }

    function testDepositEntrypoint() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vault.deposit{value: 0.05 ether}();
        assertEq(vault.totalDeposited(), 0.05 ether);
    }

    function testDepositsAggregate() public {
        vm.deal(bob, 1 ether);
        vm.deal(carol, 1 ether);
        vm.prank(bob);   vault.deposit{value: 0.1 ether}();
        vm.prank(carol); vault.deposit{value: 0.2 ether}();
        assertEq(vault.totalDeposited(), 0.3 ether);
        assertEq(vault.getPoolBalance(), 0.3 ether);
    }

    // ---------------------------------------------------------------------
    // Access control on withdrawal
    // ---------------------------------------------------------------------

    function testScheduleWithdrawalOnlyOwner() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();

        vm.prank(bob);
        vm.expectRevert(bytes("Vault: not owner"));
        vault.scheduleWithdrawal(bob, 0.1 ether);
    }

    function testExecuteWithdrawalOnlyOwner() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();
        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);

        vm.warp(block.timestamp + 3 days);
        vm.prank(bob);
        vm.expectRevert(bytes("Vault: not owner"));
        vault.executeWithdrawal(0.1 ether);
    }

    function testCancelWithdrawalOnlyOwner() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();
        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);

        vm.prank(bob);
        vm.expectRevert(bytes("Vault: not owner"));
        vault.cancelWithdrawal();
    }

    // ---------------------------------------------------------------------
    // Timelock semantics
    // ---------------------------------------------------------------------

    function testWithdrawalRequiresDelay() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();

        vm.prank(owner);
        vault.scheduleWithdrawal(owner, 0.1 ether);

        vm.prank(owner);
        vm.expectRevert(bytes("Vault: timelock active"));
        vault.executeWithdrawal(0.1 ether);

        vm.warp(block.timestamp + 2 days);
        uint256 ownerBalBefore = owner.balance;
        vm.prank(owner);
        vault.executeWithdrawal(0.1 ether);

        assertEq(owner.balance, ownerBalBefore + 0.1 ether);
        assertEq(vault.totalWithdrawn(), 0.1 ether);
        assertEq(vault.getPoolBalance(), 0.4 ether);
    }

    function testAmountMismatchReverts() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();
        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);
        vm.warp(block.timestamp + 2 days);

        vm.prank(owner);
        vm.expectRevert(bytes("Vault: amount mismatch"));
        vault.executeWithdrawal(0.2 ether);
    }

    function testScheduleOverwrites() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();

        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);
        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.2 ether);

        (, uint256 amt, ) = vault.getPendingWithdrawal();
        assertEq(amt, 0.2 ether);
    }

    function testCancelClearsSlot() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();

        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);
        vm.prank(owner); vault.cancelWithdrawal();

        (address t, uint256 a, uint64 u) = vault.getPendingWithdrawal();
        assertEq(t, address(0));
        assertEq(a, 0);
        assertEq(u, 0);

        vm.prank(owner);
        vm.expectRevert(bytes("Vault: no pending"));
        vault.executeWithdrawal(0.1 ether);
    }

    function testScheduleZeroTargetReverts() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();
        vm.prank(owner);
        vm.expectRevert(bytes("Vault: zero target"));
        vault.scheduleWithdrawal(address(0), 0.1 ether);
    }

    function testScheduleBadAmountReverts() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Vault: bad amount"));
        vault.scheduleWithdrawal(owner, 0);

        vm.prank(owner);
        vm.expectRevert(bytes("Vault: bad amount"));
        vault.scheduleWithdrawal(owner, 1 ether); // vault balance 0
    }

    // ---------------------------------------------------------------------
    // Pause
    // ---------------------------------------------------------------------

    function testPauseBlocksExecution() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.5 ether}();
        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);
        vm.warp(block.timestamp + 2 days);

        vm.prank(owner); vault.setEmergencyPause(true);
        vm.prank(owner);
        vm.expectRevert(bytes("Vault: paused"));
        vault.executeWithdrawal(0.1 ether);

        vm.prank(owner); vault.setEmergencyPause(false);
        vm.prank(owner); vault.executeWithdrawal(0.1 ether);
    }

    function testPauseDoesNotBlockDeposits() public {
        vm.prank(owner); vault.setEmergencyPause(true);
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.1 ether}();
        assertEq(vault.totalDeposited(), 0.1 ether);
    }

    // ---------------------------------------------------------------------
    // Ledger view
    // ---------------------------------------------------------------------

    function testLedgerView() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob); vault.deposit{value: 0.3 ether}();

        vm.prank(owner); vault.scheduleWithdrawal(owner, 0.1 ether);
        vm.warp(block.timestamp + 2 days);
        vm.prank(owner); vault.executeWithdrawal(0.1 ether);

        (uint256 dep, uint256 wd, uint256 bal) = vault.getLedger();
        assertEq(dep, 0.3 ether);
        assertEq(wd,  0.1 ether);
        assertEq(bal, 0.2 ether);
    }
}
