// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Types}         from "../src/Types.sol";
import {StageRegistry} from "../src/StageRegistry.sol";

/// @title SeedStages
/// @notice Static list of the 12 launch stages for Xiake Arena. Registered
///         once at deploy via `Deploy.s.sol`. Future stages are added
///         individually through `StageRegistry.addStage` and do not require a
///         redeploy.
///
/// Chapter layout:
///   Ch 1 · 初入江湖   — tutorial arc, sect sampling (stages 1..4)
///   Ch 2 · 门派恩怨   — 7-sect sparring + inter-sect politics (stages 5..8)
///   Ch 3 · 魔教来袭   — Ming cult final confrontation (stages 9..12)
library SeedStages {
    function seed(StageRegistry reg) internal {
        _s(reg, 1,  1,   0,  unicode"初入江湖·少林试炼",
            unicode"少林方丈让你拆三位武僧的招。",
            _t(_h(1001, Types.Sect.Shaolin, 160, 75, 90, 55, 500,  0, 1, 2),
               _h(1002, Types.Sect.Shaolin, 170, 70, 95, 50, 400,  0, 1, 2),
               _h(1003, Types.Sect.Shaolin, 150, 80, 85, 60, 600,  0, 1, 2)));

        _s(reg, 2,  1,  10,  unicode"初入江湖·唐门小试",
            unicode"唐门小弟子想用暗器讨回上次的场子。",
            _t(_h(1011, Types.Sect.Tangmen, 110, 90, 45, 90, 2500, 3, 4, 5),
               _h(1012, Types.Sect.Tangmen, 120, 88, 50, 85, 2200, 3, 4, 5),
               _h(1013, Types.Sect.Tangmen, 115, 92, 48, 88, 2400, 3, 4, 5)));

        _s(reg, 3,  1,  25,  unicode"初入江湖·峨眉清谈",
            unicode"峨眉师太考校你对「后发制人」四字的理解。",
            _t(_h(1021, Types.Sect.Emei, 135, 72, 55, 82, 1200, 6, 7, 8),
               _h(1022, Types.Sect.Emei, 140, 70, 58, 80, 1100, 6, 7, 8),
               _h(1023, Types.Sect.Emei, 130, 75, 52, 85, 1300, 6, 7, 8)));

        _s(reg, 4,  1,  40,  unicode"初入江湖·武当坐忘",
            unicode"武当道长的推手,一推就是一里路。章末 BOSS。",
            _t(_h(1101, Types.Sect.Wudang, 180, 95, 100, 70, 700,  9, 10, 11),
               _h(1102, Types.Sect.Wudang, 175, 90, 105, 68, 650,  9, 10, 11),
               _h(1103, Types.Sect.Wudang, 185, 92, 98,  72, 750,  9, 10, 11)));

        _s(reg, 5,  2,  55,  unicode"门派恩怨·丐帮争粥",
            unicode"长安城外,丐帮舵主抡着打狗棒挡路。",
            _t(_h(1201, Types.Sect.Beggars, 200, 85, 80, 60, 400, 12, 13, 14),
               _h(1202, Types.Sect.Beggars, 210, 80, 85, 58, 300, 12, 13, 14),
               _h(1203, Types.Sect.Beggars, 205, 82, 82, 62, 350, 12, 13, 14)));

        _s(reg, 6,  2,  70,  unicode"门派恩怨·华山论剑",
            unicode"华山剑冢。三位剑客的独孤九剑已出鞘。",
            _t(_h(1301, Types.Sect.Huashan, 130, 110, 55, 100, 2800, 15, 16, 17),
               _h(1302, Types.Sect.Huashan, 135, 108, 60,  98, 2600, 15, 16, 17),
               _h(1303, Types.Sect.Huashan, 125, 115, 50, 105, 3000, 15, 16, 17)));

        _s(reg, 7,  2,  85,  unicode"门派恩怨·少林藏经阁守卫",
            unicode"藏经阁失窃案,你要先说服守阁罗汉相信你不是贼。",
            _t(_h(1401, Types.Sect.Shaolin, 220, 95, 120, 60, 400,  0, 1, 2),
               _h(1402, Types.Sect.Tangmen, 140, 105, 55, 95, 2800, 3, 4, 5),
               _h(1403, Types.Sect.Wudang,  195, 95, 100, 70, 800,  9, 10, 11)));

        _s(reg, 8,  2, 100,  unicode"门派恩怨·唐门暗堂",
            unicode"唐门暗堂掌灯人率三死士截杀。章末 BOSS,小心毒沙。",
            _t(_h(1501, Types.Sect.Tangmen, 150, 115, 55, 100, 3200, 3, 4, 5),
               _h(1502, Types.Sect.Tangmen, 145, 120, 50, 102, 3500, 3, 4, 5),
               _h(1503, Types.Sect.Ming,    140, 110, 45, 90,  2000, 18, 19, 20)));

        _s(reg, 9,  3, 130,  unicode"魔教来袭·光明顶前哨",
            unicode"明教五散人之一的「铁冠道人」挡在山门前。",
            _t(_h(1601, Types.Sect.Ming, 155, 105, 60, 85, 1800, 18, 19, 20),
               _h(1602, Types.Sect.Ming, 150, 108, 55, 88, 2000, 18, 19, 20),
               _h(1603, Types.Sect.Ming, 145, 112, 50, 90, 2200, 18, 19, 20)));

        _s(reg, 10, 3, 160,  unicode"魔教来袭·四大护教法王",
            unicode"紫白金青四大法王中的两位联手,战况激烈。",
            _t(_h(1701, Types.Sect.Ming,    165, 120, 65, 95, 2800, 18, 19, 20),
               _h(1702, Types.Sect.Ming,    170, 115, 70, 92, 2500, 18, 19, 20),
               _h(1703, Types.Sect.Huashan, 140, 118, 55, 105, 3000, 15, 16, 17)));

        _s(reg, 11, 3, 200,  unicode"魔教来袭·圣女劝降",
            unicode"明教圣女只带一人赴会,却让你背脊发凉。",
            _t(_h(1801, Types.Sect.Ming,    180, 125, 70, 100, 3000, 18, 19, 20),
               _h(1802, Types.Sect.Beggars, 220, 100, 95, 65,  500, 12, 13, 14),
               _h(1803, Types.Sect.Emei,    150, 85, 70, 88, 1500, 6, 7, 8)));

        _s(reg, 12, 3, 240,  unicode"魔教来袭·教主决战",
            unicode"明教教主身怀乾坤大挪移。章末 BOSS,你我胜负,只此一局。",
            _t(_h(1901, Types.Sect.Ming,    220, 140, 80, 105, 3500, 18, 19, 20),
               _h(1902, Types.Sect.Ming,    215, 135, 75, 108, 3300, 18, 19, 20),
               _h(1903, Types.Sect.Wudang,  200, 120, 110, 85, 1200, 9, 10, 11)));
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _s(
        StageRegistry reg,
        uint8 stageId,
        uint8 chapter,
        uint32 minRep,
        string memory name,
        string memory flavor,
        Types.Hero[3] memory team
    ) private {
        reg.addStage(stageId, chapter, keccak256(bytes(name)), flavor, minRep, team);
    }

    function _t(Types.Hero memory a, Types.Hero memory b, Types.Hero memory c)
        private
        pure
        returns (Types.Hero[3] memory team)
    {
        team[0] = a; team[1] = b; team[2] = c;
    }

    function _h(
        uint256 tokenId,
        Types.Sect sect,
        uint16 hp, uint16 atk, uint16 def, uint16 spd, uint16 crit,
        uint8 s1, uint8 s2, uint8 s3
    ) private pure returns (Types.Hero memory h) {
        uint8[] memory sk = new uint8[](3);
        sk[0] = s1; sk[1] = s2; sk[2] = s3;
        h = Types.Hero({
            tokenId: tokenId, sect: sect,
            hp: hp, atk: atk, def: def, spd: spd, crit: crit,
            skillIds: sk
        });
    }
}
