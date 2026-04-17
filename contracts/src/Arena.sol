// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}  from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Types}         from "./Types.sol";
import {BattleEngine}  from "./BattleEngine.sol";
import {HeroNFT}       from "./HeroNFT.sol";

/// @title Arena
/// @notice Entrypoint for PVE / PVP battles. Runs `BattleEngine.simulate` and
///         persists the report (both as storage + event emission).
/// @dev Per-player nonce is used for EIP-712 relays; regular calls do NOT
///      consume nonce to keep wallet UX simple.
///
/// Deployment note:
///   Constructor makes `msg.sender` the Ownable owner. After deploying Arena,
///   remember to call `HeroNFT.setGameAuthority(arenaAddr)` from the HeroNFT
///   owner so Arena can mutate wound / cooldown / skill state on battle
///   settlement. Missing this step makes `completeStage` / wound writes revert.
contract Arena is EIP712, ReentrancyGuard, Ownable {
    using BattleEngine for Types.Hero[3];

    // ---------------------------------------------------------------------
    // EIP-712 typehashes
    // ---------------------------------------------------------------------

    /// @dev keccak256("Challenge(address attacker,address defender,uint64 nonce,uint256 deadline)")
    bytes32 public constant CHALLENGE_TYPEHASH = keccak256(
        "Challenge(address attacker,address defender,uint64 nonce,uint256 deadline)"
    );

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    HeroNFT public immutable heroNft;

    /// @notice Per-player signing nonce (incremented on successful relay).
    mapping(address => uint64) public playerNonce;

    /// @notice Player defense team (token ids). Zeroed means "not set".
    mapping(address => uint256[3]) private _defenseTeam;

    /// @notice Battle reports keyed by battleId.
    mapping(bytes32 => Types.BattleReport) private _reports;

    /// @notice Flat list of players who have set a defense team — used for `listArena`.
    address[] private _arenaRoster;
    mapping(address => bool) private _onRoster;

    /// @notice Monotonic counter used to derive battleId.
    uint256 public battleCounter;

    /// @notice Story-mode progress keyed by player.
    mapping(address => Types.StoryProgress) public playerProgress;

    /// @notice Optional delegate allowed to call `completeStage` alongside the owner
    ///         (e.g. a server-side settlement oracle). Zero means owner-only.
    address public gameAuthority;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event DefenseTeamSet(address indexed player, uint256[3] heroIds);
    event ChapterProgress(address indexed player, uint8 chapter, uint64 bossId);
    event GameAuthoritySet(address indexed authority);

    event BattleSettled(
        bytes32 indexed battleId,
        address indexed attacker,
        address indexed defender, // address(0) for PVE
        uint8 winner,
        uint8 totalRounds,
        uint64 timestamp
    );

    event PveStarted(
        bytes32 indexed battleId,
        address indexed attacker,
        uint8 stageId
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(HeroNFT heroNft_)
        EIP712("JianghuArena", "1")
        Ownable(msg.sender)
    {
        heroNft = heroNft_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Point at a non-owner address allowed to call `completeStage`.
    ///         Paymaster-safe (no msg.value).
    function setGameAuthority(address authority) external onlyOwner {
        gameAuthority = authority;
        emit GameAuthoritySet(authority);
    }

    modifier onlyGame() {
        require(
            msg.sender == owner() || (gameAuthority != address(0) && msg.sender == gameAuthority),
            "Arena: not game authority"
        );
        _;
    }

    // ---------------------------------------------------------------------
    // Defense team
    // ---------------------------------------------------------------------

    /// @notice Configure the three-hero lineup that defends when someone challenges you.
    /// @dev Caller must own all three heroes.
    function setDefenseTeam(uint256[3] calldata heroIds) external {
        _requireOwns(msg.sender, heroIds);
        _defenseTeam[msg.sender] = heroIds;
        if (!_onRoster[msg.sender]) {
            _onRoster[msg.sender] = true;
            _arenaRoster.push(msg.sender);
        }
        emit DefenseTeamSet(msg.sender, heroIds);
    }

    function getDefenseTeam(address player) external view returns (uint256[3] memory) {
        return _defenseTeam[player];
    }

    // ---------------------------------------------------------------------
    // PVE
    // ---------------------------------------------------------------------

    /// @notice Challenge a hard-coded PVE stage boss.
    /// @param heroIds   Attacker lineup (must be owned by msg.sender).
    /// @param stageId   1..N. MVP supports stage 1 only.
    function startPve(uint256[3] calldata heroIds, uint8 stageId)
        external
        nonReentrant
        returns (bytes32 battleId)
    {
        _requireOwns(msg.sender, heroIds);

        Types.Hero[3] memory attackerTeam = heroNft.getTeam(heroIds);
        Types.Hero[3] memory bossTeam = _bossTeam(stageId);

        battleId = _deriveBattleId(msg.sender, address(0));
        emit PveStarted(battleId, msg.sender, stageId);

        _runAndStore(battleId, msg.sender, address(0), attackerTeam, bossTeam);
    }

    // ---------------------------------------------------------------------
    // PVP
    // ---------------------------------------------------------------------

    /// @notice Challenge another player's defense team. Attacker uses their own defense team.
    /// @dev MVP: attacker lineup = their own stored defense team. Alternative would be
    ///      explicit `heroIds` param. Keeping UX simple for the hackathon demo.
    function challenge(address defender)
        external
        nonReentrant
        returns (bytes32 battleId)
    {
        battleId = _challenge(msg.sender, defender);
    }

    /// @notice Relay variant: `attackerSig` allows a third party to pay gas on attacker's behalf.
    ///         Signer is recovered from EIP-712; defender sig NOT required (defender's team is public).
    function challengeRelay(
        address attacker,
        address defender,
        uint256 deadline,
        bytes calldata attackerSig
    ) external nonReentrant returns (bytes32 battleId) {
        require(block.timestamp <= deadline, "Arena: sig expired");
        uint64 nonce = playerNonce[attacker];

        bytes32 structHash = keccak256(abi.encode(
            CHALLENGE_TYPEHASH,
            attacker,
            defender,
            nonce,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, attackerSig);
        require(signer == attacker, "Arena: bad signature");

        playerNonce[attacker] = nonce + 1;
        battleId = _challenge(attacker, defender);
    }

    function _challenge(address attacker, address defender) internal returns (bytes32 battleId) {
        require(defender != attacker, "Arena: self-challenge");
        uint256[3] memory attackerIds = _defenseTeam[attacker];
        uint256[3] memory defenderIds = _defenseTeam[defender];
        require(_teamSet(attackerIds), "Arena: attacker no team");
        require(_teamSet(defenderIds), "Arena: defender no team");

        Types.Hero[3] memory attackerTeam = heroNft.getTeam(attackerIds);
        Types.Hero[3] memory defenderTeam = heroNft.getTeam(defenderIds);

        battleId = _deriveBattleId(attacker, defender);
        _runAndStore(battleId, attacker, defender, attackerTeam, defenderTeam);
    }

    // ---------------------------------------------------------------------
    // Read
    // ---------------------------------------------------------------------

    function getBattleReport(bytes32 battleId)
        external
        view
        returns (Types.BattleReport memory)
    {
        Types.BattleReport storage r = _reports[battleId];
        require(r.battleId != bytes32(0), "Arena: unknown battle");
        return r;
    }

    /// @notice Paginated arena roster. Power is sum of HP of defense team.
    function listArena(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory players, uint256[] memory powers)
    {
        uint256 total = _arenaRoster.length;
        if (offset >= total) {
            return (new address[](0), new uint256[](0));
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 len = end - offset;

        players = new address[](len);
        powers  = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            address p = _arenaRoster[offset + i];
            players[i] = p;
            powers[i]  = _powerOf(p);
        }
    }

    function arenaSize() external view returns (uint256) {
        return _arenaRoster.length;
    }

    /// @notice Expose the EIP-712 domain separator for client signing.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _requireOwns(address who, uint256[3] calldata ids) internal view {
        for (uint8 i = 0; i < 3; i++) {
            require(heroNft.ownerOf(ids[i]) == who, "Arena: not owner");
        }
    }

    function _teamSet(uint256[3] memory ids) internal pure returns (bool) {
        return ids[0] != 0 && ids[1] != 0 && ids[2] != 0;
    }

    function _deriveBattleId(address attacker, address defender) internal returns (bytes32) {
        battleCounter += 1;
        return keccak256(abi.encode(
            block.chainid,
            address(this),
            attacker,
            defender,
            battleCounter,
            block.number
        ));
    }

    function _runAndStore(
        bytes32 battleId,
        address attacker,
        address defender,
        Types.Hero[3] memory attackerTeam,
        Types.Hero[3] memory defenderTeam
    ) internal {
        uint256 seed = uint256(keccak256(abi.encode(block.prevrandao, battleId)));

        (uint8 winner, Types.BattleEvent[] memory events) =
            BattleEngine.simulate(attackerTeam, defenderTeam, seed);

        uint8 totalRounds = events.length == 0 ? 0 : events[events.length - 1].round;

        // Persist to storage (full detail) + emit the canonical event (indexer hook).
        Types.BattleReport storage r = _reports[battleId];
        r.battleId    = battleId;
        r.attacker    = attacker;
        r.defender    = defender;
        r.winner      = winner;
        r.totalRounds = totalRounds;
        r.timestamp   = uint64(block.timestamp);
        for (uint256 i = 0; i < 3; i++) {
            r.attackerTeam[i] = attackerTeam[i];
            r.defenderTeam[i] = defenderTeam[i];
        }
        for (uint256 i = 0; i < events.length; i++) {
            r.events.push(events[i]);
        }

        emit BattleSettled(battleId, attacker, defender, winner, totalRounds, uint64(block.timestamp));
    }

    function _powerOf(address player) internal view returns (uint256 power) {
        uint256[3] memory ids = _defenseTeam[player];
        if (ids[0] == 0) return 0;
        Types.Hero[3] memory team = heroNft.getTeam(ids);
        unchecked {
            for (uint8 i = 0; i < 3; i++) {
                power += uint256(team[i].hp)
                       + uint256(team[i].atk) * 2
                       + uint256(team[i].def)
                       + uint256(team[i].spd);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Story progress
    // ---------------------------------------------------------------------

    /// @notice擂台 BOSS id 起点 — ids at/above this grant a first-clear mint.
    /// @dev Must match `HeroNFT.BOSS_ARENA_THRESHOLD`.
    uint8 public constant BOSS_ARENA_THRESHOLD = 5;

    /// @notice First-clear ledger mirror. `true` once `grantBossMint` has fired
    ///         for this (player, bossId) pair — prevents duplicate rewards even
    ///         if an operator replays `completeStage`.
    mapping(address => mapping(uint8 => bool)) public bossFirstCleared;

    event BossFirstCleared(address indexed player, uint8 bossId);

    /// @notice Record a stage clear for `player`. Owner / authority only.
    /// @dev Packs bossId + block timestamp into a single uint64:
    ///      (bossId << 56) | (timestamp & 0x00FFFFFFFFFFFFFF).
    ///      Not payable — Paymaster-safe.
    function completeStage(address player, uint8 bossId) external onlyGame {
        require(player != address(0), "Arena: zero player");
        Types.StoryProgress storage p = playerProgress[player];

        uint64 ts = uint64(block.timestamp) & 0x00FFFFFFFFFFFFFF;
        uint64 packed = (uint64(bossId) << 56) | ts;
        p.bossDefeated.push(packed);

        if (bossId > p.currentChapter) {
            p.currentChapter = bossId;
        }
        p.totalExp += uint256(bossId) * 100;

        emit ChapterProgress(player, p.currentChapter, uint64(bossId));

        // Gacha economy: credit a free mint on first擂台 BOSS clear.
        if (bossId >= BOSS_ARENA_THRESHOLD && !bossFirstCleared[player][bossId]) {
            bossFirstCleared[player][bossId] = true;
            emit BossFirstCleared(player, bossId);
            heroNft.grantBossMint(player, bossId);
        }
    }

    /// @notice Return the full story-progress record for a player.
    function getStoryProgress(address player)
        external
        view
        returns (Types.StoryProgress memory)
    {
        return playerProgress[player];
    }

    // ---------------------------------------------------------------------
    // PVE boss table
    // ---------------------------------------------------------------------

    /// @dev Hard-coded single-stage boss team (Wudang flavor). Hackathon-simple.
    function _bossTeam(uint8 stageId) internal pure returns (Types.Hero[3] memory team) {
        require(stageId == 1, "Arena: unknown stage");

        // Stage 1 — 武当藏经阁:高 DEF 低输出三人组
        team[0] = _bossHero(1001, Types.Sect.Shaolin, 200, 80, 100, 60, 500,  0, 1, 2);
        team[1] = _bossHero(1002, Types.Sect.Tangmen, 130, 95, 50,  95, 2000, 3, 4, 5);
        team[2] = _bossHero(1003, Types.Sect.Emei,    160, 75, 70,  85, 1000, 6, 7, 8);
    }

    function _bossHero(
        uint256 tokenId,
        Types.Sect sect,
        uint16 hp, uint16 atk, uint16 def, uint16 spd, uint16 crit,
        uint8 s1, uint8 s2, uint8 s3
    ) internal pure returns (Types.Hero memory h) {
        uint8[] memory skills = new uint8[](3);
        skills[0] = s1; skills[1] = s2; skills[2] = s3;
        h = Types.Hero({
            tokenId: tokenId,
            sect:    sect,
            hp:      hp,
            atk:     atk,
            def:     def,
            spd:     spd,
            crit:    crit,
            skillIds: skills
        });
    }
}
