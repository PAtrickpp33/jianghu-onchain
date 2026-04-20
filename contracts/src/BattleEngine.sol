// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Types} from "./Types.sol";
import {SkillBook} from "./SkillRegistry.sol";
import {SectAffinity} from "./SectAffinity.sol";

/// @title BattleEngine
/// @notice Pure, memory-only 3v3 turn-based combat simulator.
/// @dev    - `simulate` MUST stay `pure`. Zero SSTORE, zero external call.
///         - Deterministic given (teamA, teamB, seed). Off-chain skill can replay
///           the same sim and get identical events.
///         - Max 30 rounds. Each alive hero takes one action per round; skill chosen
///           by a round-seeded pseudo-random pick out of the hero's 3 skills.
library BattleEngine {
    using SkillBook for uint8;

    uint8 internal constant MAX_ROUNDS     = 30;
    uint8 internal constant TEAM_SIZE      = 3;
    uint8 internal constant TOTAL_SLOTS    = 6;
    uint16 internal constant CRIT_MULT_BPS = 15000; // 150%

    /// @notice Runtime per-hero state. Lives only in memory during `simulate`.
    struct HeroState {
        uint256 tokenId;
        Types.Sect sect;
        uint16 maxHp;
        int32  hp;       // signed so we can freely subtract; clamped back to >=0
        uint16 atk;
        uint16 def;
        uint16 spd;
        uint16 crit;
        uint8[] skillIds;

        // transient effects
        uint16 defBonusBps;       // +X% DEF from buffs
        uint8  defBuffRoundsLeft;
        uint8  controlRoundsLeft; // silenced / stunned — skips action
        uint16 dotPerTick;        // flat damage ticked at round start
        uint8  dotRoundsLeft;
        bool   alive;
        uint8  globalIdx;         // 0..5 for event encoding
    }

    // ---------------------------------------------------------------------
    // Public entrypoint
    // ---------------------------------------------------------------------

    /// @notice Simulate a 3v3 battle.
    /// @param a     Attacker team (exactly 3 heroes).
    /// @param b     Defender team (exactly 3 heroes).
    /// @param seed  Battle-level randomness; typically keccak256(prevrandao, battleId).
    /// @return winner 0 = attacker, 1 = defender, 2 = draw
    /// @return events Flat event log in chronological order.
    function simulate(
        Types.Hero[3] memory a,
        Types.Hero[3] memory b,
        uint256 seed
    ) internal pure returns (uint8 winner, Types.BattleEvent[] memory events) {
        HeroState[TOTAL_SLOTS] memory s = _initStates(a, b);

        // Preallocate max possible events: 30 rounds × 6 actors × up to 4 sub-events
        // (dot tick + action + kill). Cast to uint256 first — MAX_ROUNDS and
        // TOTAL_SLOTS are uint8 and 30*6*4 = 720 overflows uint8 (panic 0x11).
        Types.BattleEvent[] memory buf = new Types.BattleEvent[](
            uint256(MAX_ROUNDS) * uint256(TOTAL_SLOTS) * 4
        );
        uint256 n = 0;

        // Stable turn order (desc SPD, tie-break by tokenId asc). Dead heroes are skipped.
        uint8[TOTAL_SLOTS] memory order = _turnOrder(s);

        for (uint8 round = 1; round <= MAX_ROUNDS; round++) {
            // 1) Tick DoTs at the start of each round (skip round 1 — no dots yet)
            n = _tickDots(s, buf, n, round);

            // 2) Check end-of-battle after dot ticks
            (bool ended, uint8 w) = _checkWinner(s);
            if (ended) {
                winner = w;
                events = _truncate(buf, n);
                return (winner, events);
            }

            // 3) Each hero (in turn order) acts. Loop body is hoisted into
            //    `_runRound` to keep the `simulate` stack frame under the
            //    legacy-codegen 16-local limit.
            bool done;
            (n, done, winner) = _runRound(s, order, seed, round, buf, n);
            if (done) {
                events = _truncate(buf, n);
                return (winner, events);
            }

            // 4) End-of-round: decay buffs
            _decayBuffs(s);
        }

        // 5) Timeout: decide by remaining total HP.
        int256 hpA = int256(s[0].hp) + int256(s[1].hp) + int256(s[2].hp);
        int256 hpB = int256(s[3].hp) + int256(s[4].hp) + int256(s[5].hp);
        if (hpA > hpB)      winner = 0;
        else if (hpB > hpA) winner = 1;
        else                winner = 2;

        events = _truncate(buf, n);
    }

    /// @dev One round of actions. Extracted from `simulate` so the outer
    ///      stack frame does not exceed the legacy codegen 16-local cap.
    function _runRound(
        HeroState[TOTAL_SLOTS] memory s,
        uint8[TOTAL_SLOTS] memory order,
        uint256 seed,
        uint8 round,
        Types.BattleEvent[] memory buf,
        uint256 n
    ) private pure returns (uint256, bool done, uint8 winner) {
        for (uint8 i = 0; i < TOTAL_SLOTS; i++) {
            uint8 idx = order[i];
            if (!s[idx].alive) continue;

            if (s[idx].controlRoundsLeft > 0) {
                s[idx].controlRoundsLeft--;
                buf[n++] = Types.BattleEvent({
                    round: round,
                    actorIdx: idx,
                    skillId: 0,
                    targetIdx: idx,
                    hpDelta: 0,
                    flags: Types.FLAG_MISS | Types.FLAG_CONTROL
                });
                continue;
            }

            n = _actorTurn(s, idx, seed, round, i, buf, n);

            (bool ended, uint8 w) = _checkWinner(s);
            if (ended) {
                return (n, true, w);
            }
        }
        return (n, false, 0);
    }

    /// @dev Pick a skill for `idx` and apply it. Dedicated helper so the
    ///      skillId / Skill / rand locals live in their own stack frame.
    function _actorTurn(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 idx,
        uint256 seed,
        uint8 round,
        uint8 turnIdx,
        Types.BattleEvent[] memory buf,
        uint256 n
    ) private pure returns (uint256) {
        uint256 rand = uint256(keccak256(abi.encode(seed, round, idx, turnIdx)));
        uint8 skillId = s[idx].skillIds[rand % s[idx].skillIds.length];
        Types.Skill memory sk = SkillBook.get(skillId);
        return _applySkill(s, idx, skillId, sk, rand, round, buf, n);
    }

    // ---------------------------------------------------------------------
    // Initialisation
    // ---------------------------------------------------------------------

    function _initStates(
        Types.Hero[3] memory a,
        Types.Hero[3] memory b
    ) private pure returns (HeroState[TOTAL_SLOTS] memory s) {
        for (uint8 i = 0; i < TEAM_SIZE; i++) {
            _load(s[i],     a[i], i);
            _load(s[i + 3], b[i], i + 3);
        }
    }

    function _load(HeroState memory dst, Types.Hero memory h, uint8 gIdx) private pure {
        dst.tokenId            = h.tokenId;
        dst.sect               = h.sect;
        dst.maxHp              = h.hp;
        dst.hp                 = int32(uint32(h.hp));
        dst.atk                = h.atk;
        dst.def                = h.def;
        dst.spd                = h.spd;
        dst.crit               = h.crit;
        dst.skillIds           = h.skillIds;
        dst.alive              = h.hp > 0;
        dst.globalIdx          = gIdx;
        dst.defBonusBps        = 0;
        dst.defBuffRoundsLeft  = 0;
        dst.controlRoundsLeft  = 0;
        dst.dotPerTick         = 0;
        dst.dotRoundsLeft      = 0;
    }

    // ---------------------------------------------------------------------
    // Turn order (stable; desc SPD, asc tokenId tie-break)
    // ---------------------------------------------------------------------

    function _turnOrder(HeroState[TOTAL_SLOTS] memory s)
        private
        pure
        returns (uint8[TOTAL_SLOTS] memory order)
    {
        for (uint8 i = 0; i < TOTAL_SLOTS; i++) order[i] = i;

        // Insertion sort (n=6, plenty fast and stable)
        for (uint8 i = 1; i < TOTAL_SLOTS; i++) {
            uint8 key = order[i];
            int256 j = int256(uint256(i)) - 1;
            while (j >= 0 && _lessPriority(s, order[uint256(j)], key)) {
                order[uint256(j + 1)] = order[uint256(j)];
                j--;
            }
            order[uint256(j + 1)] = key;
        }
    }

    /// @dev returns true if hero at slot `lhs` should come AFTER `rhs` in the order.
    function _lessPriority(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 lhs,
        uint8 rhs
    ) private pure returns (bool) {
        if (s[lhs].spd != s[rhs].spd) return s[lhs].spd < s[rhs].spd;
        return s[lhs].tokenId > s[rhs].tokenId; // smaller tokenId wins tie
    }

    // ---------------------------------------------------------------------
    // Skill application
    // ---------------------------------------------------------------------

    function _applySkill(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 actor,
        uint8 skillId,
        Types.Skill memory sk,
        uint256 rand,
        uint8 round,
        Types.BattleEvent[] memory buf,
        uint256 n
    ) private pure returns (uint256) {
        if (sk.kind == Types.SkillKind.Damage) {
            if (sk.aoe) {
                uint8[3] memory targets = _enemies(actor);
                for (uint8 k = 0; k < 3; k++) {
                    if (s[targets[k]].alive) {
                        n = _dealDamage(s, actor, targets[k], skillId, sk, rand ^ k, round, buf, n);
                    }
                }
            } else {
                uint8 target = _pickAliveEnemy(s, actor, rand);
                if (target != type(uint8).max) {
                    n = _dealDamage(s, actor, target, skillId, sk, rand, round, buf, n);
                    // 般若掌: attach control post-hit
                    if (sk.duration > 0 && s[target].alive) {
                        s[target].controlRoundsLeft =
                            s[target].controlRoundsLeft < sk.duration
                                ? sk.duration
                                : s[target].controlRoundsLeft;
                    }
                }
            }
            return n;
        }

        if (sk.kind == Types.SkillKind.Heal) {
            if (sk.aoe) {
                uint8[3] memory allies = _allies(actor);
                for (uint8 k = 0; k < 3; k++) {
                    if (s[allies[k]].alive) {
                        n = _applyHeal(s, actor, allies[k], skillId, sk, round, buf, n);
                    }
                }
            } else {
                n = _applyHeal(s, actor, actor, skillId, sk, round, buf, n);
            }
            return n;
        }

        if (sk.kind == Types.SkillKind.Buff) {
            if (sk.multiplier == 0) {
                // Cleanse branch: clear control + dot on all allies (净心咒)
                uint8[3] memory allies = _allies(actor);
                for (uint8 k = 0; k < 3; k++) {
                    uint8 aIdx = allies[k];
                    if (!s[aIdx].alive) continue;
                    s[aIdx].controlRoundsLeft = 0;
                    s[aIdx].dotPerTick        = 0;
                    s[aIdx].dotRoundsLeft     = 0;
                    buf[n++] = Types.BattleEvent({
                        round: round,
                        actorIdx: actor,
                        skillId: skillId,
                        targetIdx: aIdx,
                        hpDelta: 0,
                        flags: Types.FLAG_BUFF
                    });
                }
            } else {
                // Self DEF buff (金钟罩)
                s[actor].defBonusBps       = sk.multiplier;
                s[actor].defBuffRoundsLeft = sk.duration;
                buf[n++] = Types.BattleEvent({
                    round: round,
                    actorIdx: actor,
                    skillId: skillId,
                    targetIdx: actor,
                    hpDelta: 0,
                    flags: Types.FLAG_BUFF
                });
            }
            return n;
        }

        if (sk.kind == Types.SkillKind.Control) {
            // 狮子吼 — AoE silence
            uint8[3] memory targets = _enemies(actor);
            for (uint8 k = 0; k < 3; k++) {
                if (!s[targets[k]].alive) continue;
                if (s[targets[k]].controlRoundsLeft < sk.duration) {
                    s[targets[k]].controlRoundsLeft = sk.duration;
                }
                buf[n++] = Types.BattleEvent({
                    round: round,
                    actorIdx: actor,
                    skillId: skillId,
                    targetIdx: targets[k],
                    hpDelta: 0,
                    flags: Types.FLAG_CONTROL
                });
            }
            return n;
        }

        if (sk.kind == Types.SkillKind.Dot) {
            // 毒针
            uint8 target = _pickAliveEnemy(s, actor, rand);
            if (target == type(uint8).max) return n;
            uint16 tick = uint16((uint256(s[target].maxHp) * sk.multiplier) / 10000);
            if (tick == 0) tick = 1;
            s[target].dotPerTick    = tick;
            s[target].dotRoundsLeft = sk.duration;
            buf[n++] = Types.BattleEvent({
                round: round,
                actorIdx: actor,
                skillId: skillId,
                targetIdx: target,
                hpDelta: 0,
                flags: Types.FLAG_DOT
            });
            return n;
        }

        return n;
    }

    // ---------------------------------------------------------------------
    // Damage / heal primitives
    // ---------------------------------------------------------------------

    /// @notice Compute damage exposed for unit tests.
    /// @dev `baseDamage = mult*ATK - DEF*0.5`, crit multiplies by 1.5, min 1.
    ///      Result is clamped to int16.max so it can round-trip into BattleEvent.hpDelta.
    function computeDamage(
        uint16 atk,
        uint16 defense,
        uint16 multiplierBps,
        uint16 defBonusBps,
        bool   isCrit
    ) internal pure returns (uint16) {
        uint256 raw       = (uint256(atk) * multiplierBps) / 10000;
        uint256 effDef    = (uint256(defense) * (10000 + defBonusBps)) / 10000;
        uint256 mitigated = effDef / 2;
        uint256 dmg       = raw > mitigated ? raw - mitigated : 1;
        if (isCrit) dmg = (dmg * CRIT_MULT_BPS) / 10000;
        if (dmg < 1)     dmg = 1;
        if (dmg > 32767) dmg = 32767; // cap to int16.max so hpDelta (int16) can hold -dmg
        return uint16(dmg);
    }

    function _dealDamage(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 actor,
        uint8 target,
        uint8 skillId,
        Types.Skill memory sk,
        uint256 rand,
        uint8 round,
        Types.BattleEvent[] memory buf,
        uint256 n
    ) private pure returns (uint256) {
        bool isCrit = (rand % 10000) < s[actor].crit;
        uint16 dmg  = computeDamage(
            s[actor].atk,
            s[target].def,
            sk.multiplier,
            s[target].defBonusBps,
            isCrit
        );

        // Apply sect-affinity (7-ring rock-paper-scissors). Deterministic —
        // does not consume rand, so replays produce the same result.
        uint16 aff = SectAffinity.multiplierBps(s[actor].sect, s[target].sect);
        if (aff != 10000) {
            uint256 scaled = (uint256(dmg) * aff) / 10000;
            if (scaled < 1)     scaled = 1;
            if (scaled > 32767) scaled = 32767;
            dmg = uint16(scaled);
        }

        s[target].hp -= int32(uint32(dmg));
        uint8 flags = isCrit ? Types.FLAG_CRIT : 0;

        if (s[target].hp <= 0) {
            s[target].hp    = 0;
            s[target].alive = false;
            flags |= Types.FLAG_KILL;
        }

        // dmg is clamped to int16.max in computeDamage, so negation is safe.
        buf[n++] = Types.BattleEvent({
            round: round,
            actorIdx: actor,
            skillId: skillId,
            targetIdx: target,
            hpDelta: -int16(int256(uint256(dmg))),
            flags: flags
        });
        return n;
    }

    function _applyHeal(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 actor,
        uint8 target,
        uint8 skillId,
        Types.Skill memory sk,
        uint8 round,
        Types.BattleEvent[] memory buf,
        uint256 n
    ) private pure returns (uint256) {
        uint256 heal = (uint256(s[target].maxHp) * sk.multiplier) / 10000;
        if (heal > 32767) heal = 32767;
        int32 after_ = s[target].hp + int32(uint32(heal));
        int32 cap = int32(uint32(s[target].maxHp));
        if (after_ > cap) after_ = cap;
        int32 applied = after_ - s[target].hp;
        if (applied > 32767)  applied = 32767;
        if (applied < -32768) applied = -32768;
        s[target].hp = after_;

        buf[n++] = Types.BattleEvent({
            round: round,
            actorIdx: actor,
            skillId: skillId,
            targetIdx: target,
            hpDelta: int16(applied),
            flags: Types.FLAG_HEAL
        });
        return n;
    }

    // ---------------------------------------------------------------------
    // Buff decay / DoT ticks
    // ---------------------------------------------------------------------

    function _decayBuffs(HeroState[TOTAL_SLOTS] memory s) private pure {
        for (uint8 i = 0; i < TOTAL_SLOTS; i++) {
            if (s[i].defBuffRoundsLeft > 0) {
                s[i].defBuffRoundsLeft--;
                if (s[i].defBuffRoundsLeft == 0) s[i].defBonusBps = 0;
            }
        }
    }

    function _tickDots(
        HeroState[TOTAL_SLOTS] memory s,
        Types.BattleEvent[] memory buf,
        uint256 n,
        uint8 round
    ) private pure returns (uint256) {
        if (round == 1) return n;
        for (uint8 i = 0; i < TOTAL_SLOTS; i++) {
            if (!s[i].alive || s[i].dotRoundsLeft == 0) continue;

            uint16 tick = s[i].dotPerTick;
            s[i].hp -= int32(uint32(tick));
            s[i].dotRoundsLeft--;

            uint8 flags = Types.FLAG_DOT;
            if (s[i].hp <= 0) {
                s[i].hp    = 0;
                s[i].alive = false;
                flags |= Types.FLAG_KILL;
            }

            buf[n++] = Types.BattleEvent({
                round: round,
                actorIdx: i,
                skillId: 5, // 毒针 id, informational
                targetIdx: i,
                hpDelta: -int16(int256(uint256(tick))),
                flags: flags
            });

            if (s[i].dotRoundsLeft == 0) {
                s[i].dotPerTick = 0;
            }
        }
        return n;
    }

    // ---------------------------------------------------------------------
    // Target helpers
    // ---------------------------------------------------------------------

    function _enemies(uint8 actor) private pure returns (uint8[3] memory e) {
        if (actor < 3) {
            e[0] = 3; e[1] = 4; e[2] = 5;
        } else {
            e[0] = 0; e[1] = 1; e[2] = 2;
        }
    }

    function _allies(uint8 actor) private pure returns (uint8[3] memory a) {
        if (actor < 3) {
            a[0] = 0; a[1] = 1; a[2] = 2;
        } else {
            a[0] = 3; a[1] = 4; a[2] = 5;
        }
    }

    function _pickAliveEnemy(
        HeroState[TOTAL_SLOTS] memory s,
        uint8 actor,
        uint256 rand
    ) private pure returns (uint8) {
        uint8[3] memory en = _enemies(actor);
        // walk in random offset to diversify targeting
        uint8 start = uint8(rand % 3);
        for (uint8 k = 0; k < 3; k++) {
            uint8 idx = en[(start + k) % 3];
            if (s[idx].alive) return idx;
        }
        return type(uint8).max;
    }

    // ---------------------------------------------------------------------
    // Win check + buffer truncation
    // ---------------------------------------------------------------------

    function _checkWinner(HeroState[TOTAL_SLOTS] memory s)
        private
        pure
        returns (bool ended, uint8 winner)
    {
        bool aAlive = s[0].alive || s[1].alive || s[2].alive;
        bool bAlive = s[3].alive || s[4].alive || s[5].alive;
        if (aAlive && !bAlive) return (true, 0);
        if (!aAlive && bAlive) return (true, 1);
        if (!aAlive && !bAlive) return (true, 2);
        return (false, 0);
    }

    function _truncate(Types.BattleEvent[] memory buf, uint256 n)
        private
        pure
        returns (Types.BattleEvent[] memory out)
    {
        out = new Types.BattleEvent[](n);
        for (uint256 i = 0; i < n; i++) out[i] = buf[i];
    }
}
