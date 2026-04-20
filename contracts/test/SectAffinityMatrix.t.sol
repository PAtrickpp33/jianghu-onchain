// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Types} from "../src/Types.sol";
import {SectAffinity} from "../src/SectAffinity.sol";

/// @title SectAffinityMatrixTest
/// @notice Lock down ALL 49 (attacker × defender) combinations of the 7-ring
///         rock-paper-scissors. Any future change to SectAffinity.sol that
///         alters any cell must update this test deliberately.
contract SectAffinityMatrixTest is Test {
    uint16 constant NEUTRAL = 10000;
    uint16 constant STRONG  = 11500;
    uint16 constant WEAK    = 8500;

    // Expected matrix [attacker][defender]. Ring is:
    // Shaolin(0) → Tangmen(1) → Emei(2) → Wudang(3) → Beggars(4) → Huashan(5) → Ming(6) → (wrap)
    // Index: attacker counters (a+1)%7; attacker is countered by (a-1+7)%7.
    function _expected(uint8 a, uint8 d) internal pure returns (uint16) {
        if (a == d) return NEUTRAL;
        if ((a + 1) % 7 == d) return STRONG;
        if ((d + 1) % 7 == a) return WEAK;
        return NEUTRAL;
    }

    function testAll49Combinations() public pure {
        for (uint8 a = 0; a < 7; a++) {
            for (uint8 d = 0; d < 7; d++) {
                uint16 got = SectAffinity.multiplierBps(
                    Types.Sect(a),
                    Types.Sect(d)
                );
                uint16 want = _expected(a, d);
                assertEq(got, want, "matrix cell mismatch");
            }
        }
    }

    /// @notice Every sect has exactly one sect it strongly beats, one that
    ///         beats it, and four neutral. Total strong = total weak = 7,
    ///         total neutral = 7×7 - 14 = 35.
    function testMatrixShapeBalance() public pure {
        uint256 strongCount;
        uint256 weakCount;
        uint256 neutralCount;

        for (uint8 a = 0; a < 7; a++) {
            for (uint8 d = 0; d < 7; d++) {
                uint16 m = SectAffinity.multiplierBps(Types.Sect(a), Types.Sect(d));
                if (m == STRONG) strongCount++;
                else if (m == WEAK) weakCount++;
                else neutralCount++;
            }
        }
        assertEq(strongCount, 7, "expected 7 strong edges");
        assertEq(weakCount, 7, "expected 7 weak edges");
        assertEq(neutralCount, 35, "expected 35 neutral cells");
    }

    /// @notice Strong vs Weak are mirror images: if a beats d, d must be weak vs a.
    function testMatrixSymmetry() public pure {
        for (uint8 a = 0; a < 7; a++) {
            for (uint8 d = 0; d < 7; d++) {
                uint16 m1 = SectAffinity.multiplierBps(Types.Sect(a), Types.Sect(d));
                uint16 m2 = SectAffinity.multiplierBps(Types.Sect(d), Types.Sect(a));
                if (m1 == STRONG) assertEq(m2, WEAK, "strong-weak mirror broken");
                else if (m1 == WEAK) assertEq(m2, STRONG, "weak-strong mirror broken");
                else assertEq(m2, NEUTRAL, "neutral-neutral broken");
            }
        }
    }
}
