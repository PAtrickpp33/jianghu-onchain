// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title GachaVault
/// @notice Dedicated sink for gacha (侠客招募) revenue. Receives every paid mint
///         from HeroNFT and holds it until the vault owner schedules + executes
///         a withdrawal. No role hierarchy — a single immutable OWNER wired at
///         construction from OWNER_ADDRESS in .env. OWNER alone can schedule
///         and execute withdrawals.
/// @dev Two-step withdrawal with WITHDRAWAL_DELAY protects against a compromised
///      owner key — players have 48h to exit before funds leave. Emits
///      events at every state transition so the dashboard + audit tools can
///      render a human-readable ledger.
contract GachaVault is ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------

    /// @notice Sole address allowed to schedule + execute withdrawals. Set in
    ///         the constructor from vm.envAddress("OWNER_ADDRESS") and never
    ///         changes — losing this key means funds are stuck until
    ///         `emergencyPaused` is flipped (by whom? there is no second key,
    ///         on purpose — single-owner is the entire point).
    address public immutable OWNER;

    /// @notice Address of the HeroNFT contract whose gacha proceeds we receive.
    ///         Set once after construction via `setHeroNft` because HeroNFT's
    ///         constructor needs the vault address first (circular dep).
    address public heroNft;

    // ---------------------------------------------------------------------
    // Timelock / safety
    // ---------------------------------------------------------------------

    /// @notice Mandatory delay between `scheduleWithdrawal` and `executeWithdrawal`.
    ///         Mirrors HeroNFT's old local window so the UX is unchanged.
    uint64 public constant WITHDRAWAL_DELAY = 2 days;

    /// @notice Pending withdrawal slot. Single outstanding schedule at a time.
    address public pendingTarget;
    uint256 public pendingAmount;
    uint64  public pendingUnlockAt;

    /// @notice When true, `executeWithdrawal` reverts. Owner can flip this off;
    ///         deposits remain permitted so the game does not break.
    bool public emergencyPaused;

    // ---------------------------------------------------------------------
    // Ledger
    // ---------------------------------------------------------------------

    /// @notice Lifetime ETH received. Monotonic; survives withdrawals.
    uint256 public totalDeposited;

    /// @notice Lifetime ETH withdrawn. Monotonic; `totalDeposited - totalWithdrawn`
    ///         plus any direct transfers equals `address(this).balance`.
    uint256 public totalWithdrawn;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event HeroNftSet(address indexed heroNft);
    event Deposited(address indexed from, uint256 amount, uint256 runningTotal);
    event WithdrawalScheduled(address indexed target, uint256 amount, uint64 executeAfter);
    event WithdrawalCancelled(address indexed target, uint256 amount);
    event WithdrawalExecuted(address indexed target, uint256 amount);
    event EmergencyPauseToggled(bool paused);

    // ---------------------------------------------------------------------
    // Access
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == OWNER, "Vault: not owner");
        _;
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address owner_) {
        require(owner_ != address(0), "Vault: zero owner");
        OWNER = owner_;
    }

    // ---------------------------------------------------------------------
    // One-shot wiring
    // ---------------------------------------------------------------------

    /// @notice Bind the HeroNFT that routes gacha fees here. One-shot — after
    ///         the initial wire-up the link is permanent. Prevents the owner
    ///         from redirecting receipts to a hostile contract.
    function setHeroNft(address heroNft_) external onlyOwner {
        require(heroNft == address(0), "Vault: heroNft set");
        require(heroNft_ != address(0), "Vault: zero heroNft");
        heroNft = heroNft_;
        emit HeroNftSet(heroNft_);
    }

    // ---------------------------------------------------------------------
    // Receiving ETH
    // ---------------------------------------------------------------------

    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    /// @notice Alternate deposit entrypoint. Exists so HeroNFT can use an
    ///         explicit call (cheaper than `call{value: v}("")` in some paths)
    ///         and so the tx trace is self-documenting.
    function deposit() external payable {
        _deposit(msg.sender, msg.value);
    }

    function _deposit(address from, uint256 amount) internal {
        if (amount == 0) return;
        totalDeposited += amount;
        emit Deposited(from, amount, totalDeposited);
    }

    // ---------------------------------------------------------------------
    // Owner-only withdrawal
    // ---------------------------------------------------------------------

    /// @notice Queue a withdrawal that can execute after `WITHDRAWAL_DELAY`.
    ///         Overwrites any previously scheduled withdrawal.
    function scheduleWithdrawal(address target, uint256 amount) external onlyOwner {
        require(target != address(0), "Vault: zero target");
        require(amount > 0 && amount <= address(this).balance, "Vault: bad amount");

        uint64 unlockAt = uint64(block.timestamp) + WITHDRAWAL_DELAY;
        pendingTarget   = target;
        pendingAmount   = amount;
        pendingUnlockAt = unlockAt;
        emit WithdrawalScheduled(target, amount, unlockAt);
    }

    /// @notice Abort the pending withdrawal without waiting for the timelock.
    function cancelWithdrawal() external onlyOwner {
        require(pendingTarget != address(0), "Vault: no pending");
        address tgt = pendingTarget;
        uint256 amt = pendingAmount;
        pendingTarget   = address(0);
        pendingAmount   = 0;
        pendingUnlockAt = 0;
        emit WithdrawalCancelled(tgt, amt);
    }

    /// @notice Execute the scheduled withdrawal. `amount` must match the
    ///         scheduled amount exactly so a compromised owner cannot inflate
    ///         the transfer after the 48h community window.
    function executeWithdrawal(uint256 amount) external onlyOwner nonReentrant {
        require(!emergencyPaused, "Vault: paused");
        require(pendingTarget != address(0), "Vault: no pending");
        require(pendingAmount == amount, "Vault: amount mismatch");
        require(block.timestamp >= pendingUnlockAt, "Vault: timelock active");
        require(amount <= address(this).balance, "Vault: short balance");

        address target = pendingTarget;

        pendingTarget   = address(0);
        pendingAmount   = 0;
        pendingUnlockAt = 0;

        totalWithdrawn += amount;

        (bool ok, ) = payable(target).call{value: amount}("");
        require(ok, "Vault: transfer failed");
        emit WithdrawalExecuted(target, amount);
    }

    /// @notice Flip emergency pause for withdrawals. Deposits remain open so
    ///         live gameplay is unaffected.
    function setEmergencyPause(bool paused) external onlyOwner {
        emergencyPaused = paused;
        emit EmergencyPauseToggled(paused);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Current ETH held by the vault.
    function getPoolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Tuple view over the pending withdrawal slot.
    function getPendingWithdrawal()
        external
        view
        returns (address target, uint256 amount, uint64 executeAfter)
    {
        return (pendingTarget, pendingAmount, pendingUnlockAt);
    }

    /// @notice Lifetime accounting snapshot.
    function getLedger()
        external
        view
        returns (uint256 deposited, uint256 withdrawn, uint256 balance)
    {
        return (totalDeposited, totalWithdrawn, address(this).balance);
    }
}
