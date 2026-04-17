// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Jianghu shared types
/// @notice Enums / structs used across HeroNFT, SkillRegistry, BattleEngine and Arena.
/// @dev Shape kept in sync with `skill/src/types.ts` so the TypeScript skill can decode
///      ABI values without a separate schema.
library Types {
    // ---------------------------------------------------------------------
    // Enums
    // ---------------------------------------------------------------------

    /// @notice Three sects available in the MVP.
    ///         Ordering matters — used as array index in SkillRegistry.
    enum Sect {
        Shaolin, // 0  坦克 / 治疗
        Tangmen, // 1  刺客 / 爆发
        Emei     // 2  辅助 / 净化
    }

    /// @notice Skill effect categories. Extend here when adding new behaviours.
    enum SkillKind {
        Damage,  // 0  single- or multi-target HP reduction
        Heal,    // 1  HP restoration to allies
        Buff,    // 2  stat modifier on self/ally (DEF bump, etc.)
        Control, // 3  silence / stun the target for `duration` rounds
        Dot      // 4  damage-over-time (tick per round)
    }

    // ---------------------------------------------------------------------
    // Battle event flag bits (kept in sync with TS FLAG_* constants)
    // ---------------------------------------------------------------------
    uint8 internal constant FLAG_CRIT    = 1 << 0;
    uint8 internal constant FLAG_MISS    = 1 << 1;
    uint8 internal constant FLAG_KILL    = 1 << 2;
    uint8 internal constant FLAG_CONTROL = 1 << 3;
    uint8 internal constant FLAG_HEAL    = 1 << 4;
    uint8 internal constant FLAG_BUFF    = 1 << 5;
    uint8 internal constant FLAG_DOT     = 1 << 6;

    // ---------------------------------------------------------------------
    // Core structs
    // ---------------------------------------------------------------------

    /// @notice Immutable on-chain hero record. Stored in HeroNFT per tokenId.
    /// @dev `skillIds` must have length 3; enforced at mint time.
    struct Hero {
        uint256  tokenId;
        Sect     sect;
        uint16   hp;
        uint16   atk;
        uint16   def;
        uint16   spd;
        uint16   crit;      // basis points 0..10000 (30% = 3000)
        uint8[]  skillIds;  // length 3
    }

    /// @notice Skill metadata returned by SkillRegistry.
    ///         `multiplier` meaning depends on `kind`:
    ///           - Damage / Dot: % of attacker.ATK in basis points
    ///           - Heal:         % of target.maxHp in basis points
    ///           - Buff:         flat stat bump (DEF bps)
    ///           - Control:      unused (set 0)
    struct Skill {
        uint16    multiplier;
        SkillKind kind;
        uint8     duration;  // rounds; 0 for instantaneous
        bytes32   nameHash;  // keccak256(bytes("穿心刺")) etc.
        bool      aoe;       // true => hits all enemies / all allies
    }

    /// @notice Single turn event recorded in a battle report.
    /// @dev Packed as tightly as Solidity allows; >= 8 bytes per event on-chain.
    struct BattleEvent {
        uint8  round;
        uint8  actorIdx;   // 0..5, 0..2 = attacker side, 3..5 = defender side
        uint8  skillId;    // 0..8 (9 skills total)
        uint8  targetIdx;  // 0..5
        int16  hpDelta;    // negative for damage, positive for heal
        uint8  flags;      // FLAG_* bitfield
    }

    /// @notice Hero wound / cooldown record. Stored in HeroNFT per tokenId.
    ///         `cooldownUntil` is a unix timestamp; hero is unavailable while
    ///         `block.timestamp < cooldownUntil`.
    struct HeroHealth {
        uint8  woundLevel;      // 0 健康 / 1 轻伤 / 2 重伤
        uint64 cooldownUntil;   // unix ts
        uint8  potionCount;     // 金疮药库存 (v2)
    }

    /// @notice Player campaign progress. Stored in Arena per player.
    /// @dev `bossDefeated` entries are packed: (bossId << 56) | timestamp.
    struct StoryProgress {
        uint8    currentChapter;
        uint64[] bossDefeated;
        uint256  totalExp;
    }

    /// @notice Full battle report stored by Arena; replayable client-side.
    /// @dev Teams stored for replay so the skill doesn't need to re-query HeroNFT.
    struct BattleReport {
        bytes32        battleId;
        address        attacker;
        address        defender;   // address(0) for PVE
        uint8          winner;     // 0 = attacker, 1 = defender, 2 = draw
        uint8          totalRounds;
        uint64         timestamp;
        Hero[3]        attackerTeam;
        Hero[3]        defenderTeam;
        BattleEvent[]  events;
    }
}
