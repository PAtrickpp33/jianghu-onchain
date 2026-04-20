// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../src/Types.sol";
import {SectAffinity} from "../src/SectAffinity.sol";

/// @title SectAffinity unit tests
/// @notice The 7-ring rock-paper-scissors matrix has a lot of cases; lock down
///         the canonical ones so future edits can't silently break the meta.
contract SectAffinityTest is Test {
    function testNeutralSameSect() public pure {
        assertEq(
            uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Shaolin)),
            10000
        );
    }

    function testStrongVsRing() public pure {
        // Shaolin → Tangmen
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Tangmen)), 11500);
        // Tangmen → Emei
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Tangmen, Types.Sect.Emei)), 11500);
        // Emei → Wudang
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Emei, Types.Sect.Wudang)), 11500);
        // Wudang → Beggars
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Wudang, Types.Sect.Beggars)), 11500);
        // Beggars → Huashan
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Beggars, Types.Sect.Huashan)), 11500);
        // Huashan → Ming
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Huashan, Types.Sect.Ming)), 11500);
        // Ming → Shaolin (wrap)
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Ming, Types.Sect.Shaolin)), 11500);
    }

    function testWeakVsRing() public pure {
        // Defender counters attacker → 0.85x
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Tangmen, Types.Sect.Shaolin)), 8500);
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Ming)), 8500);
    }

    function testNeutralAcrossRing() public pure {
        // Two-apart matchups in the ring are neutral.
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Emei)), 10000);
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Wudang)), 10000);
        assertEq(uint256(SectAffinity.multiplierBps(Types.Sect.Shaolin, Types.Sect.Huashan)), 10000);
    }

    function testTagHelper() public pure {
        assertEq(SectAffinity.tag(Types.Sect.Shaolin, Types.Sect.Tangmen),  int8(1));
        assertEq(SectAffinity.tag(Types.Sect.Tangmen, Types.Sect.Shaolin),  int8(-1));
        assertEq(SectAffinity.tag(Types.Sect.Shaolin, Types.Sect.Shaolin),  int8(0));
        assertEq(SectAffinity.tag(Types.Sect.Shaolin, Types.Sect.Huashan), int8(0));
    }
}
