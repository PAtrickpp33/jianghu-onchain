// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {GachaVault} from "../../src/GachaVault.sol";
import {VaultHandler} from "./VaultHandler.sol";

/// @title VaultInvariant
/// @notice Stateful fuzz: whatever sequence of deposits / schedules /
///         cancels / executes the fuzzer dreams up, the vault ledger must
///         stay consistent with reality.
contract VaultInvariantTest is Test {
    GachaVault   vault;
    VaultHandler handler;

    address owner = address(0x0FFEE);

    function setUp() public {
        vault = new GachaVault(owner);
        // setHeroNft must be owner-signed.
        vm.prank(owner);
        vault.setHeroNft(address(0xBEEF));

        handler = new VaultHandler(vault, owner);

        // Tell the fuzzer to only call functions on the handler contract.
        targetContract(address(handler));
    }

    // ---------------------------------------------------------------------
    // Core ledger invariant (the one we actually care about)
    // ---------------------------------------------------------------------

    /// @notice Vault ledger identity. No one other than the handler moves
    ///         ETH in this setup, so:
    ///           totalDeposited - totalWithdrawn == address(this).balance
    /// @dev If this ever drifts, gacha funds have been silently destroyed
    ///      or conjured. That's the exact failure mode the 48h timelock +
    ///      owner-only access is supposed to prevent — so it's worth
    ///      hammering randomly.
    function invariant_balanceMatchesLedger() public view {
        uint256 deposited = vault.totalDeposited();
        uint256 withdrawn = vault.totalWithdrawn();
        uint256 bal       = address(vault).balance;
        assertEq(deposited - withdrawn, bal, "vault ledger drift");
    }

    /// @notice Ghost accounting (what the handler pushed in/out) must match
    ///         the vault's own counters — catches a world where vault's
    ///         counters diverge from reality.
    function invariant_ghostMatchesVault() public view {
        assertEq(handler.ghostDeposited(), vault.totalDeposited(), "deposit ghost drift");
        assertEq(handler.ghostWithdrawn(), vault.totalWithdrawn(), "withdraw ghost drift");
    }

    /// @notice `totalWithdrawn` is monotonic; can never exceed totalDeposited.
    function invariant_withdrawnLeDeposited() public view {
        assertLe(vault.totalWithdrawn(), vault.totalDeposited(), "withdrew more than deposited");
    }

    /// @notice OWNER is immutable — no code path should change it.
    function invariant_ownerImmutable() public view {
        assertEq(vault.OWNER(), owner, "owner drifted");
    }
}
