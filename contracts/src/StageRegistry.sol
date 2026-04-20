// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

/// @title StageRegistry
/// @notice On-chain content registry for PVE stages. Adding a new boss fight
///         after launch = 1 transaction to `addStage` instead of a contract
///         redeploy. Matches the pattern in docs/CONTENT_UPDATES.md §1.1.
/// @dev Read-path is side-effect free so Arena can call it from within a
///      nonReentrant PVE entrypoint. Owner + curator split keeps daily content
///      ops off the cold vault key.
contract StageRegistry {
    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Stage {
        uint8           stageId;     // 1..255 (0 reserved = "unregistered")
        uint8           chapter;     // 1..3 today; room to grow
        bytes32         nameHash;    // keccak256(utf8 name) — canonical UI key
        string          flavorText;  // Short pre-battle narration (<= 280 chars recommended)
        uint32          minReputation; // Soft gate. 0 = no prereq.
        Types.Hero[3]   bossTeam;
        bool            exists;
    }

    mapping(uint8 => Stage) private _stages;
    uint8[] private _registered;

    address public owner;
    address public contentCurator;

    event StageRegistered(uint8 indexed stageId, uint8 chapter, bytes32 nameHash);
    event StageUpdated(uint8 indexed stageId);
    event CuratorSet(address indexed curator);

    modifier onlyRegistrar() {
        require(
            msg.sender == owner || (contentCurator != address(0) && msg.sender == contentCurator),
            "StageRegistry: not registrar"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setCurator(address c) external {
        require(msg.sender == owner, "StageRegistry: not owner");
        contentCurator = c;
        emit CuratorSet(c);
    }

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /// @notice Register a brand-new stage. Reverts if the id already exists.
    function addStage(
        uint8 stageId,
        uint8 chapter,
        bytes32 nameHash,
        string calldata flavorText,
        uint32 minReputation,
        Types.Hero[3] calldata bossTeam
    ) external onlyRegistrar {
        require(stageId != 0, "StageRegistry: stageId 0 reserved");
        Stage storage s = _stages[stageId];
        require(!s.exists, "StageRegistry: already exists");

        s.stageId      = stageId;
        s.chapter      = chapter;
        s.nameHash     = nameHash;
        s.flavorText   = flavorText;
        s.minReputation = minReputation;
        s.bossTeam[0]  = bossTeam[0];
        s.bossTeam[1]  = bossTeam[1];
        s.bossTeam[2]  = bossTeam[2];
        s.exists       = true;
        _registered.push(stageId);

        emit StageRegistered(stageId, chapter, nameHash);
    }

    /// @notice Patch an existing stage (flavor + team tuning). Use sparingly —
    ///         indexers + screenshots are cached against `nameHash`.
    function updateStage(
        uint8 stageId,
        uint32 minReputation,
        string calldata flavorText,
        Types.Hero[3] calldata bossTeam
    ) external onlyRegistrar {
        Stage storage s = _stages[stageId];
        require(s.exists, "StageRegistry: unknown stage");
        s.minReputation = minReputation;
        s.flavorText    = flavorText;
        s.bossTeam[0]   = bossTeam[0];
        s.bossTeam[1]   = bossTeam[1];
        s.bossTeam[2]   = bossTeam[2];
        emit StageUpdated(stageId);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    function getStage(uint8 stageId)
        external
        view
        returns (
            uint8 chapter,
            bytes32 nameHash,
            string memory flavorText,
            uint32 minReputation,
            Types.Hero[3] memory bossTeam
        )
    {
        Stage storage s = _stages[stageId];
        require(s.exists, "StageRegistry: unknown stage");
        return (s.chapter, s.nameHash, s.flavorText, s.minReputation, s.bossTeam);
    }

    /// @notice Pre-baked accessor for Arena — returns only the boss team.
    function getBossTeam(uint8 stageId) external view returns (Types.Hero[3] memory team) {
        Stage storage s = _stages[stageId];
        require(s.exists, "StageRegistry: unknown stage");
        team = s.bossTeam;
    }

    function exists(uint8 stageId) external view returns (bool) {
        return _stages[stageId].exists;
    }

    function listStageIds() external view returns (uint8[] memory) {
        return _registered;
    }

    function stageCount() external view returns (uint256) {
        return _registered.length;
    }
}
