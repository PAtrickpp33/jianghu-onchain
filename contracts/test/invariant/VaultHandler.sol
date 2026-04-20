// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats}  from "forge-std/StdCheats.sol";
import {StdUtils}   from "forge-std/StdUtils.sol";

import {GachaVault} from "../../src/GachaVault.sol";

/// @title VaultHandler
/// @notice Fuzz target for GachaVault's invariant suite. Each public function
///         here corresponds to an "action" the fuzzer picks at random. The
///         handler tracks its own view of deposits / withdrawals so the
///         invariant contract can cross-check against on-chain accounting.
///
/// Design notes:
///   - `forge-std/CommonBase` gives us `vm` without inheriting the whole
///     Test contract (which would pull in fuzzer state).
///   - Callers (depositors) are randomised from a small actor pool so we
///     exercise many senders without blowing up state.
///   - Withdrawals go through the vault's two-step schedule+execute. We
///     auto-advance time to simulate the 48h timelock.
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    GachaVault public immutable vault;
    address    public immutable owner;
    address[3] public actors;

    /// @dev Mirror of what this handler has pushed into / pulled out of the
    ///      vault. Used by the invariant to independently check the ledger.
    uint256 public ghostDeposited;
    uint256 public ghostWithdrawn;

    constructor(GachaVault _vault, address _owner) {
        vault = _vault;
        owner = _owner;
        actors[0] = address(0xA11CE);
        actors[1] = address(0xB0B);
        actors[2] = address(0xCA401);
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 100 ether);
        }
        vm.deal(owner, 10 ether);
    }

    // ---------------------------------------------------------------------
    // Fuzz targets
    // ---------------------------------------------------------------------

    /// @notice Random actor deposits a random amount (1 wei .. 1 ETH).
    function deposit(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 1 ether);
        if (actor.balance < amount) return; // skip if actor somehow out of funds
        vm.prank(actor);
        vault.deposit{value: amount}();
        ghostDeposited += amount;
    }

    /// @notice Send ETH via receive() (no calldata) — equivalent path,
    ///         different entrypoint.
    function rawSend(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 1 ether);
        if (actor.balance < amount) return;
        vm.prank(actor);
        (bool ok, ) = address(vault).call{value: amount}("");
        if (ok) ghostDeposited += amount;
    }

    /// @notice Owner schedules a withdrawal of up to the current pool balance.
    function scheduleWithdraw(uint256 amount, uint256 targetSeed) external {
        uint256 bal = address(vault).balance;
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        address target = actors[targetSeed % actors.length];
        vm.prank(owner);
        vault.scheduleWithdrawal(target, amount);
    }

    /// @notice Owner cancels any pending withdrawal.
    function cancelWithdraw() external {
        (address t, , ) = vault.getPendingWithdrawal();
        if (t == address(0)) return;
        vm.prank(owner);
        vault.cancelWithdrawal();
    }

    /// @notice Advance time + execute a pending withdrawal.
    function executeWithdraw() external {
        (address t, uint256 amt, uint64 unlockAt) = vault.getPendingWithdrawal();
        if (t == address(0) || amt == 0) return;
        if (amt > address(vault).balance) return;
        if (block.timestamp < unlockAt) {
            vm.warp(uint256(unlockAt) + 1);
        }
        vm.prank(owner);
        vault.executeWithdrawal(amt);
        ghostWithdrawn += amt;
    }
}
