// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

/// @title SkillRegistry
/// @notice Hard-coded metadata for the 21 baseline skills (7 sects × 3 skills).
///         Skill ids 0..8 are the MVP three-sect skills (kept frozen).
///         Skill ids 9..20 cover the four added sects (Wudang / Beggars /
///         Huashan / Ming).
/// @dev BattleEngine reads skill metadata via the `SkillBook` library at the
///      bottom of this file so `simulate()` stays `pure`. The deployed
///      `SkillRegistry` contract is for off-chain clients (CLI, dashboards,
///      indexers) that prefer an RPC read.
///
///      Future admin-added skills (id >= SKILL_COUNT) live in `_extended` and
///      are readable via `getSkill()` but **cannot be used in battle** until a
///      library upgrade is deployed. See docs/CONTENT_UPDATES.md §1.2.
contract SkillRegistry {
    using Types for Types.Skill;

    // ---------------------------------------------------------------------
    // Skill id layout (hardcoded, battle-ready):
    //   0  少林·金钟罩    (Buff)                 3  唐门·穿心刺      (Damage)
    //   1  少林·易筋经    (Heal)                 4  唐门·暗器急雨    (Damage AoE)
    //   2  少林·狮子吼    (Control AoE)          5  唐门·毒针        (Dot)
    //   6  峨眉·慈航普渡  (Heal AoE)             7  峨眉·净心咒      (Buff cleanse)
    //   8  峨眉·般若掌    (Damage + Control)
    //   9  武当·太极推手  (Buff, +DEF)           10 武当·梯云纵      (Buff, +SPD)
    //  11  武当·真武破军  (Damage, counter)
    //  12  丐帮·降龙十八掌(Damage single big)    13 丐帮·打狗棒法    (Control + Damage)
    //  14  丐帮·醉八仙    (Buff self)
    //  15  华山·独孤九剑  (Damage high-crit)     16 华山·紫霞神功    (Heal + Buff)
    //  17  华山·华山群剑  (Damage AoE)
    //  18  明教·圣火令    (Damage break-armor)   19 明教·乾坤大挪移  (Buff, redirect-style)
    //  20  明教·毒沙掌    (Dot AoE)
    // ---------------------------------------------------------------------
    uint8 public constant SKILL_COUNT = 21;

    /// @notice Admin-added skill metadata. Ids must be >= SKILL_COUNT to avoid
    ///         clobbering battle-ready skills. Currently display-only.
    mapping(uint8 => Types.Skill) private _extended;
    mapping(uint8 => string) private _extendedNames;
    mapping(uint8 => bool)   private _extendedExists;

    address public owner;
    address public contentCurator;

    event SkillAdded(uint8 indexed skillId, string name, Types.SkillKind kind);
    event CuratorSet(address indexed curator);

    modifier onlyRegistrar() {
        require(
            msg.sender == owner || (contentCurator != address(0) && msg.sender == contentCurator),
            "SkillRegistry: not registrar"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setCurator(address c) external {
        require(msg.sender == owner, "SkillRegistry: not owner");
        contentCurator = c;
        emit CuratorSet(c);
    }

    /// @notice Register a skill metadata entry at id >= SKILL_COUNT. Cannot
    ///         overwrite battle-ready skills 0..20. Purely display-only until
    ///         the BattleEngine library is upgraded to recognise the new id.
    function addSkill(uint8 skillId, Types.Skill calldata skill, string calldata name)
        external
        onlyRegistrar
    {
        require(skillId >= SKILL_COUNT, "SkillRegistry: reserved id");
        require(!_extendedExists[skillId], "SkillRegistry: exists");
        _extended[skillId]        = skill;
        _extendedNames[skillId]   = name;
        _extendedExists[skillId]  = true;
        emit SkillAdded(skillId, name, skill.kind);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice Full Skill record for a skill id (battle-ready or admin-added).
    function getSkill(uint8 skillId) external view returns (Types.Skill memory) {
        if (skillId < SKILL_COUNT) return _skill(skillId);
        require(_extendedExists[skillId], "SkillRegistry: unknown skill");
        return _extended[skillId];
    }

    /// @notice Base-3 skill ids for each sect. Length always 3. Extra skills
    ///         unlocked through gameplay are stored on HeroNFT._unlockedSkills.
    function sectSkills(Types.Sect sect) external pure returns (uint8[3] memory ids) {
        if (sect == Types.Sect.Shaolin) return [uint8(0),  uint8(1),  uint8(2)];
        if (sect == Types.Sect.Tangmen) return [uint8(3),  uint8(4),  uint8(5)];
        if (sect == Types.Sect.Emei)    return [uint8(6),  uint8(7),  uint8(8)];
        if (sect == Types.Sect.Wudang)  return [uint8(9),  uint8(10), uint8(11)];
        if (sect == Types.Sect.Beggars) return [uint8(12), uint8(13), uint8(14)];
        if (sect == Types.Sect.Huashan) return [uint8(15), uint8(16), uint8(17)];
        if (sect == Types.Sect.Ming)    return [uint8(18), uint8(19), uint8(20)];
        revert("SkillRegistry: bad sect");
    }

    /// @notice Human-readable skill name (utf-8 bytes).
    function skillName(uint8 skillId) external view returns (string memory) {
        if (skillId == 0)  return unicode"金钟罩";
        if (skillId == 1)  return unicode"易筋经";
        if (skillId == 2)  return unicode"狮子吼";
        if (skillId == 3)  return unicode"穿心刺";
        if (skillId == 4)  return unicode"暗器急雨";
        if (skillId == 5)  return unicode"毒针";
        if (skillId == 6)  return unicode"慈航普渡";
        if (skillId == 7)  return unicode"净心咒";
        if (skillId == 8)  return unicode"般若掌";
        if (skillId == 9)  return unicode"太极推手";
        if (skillId == 10) return unicode"梯云纵";
        if (skillId == 11) return unicode"真武破军";
        if (skillId == 12) return unicode"降龙十八掌";
        if (skillId == 13) return unicode"打狗棒法";
        if (skillId == 14) return unicode"醉八仙";
        if (skillId == 15) return unicode"独孤九剑";
        if (skillId == 16) return unicode"紫霞神功";
        if (skillId == 17) return unicode"华山群剑";
        if (skillId == 18) return unicode"圣火令";
        if (skillId == 19) return unicode"乾坤大挪移";
        if (skillId == 20) return unicode"毒沙掌";
        require(_extendedExists[skillId], "SkillRegistry: unknown skill");
        return _extendedNames[skillId];
    }

    // ---------------------------------------------------------------------
    // Internal: pure resolver shared with the library mirror below.
    // ---------------------------------------------------------------------

    function _skill(uint8 skillId) internal pure returns (Types.Skill memory s) {
        return SkillBook.get(skillId);
    }
}

/// @notice Pure library variant that BattleEngine uses directly (no external
///         call). Metadata here MUST stay in sync with `SkillRegistry.skillName`
///         and the same skill ids.
library SkillBook {
    function get(uint8 skillId) internal pure returns (Types.Skill memory s) {
        // ─── Shaolin (0..2) ───────────────────────────────────────────────
        if (skillId == 0) {
            s.kind = Types.SkillKind.Buff;       s.multiplier = 3000;  s.duration = 2;
            s.nameHash = keccak256(bytes(unicode"金钟罩"));     s.aoe = false; return s;
        }
        if (skillId == 1) {
            s.kind = Types.SkillKind.Heal;       s.multiplier = 3000;  s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"易筋经"));     s.aoe = false; return s;
        }
        if (skillId == 2) {
            s.kind = Types.SkillKind.Control;    s.multiplier = 0;     s.duration = 1;
            s.nameHash = keccak256(bytes(unicode"狮子吼"));     s.aoe = true;  return s;
        }
        // ─── Tangmen (3..5) ───────────────────────────────────────────────
        if (skillId == 3) {
            s.kind = Types.SkillKind.Damage;     s.multiplier = 15000; s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"穿心刺"));     s.aoe = false; return s;
        }
        if (skillId == 4) {
            s.kind = Types.SkillKind.Damage;     s.multiplier = 8000;  s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"暗器急雨"));   s.aoe = true;  return s;
        }
        if (skillId == 5) {
            s.kind = Types.SkillKind.Dot;        s.multiplier = 1000;  s.duration = 3;
            s.nameHash = keccak256(bytes(unicode"毒针"));       s.aoe = false; return s;
        }
        // ─── Emei (6..8) ──────────────────────────────────────────────────
        if (skillId == 6) {
            s.kind = Types.SkillKind.Heal;       s.multiplier = 2000;  s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"慈航普渡"));   s.aoe = true;  return s;
        }
        if (skillId == 7) {
            s.kind = Types.SkillKind.Buff;       s.multiplier = 0;     s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"净心咒"));     s.aoe = true;  return s;
        }
        if (skillId == 8) {
            s.kind = Types.SkillKind.Damage;     s.multiplier = 12000; s.duration = 1;
            s.nameHash = keccak256(bytes(unicode"般若掌"));     s.aoe = false; return s;
        }
        // ─── Wudang (9..11): 均衡 / 反制 ──────────────────────────────────
        if (skillId == 9) {
            // 太极推手 — self-buff +40% DEF for 3 rounds
            s.kind = Types.SkillKind.Buff;       s.multiplier = 4000;  s.duration = 3;
            s.nameHash = keccak256(bytes(unicode"太极推手"));   s.aoe = false; return s;
        }
        if (skillId == 10) {
            // 梯云纵 — self-buff +50% SPD for 2 rounds (treated as Buff SPD)
            s.kind = Types.SkillKind.Buff;       s.multiplier = 5000;  s.duration = 2;
            s.nameHash = keccak256(bytes(unicode"梯云纵"));     s.aoe = false; return s;
        }
        if (skillId == 11) {
            // 真武破军 — single target 140% ATK damage
            s.kind = Types.SkillKind.Damage;     s.multiplier = 14000; s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"真武破军"));   s.aoe = false; return s;
        }
        // ─── Beggars (12..14): 控场 / buff ────────────────────────────────
        if (skillId == 12) {
            // 降龙十八掌 — single target 170% ATK (signature heavy hit)
            s.kind = Types.SkillKind.Damage;     s.multiplier = 17000; s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"降龙十八掌")); s.aoe = false; return s;
        }
        if (skillId == 13) {
            // 打狗棒法 — 90% ATK + silence 1 round
            s.kind = Types.SkillKind.Damage;     s.multiplier = 9000;  s.duration = 1;
            s.nameHash = keccak256(bytes(unicode"打狗棒法"));   s.aoe = false; return s;
        }
        if (skillId == 14) {
            // 醉八仙 — party buff +25% ATK for 2 rounds
            s.kind = Types.SkillKind.Buff;       s.multiplier = 2500;  s.duration = 2;
            s.nameHash = keccak256(bytes(unicode"醉八仙"));     s.aoe = true;  return s;
        }
        // ─── Huashan (15..17): 剑术 / 高暴击 ──────────────────────────────
        if (skillId == 15) {
            // 独孤九剑 — 160% ATK with implicit high-crit bias
            s.kind = Types.SkillKind.Damage;     s.multiplier = 16000; s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"独孤九剑"));   s.aoe = false; return s;
        }
        if (skillId == 16) {
            // 紫霞神功 — ally heal 25% maxHp + self buff
            s.kind = Types.SkillKind.Heal;       s.multiplier = 2500;  s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"紫霞神功"));   s.aoe = false; return s;
        }
        if (skillId == 17) {
            // 华山群剑 — AoE 95% ATK
            s.kind = Types.SkillKind.Damage;     s.multiplier = 9500;  s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"华山群剑"));   s.aoe = true;  return s;
        }
        // ─── Ming (18..20): 毒 DOT / 破防 ─────────────────────────────────
        if (skillId == 18) {
            // 圣火令 — single target 130% ATK (ignores 30% DEF, handled in engine)
            s.kind = Types.SkillKind.Damage;     s.multiplier = 13000; s.duration = 0;
            s.nameHash = keccak256(bytes(unicode"圣火令"));     s.aoe = false; return s;
        }
        if (skillId == 19) {
            // 乾坤大挪移 — self buff +50% crit chance for 2 rounds
            s.kind = Types.SkillKind.Buff;       s.multiplier = 5000;  s.duration = 2;
            s.nameHash = keccak256(bytes(unicode"乾坤大挪移")); s.aoe = false; return s;
        }
        if (skillId == 20) {
            // 毒沙掌 — AoE Dot 8% maxHp for 3 rounds
            s.kind = Types.SkillKind.Dot;        s.multiplier = 800;   s.duration = 3;
            s.nameHash = keccak256(bytes(unicode"毒沙掌"));     s.aoe = true;  return s;
        }
        revert("SkillBook: unknown skill");
    }
}
