// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA}  from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {Types}         from "./Types.sol";
import {BattleEngine}  from "./BattleEngine.sol";
import {HeroNFT}       from "./HeroNFT.sol";
import {StageRegistry} from "./StageRegistry.sol";

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
    StageRegistry public immutable stageRegistry;

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

    /// @notice Full round-by-round event stream. Not indexed to save log gas;
    ///         clients replay by (attackerTeam, defenderTeam, seed) off-chain
    ///         and use this event as ground-truth verification.
    event BattleLog(
        bytes32 indexed battleId,
        uint256 seed,
        Types.BattleEvent[] events
    );

    event PveStarted(
        bytes32 indexed battleId,
        address indexed attacker,
        uint8 stageId
    );

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(HeroNFT heroNft_, StageRegistry stageRegistry_)
        EIP712("XiakeArena", "1")
        Ownable(msg.sender)
    {
        require(address(stageRegistry_) != address(0), "Arena: zero stage registry");
        heroNft = heroNft_;
        stageRegistry = stageRegistry_;
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
        _requireAvailable(heroIds);
        _requireRepMeetsStage(msg.sender, stageId);

        Types.Hero[3] memory attackerTeam = heroNft.getTeam(heroIds);
        Types.Hero[3] memory bossTeam = _bossTeam(stageId);

        battleId = _deriveBattleId(msg.sender, address(0));
        emit PveStarted(battleId, msg.sender, stageId);

        // _runAndStore returns the winner so we can apply wounds on loss.
        uint8 winner = _runAndStore(battleId, msg.sender, address(0), attackerTeam, bossTeam);

        if (winner == 0) {
            // Victory — advance chapter progress + totalExp, and fire the
            // boss-mint reward if this is a擂台 BOSS first-clear. Mirror of
            // the admin-only `completeStage` logic (kept around for operators).
            _registerClear(msg.sender, stageId);
        } else if (winner == 1) {
            // Defeat — wound the attacker's lineup for the 12h cooldown window.
            _woundTeam(heroIds, 1);
        }
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
        _requireAvailable(attackerIds);
        // Defender availability is NOT enforced — a player shouldn't be able to
        // dodge challenges by wounding their own team. Defender losses still
        // apply wounds so dodge-farming has a cost.

        Types.Hero[3] memory attackerTeam = heroNft.getTeam(attackerIds);
        Types.Hero[3] memory defenderTeam = heroNft.getTeam(defenderIds);

        battleId = _deriveBattleId(attacker, defender);
        uint8 winner = _runAndStore(battleId, attacker, defender, attackerTeam, defenderTeam);

        // Loser gets wound level 1 (12h cooldown). Draw = no wound.
        if (winner == 0) {
            _woundTeam(defenderIds, 1);
        } else if (winner == 1) {
            _woundTeam(attackerIds, 1);
        }
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
    ) internal returns (uint8 winner) {
        uint256 seed = uint256(keccak256(abi.encode(block.prevrandao, battleId)));

        Types.BattleEvent[] memory events;
        (winner, events) =
            BattleEngine.simulate(attackerTeam, defenderTeam, seed);

        uint8 totalRounds = events.length == 0 ? 0 : events[events.length - 1].round;

        // Persist summary to storage. Full event log goes into the `BattleLog`
        // event — clients replay from (teams, seed) for exact reconstruction.
        // This cuts per-battle gas by ~1-2M by removing N × SSTORE on the
        // events array.
        Types.BattleReport storage r = _reports[battleId];
        r.battleId    = battleId;
        r.attacker    = attacker;
        r.defender    = defender;
        r.winner      = winner;
        r.totalRounds = totalRounds;
        r.timestamp   = uint64(block.timestamp);
        r.seed        = seed;
        for (uint256 i = 0; i < 3; i++) {
            r.attackerTeam[i] = attackerTeam[i];
            r.defenderTeam[i] = defenderTeam[i];
        }

        emit BattleSettled(battleId, attacker, defender, winner, totalRounds, uint64(block.timestamp));
        emit BattleLog(battleId, seed, events);
    }

    // ---------------------------------------------------------------------
    // Wound / availability
    // ---------------------------------------------------------------------

    function _requireAvailable(uint256[3] memory ids) internal view {
        for (uint8 i = 0; i < 3; i++) {
            require(heroNft.isAvailable(ids[i]), "Arena: hero injured");
        }
    }

    /// @dev Enforce the stage's `minReputation` gate. We use `totalExp` as
    ///      reputation (100 exp per cleared stage, stageId-scaled in
    ///      `_registerClear`). Stages registered before this check landed on
    ///      chain (minReputation defaults to 0) remain freely playable.
    function _requireRepMeetsStage(address player, uint8 stageId) internal view {
        (, , , uint32 minRep, ) = _stageHeader(stageId);
        if (minRep == 0) return;
        require(
            playerProgress[player].totalExp >= uint256(minRep),
            "Arena: reputation too low"
        );
    }

    /// @dev Read the stage header tuple from the registry. Peeled out of
    ///      `_requireRepMeetsStage` so the ABI decode is localised and the
    ///      compiler can keep stack depth under control.
    function _stageHeader(uint8 stageId)
        internal
        view
        returns (uint8 chapter, bytes32 nameHash, string memory flavor, uint32 minRep, Types.Hero[3] memory bossTeam)
    {
        (chapter, nameHash, flavor, minRep, bossTeam) = stageRegistry.getStage(stageId);
    }

    /// @dev Call HeroNFT.setWound for each id. HeroNFT is gated to Arena —
    ///      relies on `setArena(arenaAddr)` being wired post-deploy.
    function _woundTeam(uint256[3] memory ids, uint8 woundLevel) internal {
        for (uint8 i = 0; i < 3; i++) {
            heroNft.setWound(ids[i], woundLevel);
        }
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

    /// @notice 擂台 BOSS id 起点 — ids at/above this grant a first-clear mint.
    /// @dev Must match `HeroNFT.BOSS_ARENA_THRESHOLD`.
    uint8 public constant BOSS_ARENA_THRESHOLD = 5;

    /// @notice First-clear ledger mirror. `true` once `grantBossMint` has fired
    ///         for this (player, bossId) pair — prevents duplicate rewards even
    ///         if an operator replays `completeStage`.
    mapping(address => mapping(uint8 => bool)) public bossFirstCleared;

    event BossFirstCleared(address indexed player, uint8 bossId);

    /// @notice Minimum chapter a player must have cleared before they can
    ///         unlock extra skills on their heroes (PRD §习得技能).
    uint8 public constant SKILL_LEARN_MILESTONE = 3;

    event SkillLearned(address indexed player, uint256 indexed tokenId, uint8 skillId);

    /// @notice Teach an additional skill to a hero owned by the caller. The
    ///         hero must already belong to msg.sender and the player must have
    ///         cleared at least SKILL_LEARN_MILESTONE story chapters. The skill
    ///         is appended to HeroNFT's `_unlockedSkills` list so the CLI can
    ///         equip it into one of the three active slots via `equip`.
    function learnSkill(uint256 tokenId, uint8 skillId) external {
        require(heroNft.ownerOf(tokenId) == msg.sender, "Arena: not hero owner");
        require(
            playerProgress[msg.sender].currentChapter >= SKILL_LEARN_MILESTONE,
            "Arena: milestone not met"
        );
        heroNft.unlockSkill(tokenId, skillId);
        emit SkillLearned(msg.sender, tokenId, skillId);
    }

    /// @notice Record a stage clear for `player`. Owner / authority only —
    ///         retained as an escape hatch for admin correction. The normal
    ///         path is automatic: `startPve` on winner==0 calls `_registerClear`
    ///         itself so players get story progress without an oracle.
    /// @dev Packs bossId + block timestamp into a single uint64:
    ///      (bossId << 56) | (timestamp & 0x00FFFFFFFFFFFFFF).
    function completeStage(address player, uint8 bossId) external onlyGame {
        require(player != address(0), "Arena: zero player");
        _registerClear(player, bossId);
    }

    /// @dev Internal clear-ledger update. Called both by the admin
    ///      `completeStage` hook and by `startPve` on victory. Idempotent
    ///      per (player, bossId) for the BOSS-mint reward; stage clears
    ///      themselves can legitimately repeat (grinding a stage for XP).
    function _registerClear(address player, uint8 bossId) internal {
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
    // PVE boss table — delegated to on-chain registry so new stages can be
    // added without redeploying Arena. See docs/CONTENT_UPDATES.md §1.1.
    // ---------------------------------------------------------------------

    function _bossTeam(uint8 stageId) internal view returns (Types.Hero[3] memory team) {
        require(stageRegistry.exists(stageId), "Arena: unknown stage");
        team = stageRegistry.getBossTeam(stageId);
    }
}
