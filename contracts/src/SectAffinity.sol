// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

/// @title SectAffinity
/// @notice Ring-of-7 rock-paper-scissors counter matrix. Each sect does +15%
///         damage to the sect that comes next in the cycle, and takes +15%
///         from the sect that precedes it. All other matchups are neutral
///         (10000 bps).
/// @dev Pure library — zero storage, zero gas for deployment beyond call-site
///      inlining. Consumed by BattleEngine on every damage resolve. Cycle:
///
///      Shaolin → Tangmen → Emei → Wudang → Beggars → Huashan → Ming → (back)
///
///      Reasoning: gives every new sect a role in the meta. Classic 7-way
///      rotation so no sect is universally "best" and no sect is dead weight.
library SectAffinity {
    uint16 internal constant NEUTRAL        = 10000;
    uint16 internal constant STRONG_VS_BPS  = 11500; // attacker beats defender
    uint16 internal constant WEAK_VS_BPS    = 8500;  // attacker countered by defender

    /// @notice Damage multiplier in basis points. Caller does:
    ///     damage = base * multiplierBps(a, d) / 10000
    /// @param attacker Attacker's sect.
    /// @param defender Defender's sect.
    /// @return bps Multiplier basis points (8500 / 10000 / 11500).
    function multiplierBps(Types.Sect attacker, Types.Sect defender)
        internal
        pure
        returns (uint16 bps)
    {
        if (attacker == defender) return NEUTRAL;
        uint8 a = uint8(attacker);
        uint8 d = uint8(defender);
        // Ring of 7: next index = (a + 1) mod 7.
        if ((a + 1) % 7 == d) return STRONG_VS_BPS;
        if ((d + 1) % 7 == a) return WEAK_VS_BPS;
        return NEUTRAL;
    }

    /// @notice Convenience view for UI: returns -1 / 0 / +1 for the three
    ///         buckets. Avoids floating-point bps exposure in the skill CLI.
    function tag(Types.Sect attacker, Types.Sect defender) internal pure returns (int8) {
        uint16 m = multiplierBps(attacker, defender);
        if (m == STRONG_VS_BPS) return 1;
        if (m == WEAK_VS_BPS)   return -1;
        return 0;
    }
}
