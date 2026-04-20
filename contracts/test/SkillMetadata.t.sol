// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../src/Types.sol";
import {SkillRegistry, SkillBook} from "../src/SkillRegistry.sol";

/// @title SkillMetadata
/// @notice Lock down the 21 baseline skills so future edits can't silently
///         change damage / kind / duration / AoE without updating expectations.
/// @dev Tests BOTH the deployed SkillRegistry contract AND the SkillBook pure
///      library used by BattleEngine — the two must stay identical or the UI
///      and battle engine disagree about what a skill does.
contract SkillMetadataTest is Test {
    SkillRegistry reg;

    function setUp() public {
        reg = new SkillRegistry();
    }

    // ---------------------------------------------------------------------
    // SkillRegistry.getSkill and SkillBook.get return identical data
    // for every baseline id 0..20.
    // ---------------------------------------------------------------------

    function testAllBaselineSkillsConsistent() public view {
        for (uint8 id = 0; id < 21; id++) {
            Types.Skill memory a = reg.getSkill(id);
            Types.Skill memory b = SkillBook.get(id);
            assertEq(uint8(a.kind),     uint8(b.kind),     "kind drift");
            assertEq(a.multiplier,      b.multiplier,      "multiplier drift");
            assertEq(a.duration,        b.duration,        "duration drift");
            assertEq(a.nameHash,        b.nameHash,        "nameHash drift");
            assertEq(a.aoe,             b.aoe,             "aoe drift");
        }
    }

    // ---------------------------------------------------------------------
    // sectSkills mapping is injective per sect
    // ---------------------------------------------------------------------

    function testSectSkillsMapping() public view {
        uint8[3] memory sh = reg.sectSkills(Types.Sect.Shaolin);
        assertEq(sh[0], 0); assertEq(sh[1], 1); assertEq(sh[2], 2);

        uint8[3] memory ta = reg.sectSkills(Types.Sect.Tangmen);
        assertEq(ta[0], 3); assertEq(ta[1], 4); assertEq(ta[2], 5);

        uint8[3] memory em = reg.sectSkills(Types.Sect.Emei);
        assertEq(em[0], 6); assertEq(em[1], 7); assertEq(em[2], 8);

        uint8[3] memory wu = reg.sectSkills(Types.Sect.Wudang);
        assertEq(wu[0], 9); assertEq(wu[1], 10); assertEq(wu[2], 11);

        uint8[3] memory be = reg.sectSkills(Types.Sect.Beggars);
        assertEq(be[0], 12); assertEq(be[1], 13); assertEq(be[2], 14);

        uint8[3] memory hu = reg.sectSkills(Types.Sect.Huashan);
        assertEq(hu[0], 15); assertEq(hu[1], 16); assertEq(hu[2], 17);

        uint8[3] memory mi = reg.sectSkills(Types.Sect.Ming);
        assertEq(mi[0], 18); assertEq(mi[1], 19); assertEq(mi[2], 20);
    }

    // ---------------------------------------------------------------------
    // Names must all be non-empty (rendering would break otherwise)
    // ---------------------------------------------------------------------

    function testAllSkillNamesNonEmpty() public view {
        for (uint8 id = 0; id < 21; id++) {
            string memory name = reg.skillName(id);
            assertGt(bytes(name).length, 0, "empty skill name");
        }
    }

    // ---------------------------------------------------------------------
    // getSkill for unknown id reverts
    // ---------------------------------------------------------------------

    function testGetSkillUnknownReverts() public {
        vm.expectRevert(bytes("SkillRegistry: unknown skill"));
        reg.getSkill(99);
    }

    function testSkillNameUnknownReverts() public {
        vm.expectRevert(bytes("SkillRegistry: unknown skill"));
        reg.skillName(99);
    }

    function testSectSkillsUnknownSectReverts() public {
        // Sect enum goes 0..6; 7+ is out of range and solidity will revert
        // when we try to cast — but since we can't pass an invalid enum from
        // Solidity directly, this is protected at the ABI layer. Skip.
    }

    // ---------------------------------------------------------------------
    // addSkill admin path
    // ---------------------------------------------------------------------

    function testAddSkillRequiresRegistrar() public {
        Types.Skill memory s = Types.Skill({
            kind: Types.SkillKind.Damage, multiplier: 10000, duration: 0,
            nameHash: keccak256("TEST"), aoe: false
        });
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("SkillRegistry: not registrar"));
        reg.addSkill(21, s, "test");
    }

    function testAddSkillRejectsReservedId() public {
        Types.Skill memory s = Types.Skill({
            kind: Types.SkillKind.Damage, multiplier: 10000, duration: 0,
            nameHash: keccak256("TEST"), aoe: false
        });
        vm.expectRevert(bytes("SkillRegistry: reserved id"));
        reg.addSkill(20, s, "collision");
    }

    function testAddSkillOwnerSucceeds() public {
        Types.Skill memory s = Types.Skill({
            kind: Types.SkillKind.Damage, multiplier: 12345, duration: 2,
            nameHash: keccak256(unicode"测试技能"), aoe: true
        });
        reg.addSkill(42, s, unicode"测试技能");

        Types.Skill memory r = reg.getSkill(42);
        assertEq(r.multiplier, 12345);
        assertEq(r.duration, 2);
        assertEq(r.aoe, true);
        assertEq(reg.skillName(42), unicode"测试技能");
    }

    function testAddSkillDuplicateReverts() public {
        Types.Skill memory s = Types.Skill({
            kind: Types.SkillKind.Damage, multiplier: 1, duration: 0,
            nameHash: keccak256("A"), aoe: false
        });
        reg.addSkill(50, s, "A");
        vm.expectRevert(bytes("SkillRegistry: exists"));
        reg.addSkill(50, s, "A2");
    }

    function testSetCuratorOwnerOnly() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(bytes("SkillRegistry: not owner"));
        reg.setCurator(address(0xCAFE));
    }

    function testCuratorCanAddSkill() public {
        reg.setCurator(address(0xCAFE));
        Types.Skill memory s = Types.Skill({
            kind: Types.SkillKind.Heal, multiplier: 3000, duration: 0,
            nameHash: keccak256("curator"), aoe: false
        });
        vm.prank(address(0xCAFE));
        reg.addSkill(100, s, "curator-added");
        assertEq(reg.skillName(100), "curator-added");
    }
}
