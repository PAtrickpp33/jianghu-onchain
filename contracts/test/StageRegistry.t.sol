// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../src/Types.sol";
import {StageRegistry} from "../src/StageRegistry.sol";

/// @title StageRegistry unit tests
contract StageRegistryTest is Test {
    StageRegistry reg;

    address owner   = address(this);
    address curator = address(0xCAFE);
    address stranger = address(0xBEEF);

    function setUp() public {
        reg = new StageRegistry();
    }

    function _team(Types.Sect s) internal pure returns (Types.Hero[3] memory team) {
        uint8[] memory sk = new uint8[](3);
        sk[0] = 0; sk[1] = 1; sk[2] = 2;
        Types.Hero memory h = Types.Hero({
            tokenId: 100, sect: s,
            hp: 100, atk: 50, def: 50, spd: 50, crit: 0,
            skillIds: sk
        });
        team[0] = h; team[1] = h; team[2] = h;
    }

    function testOwnerIsDeployer() public view {
        assertEq(reg.owner(), owner);
        assertEq(reg.contentCurator(), address(0));
    }

    function testAddStageAsOwner() public {
        reg.addStage(1, 1, keccak256("s1"), "flavor", 0, _team(Types.Sect.Shaolin));
        assertTrue(reg.exists(1));
        assertEq(reg.stageCount(), 1);
    }

    function testAddStageAsCurator() public {
        reg.setCurator(curator);
        vm.prank(curator);
        reg.addStage(2, 1, keccak256("s2"), "flavor", 0, _team(Types.Sect.Tangmen));
        assertTrue(reg.exists(2));
    }

    function testAddStageStrangerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("StageRegistry: not registrar"));
        reg.addStage(3, 1, keccak256("s3"), "flavor", 0, _team(Types.Sect.Emei));
    }

    function testStageIdZeroReserved() public {
        vm.expectRevert(bytes("StageRegistry: stageId 0 reserved"));
        reg.addStage(0, 1, keccak256("s0"), "flavor", 0, _team(Types.Sect.Shaolin));
    }

    function testDoubleAddReverts() public {
        reg.addStage(1, 1, keccak256("s1"), "f", 0, _team(Types.Sect.Shaolin));
        vm.expectRevert(bytes("StageRegistry: already exists"));
        reg.addStage(1, 1, keccak256("s1"), "f", 0, _team(Types.Sect.Shaolin));
    }

    function testUpdateStage() public {
        reg.addStage(1, 1, keccak256("s1"), "v1", 0, _team(Types.Sect.Shaolin));
        reg.updateStage(1, 50, "v2 re-tuned", _team(Types.Sect.Tangmen));

        (, , string memory flavor, uint32 rep, Types.Hero[3] memory team) = reg.getStage(1);
        assertEq(flavor, "v2 re-tuned");
        assertEq(rep, 50);
        assertEq(uint8(team[0].sect), uint8(Types.Sect.Tangmen));
    }

    function testUpdateUnknownReverts() public {
        vm.expectRevert(bytes("StageRegistry: unknown stage"));
        reg.updateStage(99, 0, "", _team(Types.Sect.Shaolin));
    }

    function testGetBossTeam() public {
        reg.addStage(1, 1, keccak256("s1"), "", 0, _team(Types.Sect.Huashan));
        Types.Hero[3] memory team = reg.getBossTeam(1);
        assertEq(uint8(team[0].sect), uint8(Types.Sect.Huashan));
    }

    function testListStageIds() public {
        reg.addStage(1, 1, keccak256("s1"), "", 0, _team(Types.Sect.Shaolin));
        reg.addStage(5, 2, keccak256("s5"), "", 0, _team(Types.Sect.Beggars));
        reg.addStage(9, 3, keccak256("s9"), "", 0, _team(Types.Sect.Ming));
        uint8[] memory ids = reg.listStageIds();
        assertEq(ids.length, 3);
        assertEq(ids[0], 1);
        assertEq(ids[1], 5);
        assertEq(ids[2], 9);
    }

    function testSetCuratorOwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(bytes("StageRegistry: not owner"));
        reg.setCurator(curator);
    }
}
