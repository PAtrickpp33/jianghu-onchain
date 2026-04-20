#!/usr/bin/env node
// CLI entry point for the Xiake game engine.
// Called by Claude Code skill via Bash: `node cli.js <command> [args...]`
//
// Commands:
//   init                        — Show welcome + game menu (prints mode on first line)
//   mint [count]                — Mint 1-3 heroes (mock: append locally, onchain: mintHero)
//   team <a> <b> <c>            — Set active 3v3 team by tokenId
//   heroes                      — List current heroes (⚕️ = wounded, 🎁 = has skill beads)
//   stages                      — Show PVE stage list (grouped by chapter, with lock status)
//   pve <stageId>               — Run PVE battle. stageId supports "1-1" or legacy "1"
//   pvp                         — Run AI vs AI battle with activeTeam
//   status                      — Show current game state
//   wounds                      — Show injured heroes + remaining recovery seconds
//   equip <heroId> <slot> <sid> — Equip a collected skill bead into slot 0-2

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  Sect,
  SkillKind,
  SECT_NAMES,
  SECT_ICON,
  SECT_CYCLE,
  type Hero,
  type HeroState,
  type BattleEvent,
  FLAG_CRIT,
  FLAG_KILL,
  hasFlag,
} from "./types.js";
import { getMode, type Mode } from "./utils/mode.js";

// ── State file ──────────────────────────────────────────────────────────────

// Legacy `WUXIA_STATE_DIR` / `.wuxia` reads kept as fallbacks so existing
// players' save files keep loading after the rebrand. New installs use
// XIAKE_STATE_DIR and write to `.xiake`.
const _HOME = process.env.HOME ?? process.env.USERPROFILE ?? ".";
const _LEGACY_STATE_DIR = join(_HOME, ".wuxia");
const _DEFAULT_STATE_DIR = join(_HOME, ".xiake");
const STATE_DIR = process.env.XIAKE_STATE_DIR
  ?? process.env.WUXIA_STATE_DIR
  ?? (existsSync(join(_LEGACY_STATE_DIR, "state.json")) ? _LEGACY_STATE_DIR : _DEFAULT_STATE_DIR);
const STATE_FILE = join(STATE_DIR, "state.json");

interface HeroHealth {
  woundLevel: 0 | 1 | 2;
  cooldownUntil: number; // epoch ms
  potionCount: number;
}

interface BattleHistoryEntry {
  kind?: "pve" | "pvp" | "arena" | "auto";
  stageId?: string;
  subtitle?: string;
  winner: 0 | 1 | 2;
  timestamp: number;
  playerTeam?: Hero[];
  opponentTeam?: Hero[];
  opponentLabel?: string;
  events?: BattleEvent[];
  mvpIdx?: number;
  mvpName?: string;
}

interface AchievementState {
  earned: boolean;
  progress: number;
  unlockedAt: number;
}

interface SeasonState {
  current: number;
  startsAt: number;
  endsAt: number;
  lastRank?: number;
}

interface GameState {
  heroes: Hero[];
  activeTeam: bigint[]; // length ≤ 3 tokenIds; defaults to latest 3 heroes
  reputation: number;
  clearedStages: string[]; // stage keys like "1-1"
  battleHistory: BattleHistoryEntry[];
  playerAddress?: `0x${string}`;
  heroHealth: Record<string, HeroHealth>;   // key = tokenId.toString()
  skillBeads: Record<string, number[]>;     // key = tokenId.toString(), value = [skillId,...]
  pityBonus: number;                         // 掉落惜败补偿 0-80,未出珠时累加 +5,出珠归零
  potions: number;                           // 金疮药库存 (玩家级, 用于 heal 命令清伤病)
  allowance: {                               // weekly free pulls + boss/daily rewards
    free: number;
    bossRewards: number;
    dailyRewards: number;
    lastReset: number;
  };
  lastDailyClaim: number;                    // epoch ms of last successful `daily` claim (mock mode)
  pendingWithdrawal?: {                      // admin 2-step schedule (mock mode)
    target: string;
    amount: number;
    executeAfter: number;                    // epoch ms
  };
  defenseTeam?: [bigint, bigint, bigint];    // PVP 防守阵容 (mock 持久化)
  achievements: Record<string, AchievementState>;
  season: SeasonState;
  // Wave 2 · 抽卡 v2 — pity / shards / referral ledgers.
  // Mirrors HeroNFT.playerPity / shards / referredBy 所以 mock 和 onchain
  // 走同一份 UI 渲染逻辑。currentCount 0..29,到 30 强制 sectCycle 当次派系;
  // bossPityCount 0..79,到 80 强制下次 mint 掉 BOSS 技能珠。
  pityProgress: {
    currentCount: number;
    sectCycle: number;      // 0=少林 1=唐门 2=峨眉 (武当 v3 再加,现在 mod 3)
    bossPityCount: number;
  };
  shards: number;           // 声望碎片 (exchangeDuplicate 获得)
  referredBy?: string;      // 我的推荐人钱包地址 (首付费前绑定)
  referralEarned: number;   // 我作为推荐人累计获得的 ETH 卡券 (0.002 ETH/位)
  referralPaid: boolean;    // 我作为被推荐人,首付费奖励是否已发放 (mock)
}

// ── Achievements ────────────────────────────────────────────────────────────

interface AchievementDef {
  id: string;
  name: string;        // 中文名, 显示用
  desc: string;        // 简短描述
  target: number;      // 目标进度 (1 = 完成即解锁)
}

const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_mint",           name: "初出茅庐",       desc: "首次铸造侠客",              target: 1 },
  { id: "three_sects",          name: "三派汇流",       desc: "集齐少林/唐门/峨眉 3 派侠客", target: 1 },
  { id: "seven_sects",          name: "七宗合鸣",       desc: "集齐 7 派侠客(含武当/丐帮/华山/明教)", target: 1 },
  { id: "first_kill",           name: "初斩敌首",       desc: "首次在战斗中击杀敌人",      target: 1 },
  { id: "first_pve",            name: "初战告捷",       desc: "首胜 PVE 关卡",             target: 1 },
  { id: "first_boss",           name: "首杀暴君",       desc: "首次击杀章节 BOSS",         target: 1 },
  { id: "first_arena",          name: "擂主威名",       desc: "首胜擂台 BOSS",             target: 1 },
  { id: "crit_master",          name: "百步穿杨",       desc: "单场战斗造成 3 次暴击",     target: 1 },
  { id: "skill_bead_collector", name: "集珠成链",       desc: "收集 5 颗技能珠",           target: 5 },
  { id: "no_deaths_stage",      name: "金身不坏",       desc: "无人阵亡通关任意 PVE",      target: 1 },
  { id: "chapter1_clear",       name: "初入江湖",       desc: "通关第 1 章节所有关卡",     target: 4 },
];

const ACHIEVEMENT_BY_ID: Map<string, AchievementDef> = new Map(ACHIEVEMENTS.map(a => [a.id, a]));

const SEASON_DAYS = 14;
const SEASON_MS = SEASON_DAYS * 24 * 3600 * 1000;

function newSeason(current: number, now: number): SeasonState {
  return { current, startsAt: now, endsAt: now + SEASON_MS };
}

function emptyAchievements(): Record<string, AchievementState> {
  const out: Record<string, AchievementState> = {};
  for (const a of ACHIEVEMENTS) {
    out[a.id] = { earned: false, progress: 0, unlockedAt: 0 };
  }
  return out;
}

function emptyState(): GameState {
  const now = Date.now();
  return {
    heroes: [],
    activeTeam: [],
    reputation: 0,
    clearedStages: [],
    battleHistory: [],
    heroHealth: {},
    skillBeads: {},
    pityBonus: 0,
    potions: 0,
    allowance: { free: 5, bossRewards: 0, dailyRewards: 0, lastReset: now },
    lastDailyClaim: 0,
    achievements: emptyAchievements(),
    season: newSeason(1, now),
    pityProgress: { currentCount: 0, sectCycle: 0, bossPityCount: 0 },
    shards: 0,
    referralEarned: 0,
    referralPaid: false,
  };
}

function loadState(): GameState {
  if (!existsSync(STATE_FILE)) return emptyState();
  const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  const state = emptyState();
  if (Array.isArray(raw.heroes)) {
    state.heroes = raw.heroes.map((h: any) => ({ ...h, tokenId: BigInt(h.tokenId) }));
  }
  state.activeTeam = Array.isArray(raw.activeTeam) ? raw.activeTeam.map((x: any) => BigInt(x)) : [];
  state.reputation = typeof raw.reputation === "number" ? raw.reputation : 0;
  // clearedStages may exist as numbers (legacy) or strings — normalize to string keys
  if (Array.isArray(raw.clearedStages)) {
    state.clearedStages = raw.clearedStages.map((s: any) => {
      if (typeof s === "number") return `${s}-1`;
      return String(s);
    });
  }
  if (Array.isArray(raw.battleHistory)) {
    state.battleHistory = raw.battleHistory.map((b: any) => {
      const entry: BattleHistoryEntry = {
        stageId: b.stageId === undefined ? undefined : (typeof b.stageId === "number" ? `${b.stageId}-1` : String(b.stageId)),
        winner: b.winner,
        timestamp: b.timestamp,
      };
      if (typeof b.kind === "string") entry.kind = b.kind;
      if (typeof b.subtitle === "string") entry.subtitle = b.subtitle;
      if (typeof b.opponentLabel === "string") entry.opponentLabel = b.opponentLabel;
      if (Array.isArray(b.playerTeam)) {
        entry.playerTeam = b.playerTeam.map((h: any) => ({ ...h, tokenId: BigInt(h.tokenId) }));
      }
      if (Array.isArray(b.opponentTeam)) {
        entry.opponentTeam = b.opponentTeam.map((h: any) => ({ ...h, tokenId: BigInt(h.tokenId) }));
      }
      if (Array.isArray(b.events)) {
        entry.events = b.events.map((e: any) => ({
          round: e.round, actorIdx: e.actorIdx, skillId: e.skillId,
          targetIdx: e.targetIdx, hpDelta: e.hpDelta, flags: e.flags,
        }));
      }
      if (typeof b.mvpIdx === "number") entry.mvpIdx = b.mvpIdx;
      if (typeof b.mvpName === "string") entry.mvpName = b.mvpName;
      return entry;
    });
  }
  if (raw.playerAddress) state.playerAddress = raw.playerAddress;
  if (raw.heroHealth && typeof raw.heroHealth === "object") state.heroHealth = raw.heroHealth;
  if (raw.skillBeads && typeof raw.skillBeads === "object") state.skillBeads = raw.skillBeads;
  if (typeof raw.pityBonus === "number") state.pityBonus = Math.max(0, Math.min(80, raw.pityBonus));
  if (typeof raw.potions === "number" && Number.isFinite(raw.potions)) state.potions = Math.max(0, Math.floor(raw.potions));
  if (raw.allowance && typeof raw.allowance === "object") {
    state.allowance = {
      free: typeof raw.allowance.free === "number" ? raw.allowance.free : 5,
      bossRewards: typeof raw.allowance.bossRewards === "number" ? raw.allowance.bossRewards : 0,
      dailyRewards: typeof raw.allowance.dailyRewards === "number" ? raw.allowance.dailyRewards : 0,
      lastReset: typeof raw.allowance.lastReset === "number" ? raw.allowance.lastReset : Date.now(),
    };
  }
  if (typeof raw.lastDailyClaim === "number") state.lastDailyClaim = raw.lastDailyClaim;
  if (raw.pendingWithdrawal && typeof raw.pendingWithdrawal === "object") {
    const p = raw.pendingWithdrawal;
    if (typeof p.target === "string" && typeof p.amount === "number" && typeof p.executeAfter === "number") {
      state.pendingWithdrawal = { target: p.target, amount: p.amount, executeAfter: p.executeAfter };
    }
  }
  if (Array.isArray(raw.defenseTeam) && raw.defenseTeam.length === 3) {
    try {
      state.defenseTeam = [
        BigInt(raw.defenseTeam[0]),
        BigInt(raw.defenseTeam[1]),
        BigInt(raw.defenseTeam[2]),
      ];
    } catch {
      /* ignore malformed defenseTeam */
    }
  }
  if (raw.achievements && typeof raw.achievements === "object") {
    for (const a of ACHIEVEMENTS) {
      const v = raw.achievements[a.id];
      if (v && typeof v === "object") {
        state.achievements[a.id] = {
          earned: Boolean(v.earned),
          progress: typeof v.progress === "number" ? v.progress : 0,
          unlockedAt: typeof v.unlockedAt === "number" ? v.unlockedAt : 0,
        };
      }
    }
  }
  if (raw.pityProgress && typeof raw.pityProgress === "object") {
    const p = raw.pityProgress;
    state.pityProgress = {
      currentCount: typeof p.currentCount === "number"
        ? Math.max(0, Math.min(SECT_PITY_THRESHOLD - 1, Math.floor(p.currentCount)))
        : 0,
      sectCycle: typeof p.sectCycle === "number" ? ((Math.floor(p.sectCycle) % 3) + 3) % 3 : 0,
      bossPityCount: typeof p.bossPityCount === "number"
        ? Math.max(0, Math.min(BOSS_PITY_THRESHOLD - 1, Math.floor(p.bossPityCount)))
        : 0,
    };
  }
  if (typeof raw.shards === "number" && Number.isFinite(raw.shards)) {
    state.shards = Math.max(0, Math.floor(raw.shards));
  }
  if (typeof raw.referredBy === "string" && /^0x[0-9a-fA-F]{40}$/.test(raw.referredBy)) {
    state.referredBy = raw.referredBy;
  }
  if (typeof raw.referralEarned === "number" && Number.isFinite(raw.referralEarned)) {
    state.referralEarned = Math.max(0, raw.referralEarned);
  }
  if (typeof raw.referralPaid === "boolean") state.referralPaid = raw.referralPaid;
  if (raw.season && typeof raw.season === "object") {
    const s = raw.season;
    state.season = {
      current: typeof s.current === "number" ? s.current : 1,
      startsAt: typeof s.startsAt === "number" ? s.startsAt : Date.now(),
      endsAt: typeof s.endsAt === "number" ? s.endsAt : Date.now() + SEASON_MS,
      lastRank: typeof s.lastRank === "number" ? s.lastRank : undefined,
    };
  }
  return state;
}

function saveState(state: GameState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const serializable = {
    ...state,
    heroes: state.heroes.map(h => ({ ...h, tokenId: h.tokenId.toString() })),
    activeTeam: state.activeTeam.map(id => id.toString()),
    defenseTeam: state.defenseTeam ? state.defenseTeam.map(id => id.toString()) : undefined,
    battleHistory: state.battleHistory.map(b => ({
      ...b,
      playerTeam: b.playerTeam?.map(h => ({ ...h, tokenId: h.tokenId.toString() })),
      opponentTeam: b.opponentTeam?.map(h => ({ ...h, tokenId: h.tokenId.toString() })),
    })),
  };
  writeFileSync(STATE_FILE, JSON.stringify(serializable, null, 2));
}

// ── Skill metadata ──────────────────────────────────────────────────────────

// Skill id 0..20 mirror Solidity SkillBook exactly.
// 100+ reserved for mock-only BOSS signature beads / legacy drops.
const SKILL_NAMES: Record<number, string> = {
  // Shaolin 0..2
  0: "金钟罩", 1: "易筋经", 2: "狮子吼",
  // Tangmen 3..5
  3: "穿心刺", 4: "暗器急雨", 5: "毒针",
  // Emei 6..8
  6: "慈航普渡", 7: "净心咒", 8: "般若掌",
  // Wudang 9..11
  9: "太极推手", 10: "梯云纵", 11: "真武破军",
  // Beggars 12..14
  12: "降龙十八掌", 13: "打狗棒法", 14: "醉八仙",
  // Huashan 15..17
  15: "独孤九剑", 16: "紫霞神功", 17: "华山群剑",
  // Ming 18..20
  18: "圣火令", 19: "乾坤大挪移", 20: "毒沙掌",
  // Legacy BOSS-bead labels (kept so existing mock saves with old skill ids
  // still render something instead of "技能#NN"). No battle engine impact.
  100: "降龙十八掌·极", 101: "九阴白骨爪", 102: "碧海潮生曲", 103: "蛤蟆功",
  104: "三丰真功",
};

const SKILL_EFFECT: Record<number, { kind: SkillKind; multBps: number; aoe: boolean; heal: number }> = {
  0: { kind: SkillKind.Buff, multBps: 0, aoe: false, heal: 0 },
  1: { kind: SkillKind.Heal, multBps: 0, aoe: false, heal: 30 },
  2: { kind: SkillKind.Control, multBps: 0, aoe: true, heal: 0 },
  3: { kind: SkillKind.Damage, multBps: 15000, aoe: false, heal: 0 },
  4: { kind: SkillKind.Damage, multBps: 8000, aoe: true, heal: 0 },
  5: { kind: SkillKind.Dot, multBps: 1000, aoe: false, heal: 0 },
  6: { kind: SkillKind.Heal, multBps: 0, aoe: true, heal: 20 },
  7: { kind: SkillKind.Control, multBps: 0, aoe: false, heal: 0 },
  8: { kind: SkillKind.Damage, multBps: 12000, aoe: false, heal: 0 },
  // BOSS signatures
  9: { kind: SkillKind.Damage, multBps: 22000, aoe: false, heal: 0 }, // 降龙十八掌: heavy single
  10: { kind: SkillKind.Heal, multBps: 0, aoe: true, heal: 40 },      // 太极真功: big AOE heal
  11: { kind: SkillKind.Damage, multBps: 14000, aoe: true, heal: 0 }, // 乾坤大挪移: AOE
  // Arena BOSS signatures (Week 3 名人擂台)
  12: { kind: SkillKind.Buff,    multBps: 0,     aoe: true,  heal: 0 },  // 三丰真功: 全场 def buff
  13: { kind: SkillKind.Damage,  multBps: 25000, aoe: false, heal: 0 },  // 降龙十八掌·极: 单体 250%
  14: { kind: SkillKind.Damage,  multBps: 18000, aoe: false, heal: 0 },  // 九阴白骨爪: 单体 180% + debuff
  15: { kind: SkillKind.Control, multBps: 0,     aoe: true,  heal: 0 },  // 碧海潮生曲: AOE 沉默 2 回合
  16: { kind: SkillKind.Dot,     multBps: 12000, aoe: true,  heal: 0 },  // 蛤蟆功: AOE DoT 120%/回合 3 回合
};

// ── Tactical tags (P1-5) ────────────────────────────────────────────────────
// Per-hero "战术标签" appended to lineup lines (…— 磐石·少林护盾). Covers
// pool heroes + boss-team named characters; anyone missing falls back to
// sect-based defaults below.

const TACTICAL_TAGS: Record<string, { tag: string; role: string }> = {
  // 指令池直接要求的 4 位
  "圆智":   { tag: "磐石", role: "少林护盾" },
  "灭绝":   { tag: "铁掌", role: "峨眉攻坚" },
  "柳如烟": { tag: "影针", role: "唐门收割" },
  "周芷若": { tag: "秋水", role: "峨眉清心" },
  // 其余常见池 / BOSS 名人
  "玄苦":   { tag: "金刚", role: "少林方丈" },
  "空见":   { tag: "悲悯", role: "少林疗伤" },
  "渡劫":   { tag: "狮吼", role: "少林控场" },
  "觉远":   { tag: "铁罗汉", role: "少林前排" },
  "智光":   { tag: "灯心", role: "少林疗伤" },
  "慧能":   { tag: "明心", role: "少林顿悟" },
  "飞燕":   { tag: "穿心", role: "唐门穿心" },
  "夜鸮":   { tag: "夜刃", role: "唐门夜袭" },
  "无名":   { tag: "无影", role: "唐门绝杀" },
  "风陵":   { tag: "清月", role: "峨眉辅助" },
  "张三丰": { tag: "太极", role: "武当宗师" },
  "郭靖":   { tag: "降龙", role: "侠之大者" },
  "黄药师": { tag: "潮生", role: "东邪奇门" },
  "欧阳锋": { tag: "蛤蟆", role: "西毒霸道" },
};

const SECT_DEFAULT_TAG: Record<Sect, { tag: string; role: string }> = {
  [Sect.Shaolin]: { tag: "金刚",  role: "少林正道" },
  [Sect.Tangmen]: { tag: "暗影",  role: "唐门毒影" },
  [Sect.Emei]:    { tag: "清心",  role: "峨眉剑修" },
  [Sect.Wudang]:  { tag: "太极",  role: "武当真传" },
  [Sect.Beggars]: { tag: "降龙",  role: "丐帮长老" },
  [Sect.Huashan]: { tag: "剑冢",  role: "华山剑客" },
  [Sect.Ming]:    { tag: "圣火",  role: "明教骨干" },
};

function tagFor(h: Hero): { tag: string; role: string } {
  return TACTICAL_TAGS[h.name] ?? SECT_DEFAULT_TAG[h.sect];
}

// ── Render mode (P1-7) ─────────────────────────────────────────────────────

type ReportMode = "lite" | "full" | "epic";

function resolveReportMode(defaultMode: ReportMode): ReportMode {
  const raw = (process.env.XIAKE_REPORT_MODE ?? "").toLowerCase();
  if (raw === "lite" || raw === "full" || raw === "epic") return raw;
  return defaultMode;
}

// Epic-mode 开场白指令池 (轮换,不走 skill.md,避免越权)
const EPIC_OPENING_LINES = [
  "且说这一战……",
  "说时迟那时快,内力已起——",
  "风声骤停,场中众人皆屏息凝神:",
  "江湖恩怨,一招一式尽在眼前:",
  "此招一出,但见——",
  "山雨欲来,双方剑拔弩张:",
];

// ── HP bar renderer (P0-1) ─────────────────────────────────────────────────
// 20 格填充,█ = 整格,▓ = 损耗/空;<30% 标 ⚠️,阵亡 ☠️。

const BAR_WIDTH = 20;

function renderHpBar(cur: number, max: number): string {
  const clamped = Math.max(0, Math.min(max, cur));
  const ratio = max > 0 ? clamped / max : 0;
  const full = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - full;
  return "█".repeat(full) + "▓".repeat(empty);
}

interface BuffMarker {
  label: string;          // e.g. "金钟罩"
  rounds: number;         // remaining rounds
  kind: SkillKind;
}

interface HpSnapshot {
  heroes: Array<{
    hero: Hero;
    side: "A" | "B";
    globalIdx: number;    // 0..5
    currentHp: number;
    maxHp: number;
    alive: boolean;
    buffs: BuffMarker[];
  }>;
}

function renderSnapshotBlock(snap: HpSnapshot): string[] {
  const lines: string[] = [];
  // Determine name column width for alignment
  const nameWidth = Math.max(
    ...snap.heroes.map(h => visualLen(h.hero.name)),
    6,
  );
  for (const h of snap.heroes) {
    const sideIcon = h.alive ? (h.side === "A" ? "🟢" : "🔴") : (h.side === "A" ? "⚫" : "⚫");
    const bar = renderHpBar(h.currentHp, h.maxHp);
    const hpStr = `${String(h.currentHp).padStart(3)}/${String(h.maxHp).padStart(3)}`;
    const dead = !h.alive;
    const lowHp = h.alive && h.maxHp > 0 && h.currentHp / h.maxHp < 0.3;
    const mark = dead ? " ☠️" : lowHp ? " ⚠️" : "";
    const buffStr = h.buffs.length > 0
      ? "  (" + h.buffs.map(bf => {
          const icon = bf.kind === SkillKind.Dot ? "🟣" : bf.kind === SkillKind.Control ? "🔇" : "✨";
          return `${icon}${bf.label} ${bf.rounds}r`;
        }).join(", ") + ")"
      : "";
    const namePadded = padVisual(h.hero.name, nameWidth);
    lines.push(`${sideIcon} ${namePadded}  ${bar} ${hpStr}${mark}${buffStr}`);
  }
  return lines;
}

// CJK-aware visual width (each CJK char ≈ 2 columns)
function visualLen(s: string): number {
  let n = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // rough CJK ranges
    if (code >= 0x3000 && code <= 0x9fff) n += 2;
    else if (code >= 0xff00 && code <= 0xffef) n += 2;
    else n += 1;
  }
  return n;
}

function padVisual(s: string, width: number): string {
  const pad = Math.max(0, width - visualLen(s));
  return s + " ".repeat(pad);
}

// ── Hero pool ───────────────────────────────────────────────────────────────

const HERO_POOL: Array<{ sect: Sect; name: string; hp: number; atk: number; def: number; spd: number; crit: number; skillIds: number[] }> = [
  { sect: Sect.Shaolin, name: "圆智", hp: 180, atk: 70, def: 95, spd: 55, crit: 500, skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "玄苦", hp: 200, atk: 75, def: 100, spd: 50, crit: 400, skillIds: [0, 1, 2] },
  { sect: Sect.Shaolin, name: "空见", hp: 190, atk: 65, def: 105, spd: 45, crit: 300, skillIds: [1, 0, 2] },
  { sect: Sect.Shaolin, name: "渡劫", hp: 170, atk: 80, def: 90, spd: 60, crit: 600, skillIds: [2, 0, 1] },
  { sect: Sect.Tangmen, name: "飞燕", hp: 100, atk: 95, def: 50, spd: 90, crit: 1500, skillIds: [3, 4, 5] },
  { sect: Sect.Tangmen, name: "无名", hp: 110, atk: 90, def: 55, spd: 85, crit: 1800, skillIds: [3, 5, 4] },
  { sect: Sect.Tangmen, name: "夜鸮", hp: 95, atk: 100, def: 45, spd: 95, crit: 2000, skillIds: [4, 3, 5] },
  { sect: Sect.Tangmen, name: "柳如烟", hp: 105, atk: 88, def: 52, spd: 88, crit: 1600, skillIds: [5, 3, 4] },
  { sect: Sect.Emei, name: "静因", hp: 130, atk: 65, def: 70, spd: 80, crit: 800, skillIds: [6, 7, 8] },
  { sect: Sect.Emei, name: "灭绝", hp: 120, atk: 80, def: 65, spd: 75, crit: 1200, skillIds: [8, 6, 7] },
  { sect: Sect.Emei, name: "风陵", hp: 125, atk: 72, def: 68, spd: 82, crit: 1000, skillIds: [6, 8, 7] },
  { sect: Sect.Emei, name: "周芷若", hp: 115, atk: 85, def: 60, spd: 78, crit: 1400, skillIds: [8, 7, 6] },
  // ── 武当 ────────────────────────────────────────────────────────────────
  { sect: Sect.Wudang, name: "张三丰", hp: 200, atk: 100, def: 108, spd: 75, crit: 800, skillIds: [9, 10, 11] },
  { sect: Sect.Wudang, name: "宋远桥", hp: 170, atk: 92,  def: 100, spd: 72, crit: 700, skillIds: [9, 11, 10] },
  { sect: Sect.Wudang, name: "俞莲舟", hp: 175, atk: 95,  def: 95,  spd: 78, crit: 750, skillIds: [11, 9, 10] },
  { sect: Sect.Wudang, name: "张松溪", hp: 165, atk: 90,  def: 102, spd: 70, crit: 650, skillIds: [10, 9, 11] },
  // ── 丐帮 ────────────────────────────────────────────────────────────────
  { sect: Sect.Beggars, name: "洪七公", hp: 225, atk: 110, def: 85, spd: 65, crit: 400, skillIds: [12, 13, 14] },
  { sect: Sect.Beggars, name: "乔峰",   hp: 235, atk: 120, def: 90, spd: 68, crit: 500, skillIds: [12, 14, 13] },
  { sect: Sect.Beggars, name: "黄蓉",   hp: 180, atk: 95,  def: 70, spd: 78, crit: 900, skillIds: [13, 14, 12] },
  { sect: Sect.Beggars, name: "鲁有脚", hp: 215, atk: 100, def: 88, spd: 60, crit: 350, skillIds: [12, 13, 14] },
  // ── 华山 ────────────────────────────────────────────────────────────────
  { sect: Sect.Huashan, name: "令狐冲", hp: 145, atk: 125, def: 60, spd: 108, crit: 3500, skillIds: [15, 16, 17] },
  { sect: Sect.Huashan, name: "岳灵珊", hp: 130, atk: 115, def: 55, spd: 102, crit: 3000, skillIds: [15, 17, 16] },
  { sect: Sect.Huashan, name: "风清扬", hp: 140, atk: 130, def: 58, spd: 110, crit: 4000, skillIds: [17, 15, 16] },
  { sect: Sect.Huashan, name: "宁中则", hp: 135, atk: 112, def: 62, spd: 100, crit: 2800, skillIds: [16, 15, 17] },
  // ── 明教 ────────────────────────────────────────────────────────────────
  { sect: Sect.Ming, name: "张无忌",   hp: 185, atk: 130, def: 72, spd: 95,  crit: 1800, skillIds: [18, 19, 20] },
  { sect: Sect.Ming, name: "杨逍",     hp: 165, atk: 120, def: 65, spd: 98,  crit: 2000, skillIds: [18, 20, 19] },
  { sect: Sect.Ming, name: "范遥",     hp: 170, atk: 115, def: 68, spd: 92,  crit: 1700, skillIds: [20, 18, 19] },
  { sect: Sect.Ming, name: "韦一笑",   hp: 160, atk: 118, def: 60, spd: 105, crit: 2100, skillIds: [19, 20, 18] },
];

// ── Stage / chapter config ──────────────────────────────────────────────────

interface StageDef {
  id: string;               // "1-1" etc.
  chapter: number;
  stageIdx: number;         // 1..4
  name: string;
  diff: string;
  stars: string;
  boss: string;
  isChapterBoss: boolean;   // stage 4 of each chapter
  bossTeam: Hero[];
}

interface ChapterDef {
  id: number;
  name: string;
  minRep: number;
  stages: StageDef[];
}

const mkHero = (tokenId: bigint, sect: Sect, name: string, hp: number, atk: number, def: number, spd: number, crit: number, skillIds: number[]): Hero =>
  ({ tokenId, sect, name, hp, atk, def, spd, crit, skillIds });

// Mock 剧情与链上 `StageRegistry` 初始 seed (contracts/script/SeedStages.sol)
// 对齐: 三章 × 四关 = 12 关,分别 "初入江湖 / 门派恩怨 / 魔教来袭"。
const CHAPTERS: ChapterDef[] = [
  {
    id: 1,
    name: "初入江湖",
    minRep: 0,
    stages: [
      {
        id: "1-1", chapter: 1, stageIdx: 1, name: "少林试炼", diff: "简单", stars: "⭐",
        boss: "少林三武僧", isChapterBoss: false,
        bossTeam: [
          mkHero(9101n, Sect.Shaolin, "圆智·武僧", 165, 72, 90, 55, 400, [0, 1, 2]),
          mkHero(9102n, Sect.Shaolin, "圆通·武僧", 172, 70, 92, 50, 350, [1, 0, 2]),
          mkHero(9103n, Sect.Shaolin, "圆觉·武僧", 156, 76, 86, 58, 500, [2, 0, 1]),
        ],
      },
      {
        id: "1-2", chapter: 1, stageIdx: 2, name: "唐门小试", diff: "简单", stars: "⭐",
        boss: "唐门幼师", isChapterBoss: false,
        bossTeam: [
          mkHero(9104n, Sect.Tangmen, "青翎·幼师", 110, 90, 45, 90, 2500, [3, 4, 5]),
          mkHero(9105n, Sect.Tangmen, "银蝶·幼师", 118, 88, 48, 85, 2200, [3, 5, 4]),
          mkHero(9106n, Sect.Tangmen, "雪雁·幼师", 114, 92, 46, 88, 2400, [4, 3, 5]),
        ],
      },
      {
        id: "1-3", chapter: 1, stageIdx: 3, name: "峨眉清谈", diff: "普通", stars: "⭐⭐",
        boss: "峨眉三女尼", isChapterBoss: false,
        bossTeam: [
          mkHero(9107n, Sect.Emei, "静玄·女尼", 135, 72, 56, 82, 1200, [6, 7, 8]),
          mkHero(9108n, Sect.Emei, "静虚·女尼", 140, 70, 58, 80, 1100, [7, 6, 8]),
          mkHero(9109n, Sect.Emei, "静寂·女尼", 130, 76, 54, 85, 1300, [8, 6, 7]),
        ],
      },
      {
        id: "1-4", chapter: 1, stageIdx: 4, name: "武当坐忘", diff: "BOSS", stars: "⭐⭐⭐",
        boss: "武当三道长 (章末 BOSS)", isChapterBoss: true,
        bossTeam: [
          // 武当 章末 BOSS: 均衡高 DEF 阵,用太极推手 (9) 叠 DEF + 梯云纵 (10) 叠 SPD,
          // 真武破军 (11, 140% ATK) 做主输出。少林/唐门/峨眉 都不克制武当,
          // 纯打属性对垒,考验玩家队形。
          mkHero(9110n, Sect.Wudang, "清风·道长", 185, 95, 102, 70, 700, [9, 10, 11]),
          mkHero(9111n, Sect.Wudang, "明月·道长", 180, 92, 108, 68, 650, [9, 10, 11]),
          mkHero(9112n, Sect.Wudang, "张松溪·道长", 190, 90, 100, 72, 750, [9, 11, 10]),
        ],
      },
    ],
  },
  {
    id: 2,
    name: "门派恩怨",
    minRep: 55,
    stages: [
      {
        id: "2-1", chapter: 2, stageIdx: 1, name: "丐帮争粥", diff: "普通", stars: "⭐⭐",
        boss: "丐帮舵主", isChapterBoss: false,
        bossTeam: [
          mkHero(9201n, Sect.Beggars, "刘舵主·长安", 205, 88, 82, 60, 400, [12, 13, 14]),
          mkHero(9202n, Sect.Beggars, "周舵主·洛阳", 212, 85, 85, 58, 350, [12, 14, 13]),
          mkHero(9203n, Sect.Beggars, "郑舵主·汴京", 208, 87, 83, 62, 380, [13, 12, 14]),
        ],
      },
      {
        id: "2-2", chapter: 2, stageIdx: 2, name: "华山论剑", diff: "困难", stars: "⭐⭐⭐",
        boss: "华山剑冢三客", isChapterBoss: false,
        bossTeam: [
          mkHero(9204n, Sect.Huashan, "岳不群·剑客", 132, 112, 56, 102, 2800, [15, 16, 17]),
          mkHero(9205n, Sect.Huashan, "左冷禅·剑客", 138, 108, 60, 100, 2600, [17, 15, 16]),
          mkHero(9206n, Sect.Huashan, "林震南·剑客", 128, 118, 52, 106, 3000, [15, 17, 16]),
        ],
      },
      {
        id: "2-3", chapter: 2, stageIdx: 3, name: "藏经阁守卫", diff: "困难", stars: "⭐⭐⭐",
        boss: "三派联守(少林/唐门/武当)", isChapterBoss: false,
        bossTeam: [
          // 多派系混编 — 考验玩家应对不同类型敌人。包括 Shaolin (tanky)
          // + Tangmen (burst) + Wudang (counter)。
          mkHero(9207n, Sect.Shaolin, "守阁罗汉", 220, 92, 118, 58, 400, [0, 1, 2]),
          mkHero(9208n, Sect.Tangmen, "暗堂巡哨", 138, 108, 55, 95, 2800, [3, 4, 5]),
          mkHero(9209n, Sect.Wudang,  "协防道长", 195, 96, 105, 70, 800, [9, 10, 11]),
        ],
      },
      {
        id: "2-4", chapter: 2, stageIdx: 4, name: "唐门暗堂", diff: "BOSS", stars: "⭐⭐⭐⭐",
        boss: "唐门掌灯人 + 明教死士 (章末 BOSS)", isChapterBoss: true,
        bossTeam: [
          // 唐门掌灯 × 2 打爆发,配一个明教死士提前预告第 3 章反派。
          // Tangmen + Ming 的联手让毒 DOT 堆满: 毒针 (5) + 毒沙掌 (20)。
          mkHero(9210n, Sect.Tangmen, "掌灯人·甲", 152, 116, 55, 102, 3200, [3, 4, 5]),
          mkHero(9211n, Sect.Tangmen, "掌灯人·乙", 148, 120, 50, 104, 3400, [3, 4, 5]),
          mkHero(9212n, Sect.Ming,    "明教·死士", 140, 110, 45, 90, 2000, [18, 19, 20]),
        ],
      },
    ],
  },
  {
    id: 3,
    name: "魔教来袭",
    minRep: 130,
    stages: [
      {
        id: "3-1", chapter: 3, stageIdx: 1, name: "光明顶前哨", diff: "困难", stars: "⭐⭐⭐",
        boss: "明教·铁冠道人", isChapterBoss: false,
        bossTeam: [
          mkHero(9301n, Sect.Ming, "铁冠·五散", 158, 106, 62, 86, 1900, [18, 19, 20]),
          mkHero(9302n, Sect.Ming, "冷谦·五散", 152, 110, 58, 88, 2100, [18, 19, 20]),
          mkHero(9303n, Sect.Ming, "彭莹玉·五散", 148, 114, 54, 90, 2300, [18, 19, 20]),
        ],
      },
      {
        id: "3-2", chapter: 3, stageIdx: 2, name: "四大护教法王", diff: "地狱", stars: "⭐⭐⭐⭐",
        boss: "紫衫 + 金毛 + 华山客", isChapterBoss: false,
        bossTeam: [
          // 紫衫龙王 (Ming, 高 HP 爆发) + 金毛狮王 (Ming, 顶端输出) + 华山剑客
          // 做加成 — 考验队伍的 burst 抗性。
          mkHero(9304n, Sect.Ming,    "紫衫·法王",   170, 122, 68, 94, 2900, [18, 19, 20]),
          mkHero(9305n, Sect.Ming,    "金毛·法王",   175, 118, 72, 92, 2600, [18, 19, 20]),
          mkHero(9306n, Sect.Huashan, "剑魔·同盟",   142, 120, 56, 106, 3100, [15, 16, 17]),
        ],
      },
      {
        id: "3-3", chapter: 3, stageIdx: 3, name: "圣女劝降", diff: "地狱", stars: "⭐⭐⭐⭐",
        boss: "明教圣女 + 丐帮长老 + 峨眉宿敌", isChapterBoss: false,
        bossTeam: [
          // 圣女是主C, 丐帮长老扛线, 峨眉宿敌治疗 — 持久战, 不是速攻能赢的。
          mkHero(9307n, Sect.Ming,    "明教·圣女",   182, 128, 72, 100, 3100, [18, 19, 20]),
          mkHero(9308n, Sect.Beggars, "丐帮·长老",   225, 102, 96, 66, 550, [12, 13, 14]),
          mkHero(9309n, Sect.Emei,    "峨眉·宿敌",   152, 88, 72, 88, 1600, [6, 7, 8]),
        ],
      },
      {
        id: "3-4", chapter: 3, stageIdx: 4, name: "教主决战", diff: "BOSS", stars: "⭐⭐⭐⭐⭐",
        boss: "明教教主 + 护法 + 叛变武当 (章末 BOSS)", isChapterBoss: true,
        bossTeam: [
          // 明教教主持乾坤大挪移 (19, +50% crit) 爆发, 护法 Ming + 叛变武当
          // 道长 (counter-buff) 做坦。全场最硬,声望门槛 240。
          mkHero(9310n, Sect.Ming,    "明教·教主",   225, 142, 82, 108, 3600, [18, 19, 20]),
          mkHero(9311n, Sect.Ming,    "护教·法王",   218, 136, 78, 110, 3400, [18, 19, 20]),
          mkHero(9312n, Sect.Wudang,  "叛变·道长",   202, 120, 112, 86, 1200, [9, 10, 11]),
        ],
      },
    ],
  },
];

const STAGE_BY_ID: Map<string, StageDef> = new Map();
for (const ch of CHAPTERS) for (const s of ch.stages) STAGE_BY_ID.set(s.id, s);

function chapterOf(stageId: string): ChapterDef | undefined {
  return CHAPTERS.find(c => c.stages.some(s => s.id === stageId));
}

// Accept "1-1" or legacy "1" (map to "1-1")
function normalizeStageId(raw: string): string | null {
  if (!raw) return null;
  if (/^\d+-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= CHAPTERS.length) return `${n}-1`;
    // legacy single-stage index (1..12) fallback
    if (n >= 1 && n <= 12) {
      const ch = Math.ceil(n / 4);
      const st = ((n - 1) % 4) + 1;
      return `${ch}-${st}`;
    }
  }
  return null;
}

// ── Team helpers ────────────────────────────────────────────────────────────

function defaultActiveTeam(heroes: Hero[]): bigint[] {
  return heroes.slice(-3).map(h => h.tokenId);
}

function resolveActiveTeam(state: GameState): Hero[] {
  const ids = state.activeTeam.length === 3 ? state.activeTeam : defaultActiveTeam(state.heroes);
  const byId = new Map(state.heroes.map(h => [h.tokenId.toString(), h]));
  const resolved = ids.map(id => byId.get(id.toString())).filter((h): h is Hero => !!h);
  return resolved;
}

function getHealth(state: GameState, tokenId: bigint): HeroHealth {
  const k = tokenId.toString();
  return state.heroHealth[k] ?? { woundLevel: 0, cooldownUntil: 0, potionCount: 0 };
}

function isWounded(state: GameState, tokenId: bigint, now: number = Date.now()): boolean {
  return getHealth(state, tokenId).cooldownUntil > now;
}

function checkTeamFit(state: GameState, team: Hero[]): string | null {
  const now = Date.now();
  const wounded = team.filter(h => isWounded(state, h.tokenId, now));
  if (wounded.length === 0) return null;
  const lines = wounded.map(h => {
    const secs = Math.max(0, Math.ceil((getHealth(state, h.tokenId).cooldownUntil - now) / 1000));
    return `   ⚕️ ${SECT_NAMES[h.sect]}·${h.name} #${h.tokenId}  还需 ${secs}s 恢复`;
  });
  return ["⚠️ 出战阵容中有侠客正在伤病恢复,无法出战:", ...lines, "请先「组队」换人,或等待恢复。"].join("\n");
}

function applyDefeatWounds(state: GameState, team: Hero[], isChapterBoss: boolean): Hero[] {
  const now = Date.now();
  const alive = [...team];
  const victims: Hero[] = [];
  const count = isChapterBoss ? 2 : 1;
  const level: 1 | 2 = isChapterBoss ? 2 : 1;
  for (let i = 0; i < count && alive.length > 0; i++) {
    const idx = Math.floor(Math.random() * alive.length);
    const h = alive.splice(idx, 1)[0]!;
    victims.push(h);
    const prev = getHealth(state, h.tokenId);
    const prevRemaining = Math.max(0, prev.cooldownUntil - now);
    const add = 12 * 3600 * 1000 * level;
    state.heroHealth[h.tokenId.toString()] = {
      woundLevel: level,
      cooldownUntil: now + prevRemaining + add,
      potionCount: prev.potionCount,
    };
  }
  return victims;
}

interface DropRollResult {
  drop: { hero: Hero; skillId: number } | null;
  roll: number;       // 1..100
  threshold: number;  // 20 + pity
  pityBefore: number;
  pityAfter: number;
}

function maybeDropSkillBead(state: GameState, team: Hero[]): DropRollResult {
  const pity = Math.max(0, Math.min(80, state.pityBonus ?? 0));
  const threshold = Math.min(100, 20 + pity);
  const roll = Math.floor(Math.random() * 100) + 1; // 1..100
  if (roll > threshold) {
    const next = Math.min(80, pity + 5);
    state.pityBonus = next;
    return { drop: null, roll, threshold, pityBefore: pity, pityAfter: next };
  }
  const pool = [9, 10, 11];
  const skillId = pool[Math.floor(Math.random() * pool.length)]!;
  const recipient = team[Math.floor(Math.random() * team.length)]!;
  const k = recipient.tokenId.toString();
  state.skillBeads[k] = [...(state.skillBeads[k] ?? []), skillId];
  state.pityBonus = 0;
  return { drop: { hero: recipient, skillId }, roll, threshold, pityBefore: pity, pityAfter: 0 };
}

// ── Onchain helpers ─────────────────────────────────────────────────────────

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const delays = [1000, 2000, 4000];
  let lastErr: unknown;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`⚠️  ${label} 第 ${attempt + 1} 次失败: ${msg}\n`);
      if (attempt < delays.length - 1) {
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Mirror one onchain write with retry; failures never propagate, instead
// return a ⚠️ line so the local battle report still renders fully.
async function tryMirror(label: string, fn: () => Promise<`0x${string}`>): Promise<string | null> {
  try {
    const txHash = await withRetry(label, fn);
    return `🔗 ${label} tx: ${txHash}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `⚠️ ${label} 写链失败 (本地战报已记录): ${msg}`;
  }
}

interface PveMirrorArgs {
  stageTag: string;
  winner: 0 | 1 | 2;
  bossId: number;
  lossLevel: 1 | 2;
  lossVictims: Hero[];
  winDrop: { hero: Hero; skillId: number } | null;  // null = didn't drop
}

async function mirrorPveOnchain(state: GameState, args: PveMirrorArgs): Promise<string[]> {
  const lines: string[] = [];
  const player = await ensurePlayerAddress(state);
  const { encodeFunctionData } = await import("viem");
  const { arenaAbi, heroNftAbi } = await import("./chain/abi.js");
  const { getAddresses } = await import("./chain/client.js");
  const { signAndSend } = await import("./onchainos/gateway.js");
  const { arena, hero } = getAddresses();

  if (args.winner === 0) {
    // `completeStage` is admin-only (`onlyGame`). The skill used to run the
    // battle locally and then ask the game-authority oracle to mirror the
    // clear on chain. That model doesn't work for sepolia-direct mode
    // (player's key isn't the game authority), so we skip the mirror in
    // that branch — Arena v3's `startPve` already advances storyProgress
    // automatically when called by the player.
    //
    // For legacy OnchainOS mode, keep the old mirror path: the Paymaster-
    // sponsored oracle is the authority.
    if (getMode() === "onchain") {
      const data = encodeFunctionData({
        abi: arenaAbi,
        functionName: "completeStage",
        args: [player, args.bossId],
      });
      const line = await tryMirror(`completeStage(${args.stageTag})`, async () => {
        const { txHash } = await signAndSend({ to: arena, data, from: player });
        return txHash;
      });
      if (line) lines.push(line);
    } else if (getMode() === "sepolia") {
      // Real on-chain battle via player-signed startPve. The local-sim result
      // was just for storytelling UX; this is the source of truth.
      const stageNum = parseInt(args.stageTag.split("-").pop() ?? "1", 10) || 1;
      const team = state.activeTeam.slice(0, 3) as [bigint, bigint, bigint];
      if (team.length === 3 && team.every(x => x > 0n)) {
        const data = encodeFunctionData({
          abi: arenaAbi,
          functionName: "startPve",
          args: [team, stageNum],
        });
        const line = await tryMirror(`startPve(${args.stageTag}, on-chain)`, async () => {
          const { txHash } = await signAndSend({ to: arena, data, from: player, gasLimit: 4_000_000 });
          return txHash;
        });
        if (line) lines.push(line);
      }
    }

    if (args.winDrop) {
      const drop = args.winDrop;
      const dropData = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "unlockSkill",
        args: [drop.hero.tokenId, drop.skillId],
      });
      const dropLine = await tryMirror(
        `unlockSkill(#${drop.hero.tokenId}, ${drop.skillId})`,
        async () => {
          const { txHash } = await signAndSend({ to: hero, data: dropData, from: player });
          return txHash;
        },
      );
      if (dropLine) lines.push(dropLine);
    }
  } else if (args.winner === 1 && args.lossVictims.length > 0) {
    const woundLines = await mirrorWoundsOnchain(state, args.lossVictims, args.lossLevel);
    for (const l of woundLines) lines.push(l);
  }
  return lines;
}

async function mirrorWoundsOnchain(state: GameState, victims: Hero[], level: 1 | 2): Promise<string[]> {
  const lines: string[] = [];
  const player = await ensurePlayerAddress(state);
  const { encodeFunctionData } = await import("viem");
  const { heroNftAbi } = await import("./chain/abi.js");
  const { getAddresses } = await import("./chain/client.js");
  const { signAndSend } = await import("./onchainos/gateway.js");
  const { hero } = getAddresses();

  for (const v of victims) {
    const data = encodeFunctionData({
      abi: heroNftAbi,
      functionName: "setWound",
      args: [v.tokenId, level],
    });
    const line = await tryMirror(`setWound(#${v.tokenId}, lv${level})`, async () => {
      const { txHash } = await signAndSend({ to: hero, data, from: player });
      return txHash;
    });
    if (line) lines.push(line);
  }
  return lines;
}

async function ensurePlayerAddress(state: GameState): Promise<`0x${string}`> {
  if (state.playerAddress && /^0x[0-9a-fA-F]{40}$/.test(state.playerAddress)) {
    return state.playerAddress;
  }
  const envAddr = process.env.XIAKE_PLAYER_ADDRESS;
  if (envAddr && /^0x[0-9a-fA-F]{40}$/.test(envAddr)) {
    state.playerAddress = envAddr as `0x${string}`;
    saveState(state);
    return state.playerAddress;
  }

  // In sepolia-direct mode, derive the address from the local private key
  // — no OnchainOS MPC wallet involved.
  if (getMode() === "sepolia") {
    const { getPlayerAddress } = await import("./chain/directSigner.js");
    state.playerAddress = getPlayerAddress();
    saveState(state);
    return state.playerAddress;
  }

  const { createHash } = await import("node:crypto");
  const { createWalletAccount, getWalletAccount } = await import("./onchainos/wallet.js");
  const accountId = process.env.XIAKE_PLAYER_ID
    ?? `xiake-cli-${createHash("sha256").update(process.env.USERPROFILE ?? process.env.HOME ?? "local").digest("hex").slice(0, 16)}`;
  const existing = await getWalletAccount(accountId).catch(() => null);
  const account = existing ?? await createWalletAccount({ accountId });
  state.playerAddress = account.address as `0x${string}`;
  saveState(state);
  return state.playerAddress;
}

// ── Achievements / replay / season helpers ─────────────────────────────────

const HISTORY_CAP = 20;

function computeBattleMvp(
  events: BattleEvent[],
  playerTeam: Hero[],
  opponentTeam: Hero[],
): { idx: number; name: string } | null {
  const all = [...playerTeam, ...opponentTeam];
  const dmgByActor = new Map<number, number>();
  for (const e of events) {
    if (e.hpDelta < 0) dmgByActor.set(e.actorIdx, (dmgByActor.get(e.actorIdx) ?? 0) + Math.abs(e.hpDelta));
  }
  const top = [...dmgByActor.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const h = all[top[0]];
  const nm = h ? `${SECT_NAMES[h.sect]}·${h.name}` : `#${top[0]}`;
  return { idx: top[0], name: nm };
}

function recordBattle(
  state: GameState,
  entry: Omit<BattleHistoryEntry, "timestamp"> & { timestamp?: number },
): void {
  const ts = entry.timestamp ?? Date.now();
  let mvpIdx = entry.mvpIdx;
  let mvpName = entry.mvpName;
  if ((mvpIdx === undefined || mvpName === undefined) && entry.events && entry.playerTeam && entry.opponentTeam) {
    const mvp = computeBattleMvp(entry.events, entry.playerTeam, entry.opponentTeam);
    if (mvp) { mvpIdx = mvp.idx; mvpName = mvp.name; }
  }
  state.battleHistory.push({ ...entry, timestamp: ts, mvpIdx, mvpName });
  if (state.battleHistory.length > HISTORY_CAP) {
    state.battleHistory.splice(0, state.battleHistory.length - HISTORY_CAP);
  }
}

interface AchievementCtx {
  kind?: "pve" | "pvp" | "arena" | "mint";
  stageId?: string;
  isChapterBoss?: boolean;
  playerWon?: boolean;
  playerTeam?: Hero[];
  events?: BattleEvent[];
  playerDeaths?: number;
}

function setAchievement(state: GameState, id: string, earned: boolean, progress: number, unlocked: string[]): void {
  const now = Date.now();
  const cur = state.achievements[id] ?? { earned: false, progress: 0, unlockedAt: 0 };
  const next: AchievementState = {
    earned: earned || cur.earned,
    progress: Math.max(cur.progress, progress),
    unlockedAt: cur.unlockedAt || (earned ? now : 0),
  };
  if (!cur.earned && next.earned) unlocked.push(id);
  state.achievements[id] = next;
}

// Evaluate every achievement from current state. Returns list of ids newly
// unlocked in this call (for toast-style banner in the caller).
function checkAchievements(state: GameState, ctx: AchievementCtx = {}): string[] {
  const unlocked: string[] = [];

  // first_mint: any hero owned
  if (state.heroes.length > 0) {
    setAchievement(state, "first_mint", true, 1, unlocked);
  }
  // three_sects: all 3 sects in roster
  const sects = new Set(state.heroes.map(h => h.sect));
  if (sects.size >= 3) setAchievement(state, "three_sects", true, Math.min(3, sects.size), unlocked);
  else setAchievement(state, "three_sects", false, sects.size, unlocked);
  // seven_sects: full 7-sect collection
  if (sects.size >= 7) setAchievement(state, "seven_sects", true, 1, unlocked);
  else setAchievement(state, "seven_sects", false, sects.size, unlocked);

  // first_kill: any KILL flag seen in this battle
  if (ctx.events && ctx.events.some(e => hasFlag(e.flags, FLAG_KILL))) {
    setAchievement(state, "first_kill", true, 1, unlocked);
  }
  // first_pve: any pve win
  if (ctx.kind === "pve" && ctx.playerWon) {
    setAchievement(state, "first_pve", true, 1, unlocked);
  }
  // first_boss: chapter boss win
  if (ctx.kind === "pve" && ctx.playerWon && ctx.isChapterBoss) {
    setAchievement(state, "first_boss", true, 1, unlocked);
  }
  // first_arena: arena win
  if (ctx.kind === "arena" && ctx.playerWon) {
    setAchievement(state, "first_arena", true, 1, unlocked);
  }
  // crit_master: ≥3 crits from player side in one battle
  if (ctx.events && ctx.playerTeam) {
    let crits = 0;
    for (const e of ctx.events) {
      if (e.actorIdx < ctx.playerTeam.length && hasFlag(e.flags, FLAG_CRIT)) crits++;
    }
    if (crits >= 3) setAchievement(state, "crit_master", true, 1, unlocked);
  }
  // skill_bead_collector: total beads ≥ 5
  const beadCount = Object.values(state.skillBeads).reduce((s, arr) => s + arr.length, 0);
  if (beadCount >= 5) setAchievement(state, "skill_bead_collector", true, beadCount, unlocked);
  else setAchievement(state, "skill_bead_collector", false, beadCount, unlocked);
  // no_deaths_stage: win PVE without any player death
  if (ctx.kind === "pve" && ctx.playerWon && (ctx.playerDeaths ?? 1) === 0) {
    setAchievement(state, "no_deaths_stage", true, 1, unlocked);
  }
  // chapter1_clear: all 4 chapter-1 stages cleared
  const ch1 = ["1-1", "1-2", "1-3", "1-4"];
  const ch1Done = ch1.filter(s => state.clearedStages.includes(s)).length;
  if (ch1Done >= 4) setAchievement(state, "chapter1_clear", true, ch1Done, unlocked);
  else setAchievement(state, "chapter1_clear", false, ch1Done, unlocked);

  return unlocked;
}

function renderUnlockBanner(unlocked: string[]): string[] {
  if (unlocked.length === 0) return [];
  const out: string[] = [];
  for (const id of unlocked) {
    const def = ACHIEVEMENT_BY_ID.get(id);
    if (!def) continue;
    out.push(`🎖️ 成就解锁: ${def.name} — ${def.desc}`);
  }
  return out;
}

function countPlayerDeaths(events: BattleEvent[], playerTeam: Hero[]): number {
  const playerLen = playerTeam.length;
  let deaths = 0;
  for (const e of events) {
    if (hasFlag(e.flags, FLAG_KILL) && e.targetIdx < playerLen) deaths++;
  }
  return deaths;
}

// Season end check: if current season expired, clip reputation by 50%,
// advance counter, reset pity, mock-award lastRank (top 100 bucket).
function checkSeasonEnd(state: GameState): { rolled: boolean; note?: string } {
  const now = Date.now();
  if (now < state.season.endsAt) return { rolled: false };
  const prev = state.season.current;
  const halved = Math.floor(state.reputation * 0.5);
  state.reputation = halved;
  state.pityBonus = 0;
  // Mock lastRank: deterministic bucket based on reputation before halving.
  const mockRank = Math.max(1, 101 - Math.min(100, Math.floor(halved / 20) + 1));
  state.season = newSeason(prev + 1, now);
  state.season.lastRank = mockRank;
  return { rolled: true, note: `⚠️ 赛季 ${prev} 结束,声望清零 50% → ${halved},上赛季排名 #${mockRank}` };
}

// ── Commands ────────────────────────────────────────────────────────────────

function cmdInit(): string {
  const mode = getMode();
  const state = loadState();
  const seasonRoll = checkSeasonEnd(state);
  if (seasonRoll.rolled) saveState(state);
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push("╔══════════════════════════════════════════════════╗");
  lines.push("║          ⚔️  侠  客  擂  台  ⚔️                ║");
  lines.push("║     The first game built for AI, not humans     ║");
  lines.push("╚══════════════════════════════════════════════════╝");
  if (seasonRoll.note) {
    lines.push(seasonRoll.note);
    lines.push("");
  }
  lines.push("");

  if (state.heroes.length === 0) {
    lines.push("🎭 你是一位初入江湖的侠客,尚无门徒。");
    lines.push("");
    lines.push("👉 下一步: 说「招募侠客」");
  } else {
    const active = resolveActiveTeam(state);
    const activeIds = new Set(active.map(h => h.tokenId.toString()));
    const now = Date.now();
    lines.push(`🏯 你的江湖  |  声望: ${state.reputation}  |  侠客: ${state.heroes.length} 位`);
    lines.push("─".repeat(50));
    for (const h of state.heroes) {
      const sect = SECT_NAMES[h.sect];
      const icon = SECT_ICON[h.sect] ?? "⚔️";
      const star = activeIds.has(h.tokenId.toString()) ? " ⭐" : "";
      const wound = isWounded(state, h.tokenId, now) ? " ⚕️" : "";
      lines.push(`  ${icon} ${sect}·${h.name} #${h.tokenId}  HP${h.hp} ATK${h.atk} DEF${h.def} SPD${h.spd} CRT${(h.crit/100).toFixed(1)}%${star}${wound}`);
    }
    lines.push("");
    lines.push("📜 可用指令:");
    lines.push("  ⚔️  闯关       — 说「闯第1-1关」(12 关,3 章节)");
    lines.push("  🏯 擂台 BOSS   — 说「擂台」/「擂台 guo-jing」(声望 ≥ 50)");
    lines.push("  🤖 AI对战      — 说「AI对战」");
    lines.push("  🗡️ [5] 挑战擂台 — 说「查看擂台榜」/「挑战 <address>」");
    lines.push("  🌙 AI 修行      — 说「修行」/「自动打 5 场」");
    lines.push("  👥 查看侠客    — 说「查看侠客」");
    lines.push("  🎯 组队出战    — 说「组队 <id> <id> <id>」");
    lines.push("  📋 关卡列表    — 说「查看关卡」");
    lines.push("  ⚕️ 伤病情况    — 说「查看伤病」");
    lines.push("  🎁 装备技能珠  — 说「装备 <heroId> <slot> <skillId>」");
  }

  return lines.join("\n");
}

// Price per paid mint — 0.005 ETH. Mirrors PRICE_PER_MINT in the Week 4 contract.
// Wave 2: silver is the default (legacy single-tier price); bronze / gold were
// introduced in HeroNFT v2 along with the 10-连 折扣 and pity thresholds.
const PAID_MINT_PRICE_ETH = 0.005;
const PAID_MINT_PRICE_WEI = 5_000_000_000_000_000n; // 0.005 * 1e18

type MintTier = "bronze" | "silver" | "gold";
const TIER_PRICE_ETH: Record<MintTier, number> = {
  bronze: 0.001,
  silver: 0.005,
  gold:   0.010,
};
const TIER_PRICE_WEI: Record<MintTier, bigint> = {
  bronze: 1_000_000_000_000_000n,
  silver: 5_000_000_000_000_000n,
  gold:   10_000_000_000_000_000n,
};
const TIER_INDEX: Record<MintTier, 0 | 1 | 2> = { bronze: 0, silver: 1, gold: 2 };
const TIER_LABEL: Record<MintTier, string> = {
  bronze: "🥉 青铜",
  silver: "🥈 白银",
  gold:   "🥇 黄金",
};

// Pity / referral constants — must mirror HeroNFT.SECT_PITY_THRESHOLD etc.
const SECT_PITY_THRESHOLD = 30;
const BOSS_PITY_THRESHOLD = 80;
const TEN_PULL_DISCOUNT_BPS = 9000;   // 90% of sticker price
const SHARDS_PER_DUPLICATE = 5;
const SHARDS_PER_PITY_BOOST = 5;
const REFERRAL_REWARD_ETH = 0.002;
const SECT_CYCLE_NAMES = ["少林", "唐门", "峨眉"] as const;  // v3: 武当 (mod 3 以内仍是 3 派)

function parseTier(args: readonly string[]): MintTier {
  const idx = args.indexOf("--tier");
  if (idx < 0) return "silver";
  const raw = args[idx + 1];
  if (raw === "bronze" || raw === "silver" || raw === "gold") return raw;
  return "silver";
}

function tierPriceWei(tier: MintTier, count: number): bigint {
  const sticker = TIER_PRICE_WEI[tier] * BigInt(count);
  if (count === 10) return (sticker * BigInt(TEN_PULL_DISCOUNT_BPS)) / 10000n;
  return sticker;
}

function tierPriceEth(tier: MintTier, count: number): number {
  const sticker = TIER_PRICE_ETH[tier] * count;
  if (count === 10) return sticker * (TEN_PULL_DISCOUNT_BPS / 10000);
  return sticker;
}

async function cmdMint(
  countArg?: string,
  options?: { paid?: boolean; dryRun?: boolean; tier?: MintTier },
): Promise<string> {
  const mode = getMode();
  const state = loadState();

  let count = countArg ? parseInt(countArg, 10) : 3;
  if (!Number.isFinite(count) || count < 1) count = 3;
  if (count > 10) count = 10; // Hard limit for paid mint

  const isPaid = options?.paid ?? false;
  const isDryRun = options?.dryRun ?? false;
  const tier: MintTier = options?.tier ?? "silver";
  const tenPull = count === 10;

  // dry-run: preview only, never mutate state / submit tx.
  if (isDryRun) {
    const totalEth = tierPriceEth(tier, count).toFixed(4);
    const totalWei = tierPriceWei(tier, count);
    const unitEth = TIER_PRICE_ETH[tier];
    const lines: string[] = [];
    lines.push(`🔗 模式: ${mode}`);
    lines.push(`🔍 付费抽卡预览 (${tier} · ${count} 次)`);
    lines.push("─".repeat(50));
    lines.push(`档位: ${TIER_LABEL[tier]}  单价: ${unitEth} ETH/次`);
    if (tenPull) lines.push(`💰 十连特惠 -10% (${(unitEth * 10).toFixed(4)} → ${totalEth} ETH)`);
    lines.push(`合计: ${totalEth} ETH (${totalWei} wei)`);
    lines.push(`Paymaster: 绕过 (bypassPaymaster=true),玩家钱包直接支付 ETH + gas`);

    if (mode === "onchain" || mode === "sepolia") {
      try {
        const player = await ensurePlayerAddress(state);
        const { getPublicClient } = await import("./chain/client.js");
        const { heroNftAbi } = await import("./chain/abi.js");
        const { getAddresses } = await import("./chain/client.js");
        const pc = getPublicClient();
        const { hero } = getAddresses();
        const balance = await pc.getBalance({ address: player });
        const balanceEth = Number(balance) / 1e18;
        lines.push(`钱包余额: ${balanceEth.toFixed(4)} ETH (${player})`);
        if (balance < totalWei) {
          lines.push(`⚠️  余额不足,还差 ${((Number(totalWei) - Number(balance)) / 1e18).toFixed(4)} ETH`);
        }
        // 尝试读链上额度,读不到也不报错(合约可能还没部署)
        try {
          const allowanceTuple = await pc.readContract({
            address: hero,
            abi: heroNftAbi,
            functionName: "getMintAllowance",
            args: [player],
          }) as readonly [number, number, number, number, number];
          const [free, boss, daily, paid, remaining] = allowanceTuple;
          lines.push(`链上额度: free=${free} boss=${boss} daily=${daily} paid=${paid} remaining=${remaining}`);
        } catch {
          lines.push(`链上额度: (合约尚未部署 Week 4 合约或 RPC 未响应,跳过)`);
        }
      } catch (err) {
        lines.push(`⚠️  预览读链失败: ${(err as Error).message}`);
      }
    } else {
      lines.push(`免费额度: ${state.allowance.free}/5 (BOSS 奖励 +${state.allowance.bossRewards}, 日登 +${state.allowance.dailyRewards})`);
    }

    lines.push("");
    lines.push(`确认下单: node dist/cli.js mint paid ${count}`);
    return lines.join("\n");
  }

  // Free/paid bookkeeping (mock mode) — onchain reads allowance directly.
  const freeAllowance = state.allowance.free;
  const freeMints = isPaid ? 0 : Math.min(count, freeAllowance);

  if (!isPaid && freeAllowance <= 0) {
    const ethNeeded = tierPriceEth(tier, count).toFixed(4);
    return `🔒 本周免费额度已用完,下次 BOSS 击败可得 +1 额度。\n快速补充: \`mint paid ${count} --tier ${tier}\` (需要 ${ethNeeded} ETH)`;
  }

  let newHeroes: Hero[];
  let chainPaidCost: string | null = null;
  const bossBeadEvents: number[] = [];
  const forcedSectFires: Array<{ atIndex: number; sect: number }> = [];
  let referralJustFired = false;

  if (mode === "onchain" || mode === "sepolia") {
    const player = await ensurePlayerAddress(state);
    const { encodeFunctionData } = await import("viem");
    const { heroNftAbi } = await import("./chain/abi.js");
    const { getAddresses, getPublicClient } = await import("./chain/client.js");
    const { signAndSend } = await import("./onchainos/gateway.js");
    const { fetchOwnedHeroIds, fetchHeroes } = await import("./chain/reads.js");

    const { hero } = getAddresses();
    // Wave 2: mintHeroTier (tier + 10-pull discount + referral reward).
    const data = encodeFunctionData({
      abi: heroNftAbi,
      functionName: "mintHeroTier",
      args: [player, count, isPaid, TIER_INDEX[tier]],
    });

    // Paid mint: bypassPaymaster + value; free mint: normal paymaster path.
    const value = isPaid ? tierPriceWei(tier, count).toString() : undefined;

    const { txHash } = await withRetry(
      isPaid ? `mintHeroTier(${tier}, paid)` : `mintHeroTier(${tier}, free)`,
      async () => signAndSend({ to: hero, data, from: player, value, bypassPaymaster: isPaid }),
    );
    await withRetry("等待交易上链", () =>
      getPublicClient().waitForTransactionReceipt({ hash: txHash }),
    );

    const ownedIds = await withRetry("查询英雄列表", () => fetchOwnedHeroIds(player));
    const known = new Set(state.heroes.map(h => h.tokenId.toString()));
    const freshIds = ownedIds.filter(id => !known.has(id.toString()));
    const fetched = freshIds.length > 0 ? await fetchHeroes(freshIds) : [];
    newHeroes = fetched;
    state.heroes = [...state.heroes, ...newHeroes];

    // Read back authoritative pity so the UI matches on-chain state.
    try {
      const pity = await getPublicClient().readContract({
        address: hero,
        abi: heroNftAbi,
        functionName: "getPityProgress",
        args: [player],
      }) as readonly [number, number, number];
      state.pityProgress = {
        currentCount: Number(pity[0]),
        sectCycle: Number(pity[1]),
        bossPityCount: Number(pity[2]),
      };
    } catch {
      // Swallow: if the Wave 2 contract isn't deployed yet, keep local snapshot.
    }

    if (isPaid) chainPaidCost = `${tierPriceEth(tier, count).toFixed(4)} ETH (tx: ${txHash})`;
  } else {
    const nextId = state.heroes.reduce((m, h) => (h.tokenId > m ? h.tokenId : m), 0n) + 1n;
    newHeroes = [];
    const pity = { ...state.pityProgress };

    // Step through each pull one-by-one so 30/80 thresholds fire mid-batch and
    // a sect-forced pull lands on the intended派系.
    for (let i = 0; i < count; i++) {
      const forceSect = pity.currentCount + 1 >= SECT_PITY_THRESHOLD
        ? (pity.sectCycle % 3) as 0 | 1 | 2
        : null;
      const heroesForGen = [...state.heroes, ...newHeroes];
      const one = generateHeroes(
        1,
        Date.now() + i * 7919,
        nextId + BigInt(newHeroes.length),
        heroesForGen,
        forceSect,
      )[0]!;
      newHeroes.push(one);

      // Mirror HeroNFT._bumpPity.
      const nextC = pity.currentCount + 1;
      if (nextC >= SECT_PITY_THRESHOLD) {
        forcedSectFires.push({ atIndex: i, sect: pity.sectCycle % 3 });
        pity.currentCount = 0;
        pity.sectCycle = (pity.sectCycle + 1) % 3;
      } else {
        pity.currentCount = nextC;
      }
      const nextBp = pity.bossPityCount + 1;
      if (nextBp >= BOSS_PITY_THRESHOLD) {
        bossBeadEvents.push(pity.sectCycle % 3);
        pity.bossPityCount = 0;
        // Drop a 限定 BOSS-signature bead (ids 12-16) on the triggering hero.
        const bossBeadPool = [12, 13, 14, 15, 16];
        const beadId = bossBeadPool[Math.floor(Math.random() * bossBeadPool.length)]!;
        const k = one.tokenId.toString();
        state.skillBeads[k] = [...(state.skillBeads[k] ?? []), beadId];
      } else {
        pity.bossPityCount = nextBp;
      }
    }
    state.pityProgress = pity;
    state.heroes = [...state.heroes, ...newHeroes];

    // mock: deduct free allowance for free mints; paid mints cost 0 ETH in mock.
    if (freeMints > 0) state.allowance.free = Math.max(0, state.allowance.free - freeMints);

    // Mock K-factor: on the referee's first paid mint, flag the referral
    // reward as paid so the mint result can surface a one-time UI line.
    // Actual settlement happens on-chain via `ReferralRewardGranted`.
    if (isPaid && state.referredBy && !state.referralPaid) {
      state.referralPaid = true;
      referralJustFired = true;
    }
  }

  state.activeTeam = defaultActiveTeam(state.heroes);
  saveState(state);

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  if (newHeroes.length === 0) {
    lines.push("ℹ️ 链上未返回新增侠客 (可能已达上限)。");
  } else {
    const payHint = isPaid
      ? (chainPaidCost ? ` · 付费 ${chainPaidCost}` : ` · 付费 ${tierPriceEth(tier, count).toFixed(4)} ETH`)
      : (freeMints > 0 ? ` · 免费 ${freeMints}/${count}` : "");
    const tierHint = isPaid ? ` · ${TIER_LABEL[tier]}` : "";
    lines.push(`🎉 招募成功!新增 ${newHeroes.length} 位豪杰 (累积 ${state.heroes.length} 位)${payHint}${tierHint}`);
    if (isPaid && tenPull) lines.push("💰 十连特惠 -10%");
  }
  lines.push("═".repeat(50));
  for (const h of newHeroes) {
    const sect = SECT_NAMES[h.sect];
    const icon = SECT_ICON[h.sect] ?? "⚔️";
    const skills = h.skillIds.map(id => SKILL_NAMES[id] ?? `技能#${id}`).join(" / ");
    lines.push("");
    lines.push(`  ${icon} ${sect}·${h.name}  #${h.tokenId}`);
    lines.push(`     ❤️ HP${h.hp}  ⚔️ ATK${h.atk}  🛡️ DEF${h.def}  💨 SPD${h.spd}  💥 CRT${(h.crit/100).toFixed(1)}%`);
    lines.push(`     🎯 ${skills}`);
    const beads = state.skillBeads[h.tokenId.toString()] ?? [];
    if (beads.length > 0) {
      const names = beads.map(id => SKILL_NAMES[id] ?? `#${id}`).join(", ");
      lines.push(`     🎁 技能珠: [${names}]`);
    }
  }
  lines.push("");
  lines.push("═".repeat(50));

  // Pity status — always render so players can track the 30/80 meters.
  const p = state.pityProgress;
  const nextSectName = SECT_CYCLE_NAMES[p.sectCycle % 3];
  lines.push("");
  lines.push(`[保底 ${p.currentCount}/${SECT_PITY_THRESHOLD} 距下一派系保底 → ${nextSectName}]`);
  lines.push(`[BOSS 保底 ${p.bossPityCount}/${BOSS_PITY_THRESHOLD}]`);
  for (const f of forcedSectFires) {
    lines.push(`🎯 30 抽派系保底触发!第 ${f.atIndex + 1} 抽强制 ${SECT_CYCLE_NAMES[f.sect]} 派系`);
  }
  if (bossBeadEvents.length > 0) {
    lines.push(`🏆 80 抽 BOSS 保底触发!获得限定 BOSS 签名技能珠 (见「查看侠客」)`);
  }
  if (referralJustFired && state.referredBy) {
    lines.push(`🤝 K 因子: 推荐人 ${state.referredBy} 获得 ${REFERRAL_REWARD_ETH} ETH 卡券 (首付费奖励)`);
  }
  lines.push("");
  lines.push(`🎯 当前出战阵容 (默认最新 3 位): ${state.activeTeam.map(id => `#${id}`).join(" ")}`);
  lines.push("   说「组队 <id> <id> <id>」可更换。");
  if (mode === "mock" && !isPaid) {
    lines.push(`   本周免费额度剩余: ${state.allowance.free}/5`);
  }
  if (mode === "mock") {
    lines.push(`   声望碎片: ${state.shards}  (${SHARDS_PER_PITY_BOOST} 碎片可加速保底 +1 → \`pity-boost\`)`);
  }
  lines.push("");
  lines.push("📋 开局推荐: 说「闯第1-1关」开始冒险!");

  return lines.join("\n");
}

function cmdTeam(args: string[]): string {
  const state = loadState();
  if (args.length !== 3) return "用法: team <id1> <id2> <id3> — 需要恰好 3 个 tokenId";
  let ids: bigint[];
  try {
    ids = args.map(a => BigInt(a));
  } catch {
    return `⚠️ tokenId 无法解析: ${args.join(" ")}`;
  }
  const owned = new Set(state.heroes.map(h => h.tokenId.toString()));
  const missing = ids.filter(id => !owned.has(id.toString()));
  if (missing.length > 0) return `⚠️ 以下 tokenId 不在你的侠客中: ${missing.map(id => `#${id}`).join(", ")}`;
  if (new Set(ids.map(id => id.toString())).size !== 3) return "⚠️ 3 位侠客不能重复";

  state.activeTeam = ids;
  saveState(state);

  const byId = new Map(state.heroes.map(h => [h.tokenId.toString(), h]));
  const lines: string[] = [];
  lines.push(`🎯 出战阵容已更新:`);
  for (const id of ids) {
    const h = byId.get(id.toString())!;
    const wound = isWounded(state, h.tokenId) ? " ⚕️" : "";
    lines.push(`   ${SECT_NAMES[h.sect]}·${h.name} #${h.tokenId}${wound}`);
  }
  return lines.join("\n");
}

function cmdHeroes(): string {
  const state = loadState();
  if (state.heroes.length === 0) return "你还没有侠客。说「招募侠客」开始。";

  const activeIds = new Set(resolveActiveTeam(state).map(h => h.tokenId.toString()));
  const now = Date.now();
  const lines: string[] = [];
  lines.push(`👥 你的侠客阵容 (⭐ = 出战, ⚕️ = 伤病中, 🎁 = 有技能珠)`);
  lines.push("─".repeat(50));
  let anyWounded = false;
  for (const h of state.heroes) {
    const sect = SECT_NAMES[h.sect];
    const icon = SECT_ICON[h.sect] ?? "⚔️";
    const skills = h.skillIds.map(id => SKILL_NAMES[id] ?? `#${id}`).join(" / ");
    const star = activeIds.has(h.tokenId.toString()) ? " ⭐" : "";
    const wounded = isWounded(state, h.tokenId, now);
    if (wounded) anyWounded = true;
    const wound = wounded ? " ⚕️" : "";
    const beads = state.skillBeads[h.tokenId.toString()] ?? [];
    const bead = beads.length > 0 ? " 🎁" : "";
    lines.push(`  ${icon} ${sect}·${h.name} #${h.tokenId}  HP${h.hp} ATK${h.atk} DEF${h.def} SPD${h.spd} CRT${(h.crit/100).toFixed(1)}%${star}${wound}${bead}`);
    lines.push(`     技能: ${skills}`);
    if (beads.length > 0) {
      const names = beads.map(id => SKILL_NAMES[id] ?? `#${id}`).join(", ");
      lines.push(`     🎁 技能珠: [${names}]`);
    }
    if (wounded) {
      const secs = Math.max(0, Math.ceil((getHealth(state, h.tokenId).cooldownUntil - now) / 1000));
      lines.push(`     ⚕️ 伤病恢复中: 还需 ${secs}s`);
    }
  }
  if (anyWounded && state.potions > 0) {
    lines.push(`💡 有 ${state.potions} 瓶金疮药,可说「疗伤 <id>」立即康复`);
  }
  return lines.join("\n");
}

function cmdStages(): string {
  const state = loadState();
  const lines: string[] = [];
  lines.push("📋 武林关卡 (声望 " + state.reputation + ")");
  lines.push("─".repeat(50));

  for (const ch of CHAPTERS) {
    const locked = state.reputation < ch.minRep;
    const header = locked
      ? `🔒 第${ch.id}章 ${ch.name}  (需声望 ${ch.minRep},当前 ${state.reputation})`
      : `📖 第${ch.id}章 ${ch.name}  (声望门槛 ${ch.minRep})`;
    lines.push(header);
    for (const s of ch.stages) {
      const cleared = state.clearedStages.includes(s.id) ? " ✅" : "";
      const bossMark = s.isChapterBoss ? " 👑" : "";
      lines.push(`   ${s.stars}  ${s.id} ${s.name} (${s.diff})${bossMark}${cleared}`);
      lines.push(`       BOSS: ${s.boss}`);
    }
    lines.push("");
  }
  lines.push("用法: 说「闯第1-1关」或 pve 1-1");
  return lines.join("\n");
}

// ── Layered battle report renderer (P0-1 / P1-4 / P1-7) ──────────────────
// Consumes simulateBattle output and renders according to mode:
//   lite  — lineup + MVP + outcome only
//   full  — per-round events + merged "拉锯" blocks + HP-bar snapshots
//   epic  — full + an opening narration per round

interface RoundSummary {
  round: number;
  events: BattleEvent[];
  hasKill: boolean;
  hasCrit: boolean;
  hpSwingPct: number;   // max |Δhp|/maxHp across events this round
}

function summarizeRound(round: number, events: BattleEvent[], allHeroes: Hero[]): RoundSummary {
  let hasKill = false;
  let hasCrit = false;
  let maxSwing = 0;
  for (const e of events) {
    if (hasFlag(e.flags, FLAG_KILL)) hasKill = true;
    if (hasFlag(e.flags, FLAG_CRIT)) hasCrit = true;
    const target = allHeroes[e.targetIdx];
    if (target && target.hp > 0) {
      const swing = Math.abs(e.hpDelta) / target.hp;
      if (swing > maxSwing) maxSwing = swing;
    }
  }
  return { round, events, hasKill, hasCrit, hpSwingPct: maxSwing };
}

// P1-4: fold 2+ consecutive "boring" rounds (no kill/crit, <30% max swing)
// into a single `── 第 X–Y 回合 · 拉锯 ──` block.
function mergeRounds(summaries: RoundSummary[]): Array<
  | { kind: "single"; round: RoundSummary }
  | { kind: "merged"; from: number; to: number; rounds: RoundSummary[] }
> {
  const out: Array<
    | { kind: "single"; round: RoundSummary }
    | { kind: "merged"; from: number; to: number; rounds: RoundSummary[] }
  > = [];
  const isBoring = (r: RoundSummary) => !r.hasKill && !r.hasCrit && r.hpSwingPct < 0.3;
  let i = 0;
  while (i < summaries.length) {
    const cur = summaries[i]!;
    if (isBoring(cur) && i + 1 < summaries.length && isBoring(summaries[i + 1]!)) {
      let j = i;
      while (j < summaries.length && isBoring(summaries[j]!)) j++;
      out.push({ kind: "merged", from: cur.round, to: summaries[j - 1]!.round, rounds: summaries.slice(i, j) });
      i = j;
    } else {
      out.push({ kind: "single", round: cur });
      i++;
    }
  }
  return out;
}

function mergedSummaryLine(rounds: RoundSummary[], allHeroes: Hero[]): string {
  const byActorDmg = new Map<number, number>();
  const byActorHeal = new Map<number, number>();
  for (const r of rounds) {
    for (const e of r.events) {
      if (e.hpDelta < 0) byActorDmg.set(e.actorIdx, (byActorDmg.get(e.actorIdx) ?? 0) + Math.abs(e.hpDelta));
      else if (e.hpDelta > 0) byActorHeal.set(e.actorIdx, (byActorHeal.get(e.actorIdx) ?? 0) + e.hpDelta);
    }
  }
  const dmgSorted = [...byActorDmg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const healSorted = [...byActorHeal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 1);
  const parts: string[] = [];
  if (dmgSorted.length > 0) {
    parts.push(dmgSorted.map(([idx, v]) => {
      const h = allHeroes[idx];
      const nm = h ? `${SECT_NAMES[h.sect]}·${h.name}` : `#${idx}`;
      return `${nm} 累计 -${v}`;
    }).join(";"));
  }
  if (healSorted.length > 0) {
    const [idx, v] = healSorted[0]!;
    const h = allHeroes[idx];
    const nm = h ? `${SECT_NAMES[h.sect]}·${h.name}` : `#${idx}`;
    parts.push(`${nm} 回血 +${v}`);
  }
  return parts.length > 0 ? `双方僵持,${parts.join(",")}。` : "双方僵持未分胜负。";
}

function renderLineupLines(team: Hero[], sideIcon: "🟢" | "🔴", label: string): string[] {
  const lines: string[] = [];
  lines.push(`${sideIcon} ${label}:`);
  for (const h of team) {
    const t = tagFor(h);
    lines.push(`   ${SECT_NAMES[h.sect]}·${h.name} HP${h.hp}  — ${t.tag}·${t.role}`);
  }
  return lines;
}

interface RenderBattleOpts {
  header: string;
  subtitle?: string;
  playerTeam: Hero[];
  opponentTeam: Hero[];
  opponentLabel: string;
  result: { winner: 0 | 1 | 2; events: BattleEvent[]; snapshots: Map<number, HpSnapshot> };
  mode: ReportMode;
  rewardLines: string[];
  closingHint: string;
}

function renderBattleReport(opts: RenderBattleOpts): string {
  const { playerTeam, opponentTeam, result, mode } = opts;
  const allHeroes = [...playerTeam, ...opponentTeam];
  const lines: string[] = [];

  lines.push(opts.header);
  if (opts.subtitle) lines.push(opts.subtitle);
  lines.push("━".repeat(50));
  lines.push("");

  // Lineup (all modes)
  for (const l of renderLineupLines(playerTeam, "🟢", "你的阵容")) lines.push(l);
  for (const l of renderLineupLines(opponentTeam, "🔴", opts.opponentLabel)) lines.push(l);
  lines.push("");

  // Group events by round
  const byRound = new Map<number, BattleEvent[]>();
  for (const e of result.events) {
    if (!byRound.has(e.round)) byRound.set(e.round, []);
    byRound.get(e.round)!.push(e);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const summaries = rounds.map(r => summarizeRound(r, byRound.get(r)!, allHeroes));

  // MVP calc (used by lite + full)
  const dmgByActor = new Map<number, number>();
  const killsByActor = new Map<number, number>();
  for (const e of result.events) {
    if (e.hpDelta < 0) dmgByActor.set(e.actorIdx, (dmgByActor.get(e.actorIdx) ?? 0) + Math.abs(e.hpDelta));
    if (hasFlag(e.flags, FLAG_KILL)) killsByActor.set(e.actorIdx, (killsByActor.get(e.actorIdx) ?? 0) + 1);
  }
  const mvpEntry = [...dmgByActor.entries()].sort((a, b) => b[1] - a[1])[0];
  const mvpLine = mvpEntry ? (() => {
    const h = allHeroes[mvpEntry[0]];
    const kills = killsByActor.get(mvpEntry[0]) ?? 0;
    const nm = h ? `${SECT_NAMES[h.sect]}·${h.name}` : `#${mvpEntry[0]}`;
    return `🏅 MVP: ${nm} — 总输出 ${mvpEntry[1]}${kills > 0 ? `, 击杀 ${kills}` : ""}`;
  })() : null;

  if (mode === "lite") {
    // 极简:阵容 + MVP + 结局 + reward
    if (mvpLine) lines.push(mvpLine);
    const outcome = result.winner === 0 ? "🏆 胜利" : result.winner === 1 ? "💀 败北" : "⚖️ 僵局 · 钟鸣收势,未分胜负";
    lines.push(`总计 ${rounds.length} 回合 · ${outcome}`);
    lines.push("━".repeat(50));
    for (const l of opts.rewardLines) lines.push(l);
    lines.push("");
    lines.push(`(lite 模式 · 想看细节请 XIAKE_REPORT_MODE=full)`);
    return lines.join("\n");
  }

  // full / epic: per-round rendering with merging + HP bars
  const merged = mergeRounds(summaries);
  let epicIdx = 0;

  for (const item of merged) {
    if (item.kind === "merged") {
      lines.push(`── 第 ${item.from}–${item.to} 回合 · 拉锯 ──`);
      lines.push(`  ${mergedSummaryLine(item.rounds, allHeroes)}`);
      // Show HP bar at the last round of the merge block
      const lastRound = item.to;
      const snap = result.snapshots.get(lastRound);
      if (snap) {
        lines.push("");
        for (const s of renderSnapshotBlock(snap)) lines.push(`  ${s}`);
      }
      lines.push("");
      continue;
    }

    const r = item.round;
    lines.push(`── 第 ${r.round} 回合 ──`);
    if (mode === "epic") {
      const opener = EPIC_OPENING_LINES[epicIdx % EPIC_OPENING_LINES.length]!;
      epicIdx++;
      lines.push(`  「${opener}」`);
    }
    for (const e of r.events) {
      const actor = allHeroes[e.actorIdx];
      const target = allHeroes[e.targetIdx];
      const skill = SKILL_NAMES[e.skillId] ?? `技能#${e.skillId}`;
      const actorName = actor ? `${SECT_NAMES[actor.sect]}·${actor.name}` : `#${e.actorIdx}`;
      const targetName = target ? `${SECT_NAMES[target.sect]}·${target.name}` : `#${e.targetIdx}`;
      if (e.hpDelta < 0) {
        const critMark = hasFlag(e.flags, FLAG_CRIT) ? " 💥暴击!" : "";
        const killMark = hasFlag(e.flags, FLAG_KILL) ? " ☠️击杀!" : "";
        lines.push(`  ${actorName} →「${skill}」→ ${targetName}  ${e.hpDelta} HP${critMark}${killMark}`);
      } else if (e.hpDelta > 0) {
        lines.push(`  ${actorName} →「${skill}」→ ${targetName}  +${e.hpDelta} HP 💚`);
      } else {
        lines.push(`  ${actorName} →「${skill}」→ ${targetName}  ✨`);
      }
    }
    // HP bar snapshot at round end
    const snap = result.snapshots.get(r.round);
    if (snap) {
      lines.push("");
      for (const s of renderSnapshotBlock(snap)) lines.push(`  ${s}`);
    }
    lines.push("");
  }

  lines.push("━".repeat(50));
  if (mvpLine) lines.push(mvpLine);
  for (const l of opts.rewardLines) lines.push(l);
  lines.push(`总计 ${rounds.length} 回合 · 渲染模式 ${mode}`);
  lines.push("");
  lines.push(opts.closingHint);

  return lines.join("\n");
}

async function cmdPve(stageIdStr: string): Promise<string> {
  const mode = getMode();
  const state = loadState();

  const stageId = normalizeStageId(stageIdStr);
  if (!stageId) return `⚠️ 关卡号无法解析: ${stageIdStr} (示例: 1-1 / 2-3 / 3-4)`;
  const stage = STAGE_BY_ID.get(stageId);
  if (!stage) return `⚠️ 关卡 ${stageId} 不存在。可选: ${Array.from(STAGE_BY_ID.keys()).join(", ")}`;

  const chapter = chapterOf(stageId)!;
  if (state.reputation < chapter.minRep) {
    return `🔒 第${chapter.id}章 ${chapter.name} 需要声望 ≥ ${chapter.minRep} (当前 ${state.reputation})`;
  }

  const playerTeam = resolveActiveTeam(state);
  if (playerTeam.length < 3) return "⚠️ 出战阵容不足 3 人。说「招募侠客」或「组队 <id> <id> <id>」。";

  const fitErr = checkTeamFit(state, playerTeam);
  if (fitErr) return fitErr;

  const result = simulateBattle(playerTeam, stage.bossTeam, BigInt(Date.now()));

  const rewardLines: string[] = [];
  let winDrop: { hero: Hero; skillId: number } | null = null;
  let lossVictims: Hero[] = [];
  if (result.winner === 0) {
    const repGain = stage.isChapterBoss ? 80 : 20 * stage.chapter + 10 * stage.stageIdx;
    state.reputation += repGain;
    const firstClear = !state.clearedStages.includes(stage.id);
    if (firstClear) state.clearedStages.push(stage.id);
    rewardLines.push(`🏆 胜利!声望 +${repGain} (当前: ${state.reputation})`);
    // Chapter BOSS 首杀: mock 模式模拟合约 grantBossMint +1 免费额度
    if (firstClear && stage.isChapterBoss && mode === "mock") {
      state.allowance.bossRewards += 1;
      state.allowance.free += 1;
      rewardLines.push(`🎁 免费额度 +1 (章节 BOSS 首杀),当前 free=${state.allowance.free} boss=${state.allowance.bossRewards}`);
    }
    const dropRes = maybeDropSkillBead(state, playerTeam);
    winDrop = dropRes.drop;
    if (winDrop) {
      const pityNote = dropRes.threshold > 20 ? ` (惜败补偿 +${dropRes.threshold - 20} 命中,补偿归零)` : "";
      rewardLines.push(`🎁 技能珠掉落!${SECT_NAMES[winDrop.hero.sect]}·${winDrop.hero.name} 获得「${SKILL_NAMES[winDrop.skillId]}」${pityNote}`);
      rewardLines.push(`   用「装备 #${winDrop.hero.tokenId} <slot> ${winDrop.skillId}」装备。`);
    } else {
      // P2-8: 差一点彩蛋
      const diff = dropRes.roll - dropRes.threshold;
      rewardLines.push(`🎁 技能珠骰子: ${dropRes.roll} / 需 ≤ ${dropRes.threshold} — 差 ${diff} 点`);
      rewardLines.push(`   (下场惜败补偿 +5%,当前累积 ${dropRes.pityAfter}%,累至出珠为止)`);
    }
    // 金疮药掉落 (mock 模式): 章节 BOSS 必掉 1 瓶,普通关 10% 掉 1 瓶
    if (mode === "mock") {
      const potionDrop = stage.isChapterBoss ? 1 : (Math.random() < 0.1 ? 1 : 0);
      if (potionDrop > 0) {
        state.potions += potionDrop;
        rewardLines.push(`💊 金疮药 +${potionDrop} (库存 ${state.potions} 瓶)`);
      }
    }
  } else if (result.winner === 1) {
    lossVictims = applyDefeatWounds(state, playerTeam, stage.isChapterBoss);
    const level = stage.isChapterBoss ? 2 : 1;
    rewardLines.push(`💀 败北... (重伤等级 ${level})`);
    for (const v of lossVictims) {
      const secs = Math.max(0, Math.ceil((getHealth(state, v.tokenId).cooldownUntil - Date.now()) / 1000));
      rewardLines.push(`   ⚕️ ${SECT_NAMES[v.sect]}·${v.name} #${v.tokenId} 受伤,需恢复 ${secs}s`);
    }
  } else {
    rewardLines.push("⚖️ 僵局 · 钟鸣收势,未分胜负 (不计胜负,不加声望,不触伤病)");
  }
  const playerDeaths = countPlayerDeaths(result.events, playerTeam);
  recordBattle(state, {
    kind: "pve",
    stageId: stage.id,
    subtitle: `⚔️ PVE ${stage.id}: ${stage.name}${stage.isChapterBoss ? " 👑章节BOSS" : ""}`,
    winner: result.winner,
    playerTeam: [...playerTeam],
    opponentTeam: [...stage.bossTeam],
    opponentLabel: "BOSS 阵容",
    events: [...result.events],
  });
  const achUnlocked = checkAchievements(state, {
    kind: "pve",
    stageId: stage.id,
    isChapterBoss: stage.isChapterBoss,
    playerWon: result.winner === 0,
    playerTeam,
    events: result.events,
    playerDeaths,
  });
  for (const l of renderUnlockBanner(achUnlocked)) rewardLines.push(l);
  saveState(state);

  if (mode === "onchain" || mode === "sepolia") {
    const lossLevel: 1 | 2 = stage.isChapterBoss ? 2 : 1;
    const bossId = stage.chapter * 10 + stage.stageIdx;
    const chainLines = await mirrorPveOnchain(state, {
      stageTag: stage.id,
      winner: result.winner,
      bossId,
      lossLevel,
      lossVictims,
      winDrop,
    });
    for (const l of chainLines) rewardLines.push(l);

    // Arena BOSS 首杀 / Chapter BOSS 首杀 合约会自动 grantBossMint。
    // 战后读一下链上 allowance,刷新本地缓存并提示玩家免费额度 +1。
    if (result.winner === 0 && stage.isChapterBoss) {
      try {
        const player = await ensurePlayerAddress(state);
        const { getPublicClient, getAddresses } = await import("./chain/client.js");
        const { heroNftAbi } = await import("./chain/abi.js");
        const { hero } = getAddresses();
        const before = state.allowance.bossRewards;
        const tuple = await getPublicClient().readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "getMintAllowance",
          args: [player],
        }) as readonly [number, number, number, number, number];
        const [free, boss, daily, , remaining] = tuple;
        state.allowance.free = free;
        state.allowance.bossRewards = boss;
        state.allowance.dailyRewards = daily;
        saveState(state);
        if (boss > before) {
          rewardLines.push(`🎁 免费额度 +1 (BOSS 首杀),链上 remaining=${remaining}`);
        } else {
          rewardLines.push(`ℹ️ 链上额度刷新: free=${free} boss=${boss} remaining=${remaining}`);
        }
      } catch (err) {
        rewardLines.push(`⚠️ 刷新链上额度失败: ${(err as Error).message}`);
      }
    }
  }

  // Chapter BOSS 默认 epic,其他默认 full (P1-7)
  const defaultMode: ReportMode = stage.isChapterBoss ? "epic" : "full";
  const reportMode = resolveReportMode(defaultMode);

  const report = renderBattleReport({
    header: `🔗 模式: ${mode}`,
    subtitle: `⚔️ PVE ${stage.id}: ${stage.name}${stage.isChapterBoss ? " 👑章节BOSS" : ""}`,
    playerTeam,
    opponentTeam: stage.bossTeam,
    opponentLabel: "BOSS 阵容",
    result,
    mode: reportMode,
    rewardLines,
    closingHint: "📜 请用金庸说书人风格,逐回合解说上述战报。描述招式交锋,加入角色性格,总结 MVP。",
  });

  return report;
}

async function cmdPvp(args: string[]): Promise<string> {
  const sub = (args[0] ?? "").toLowerCase();
  if (sub === "challenge") return cmdPvpChallenge(args[1]);
  if (sub === "ai" || sub === "") return cmdPvpAi();
  if (/^0x[0-9a-fA-F]{40}$/.test(sub)) return cmdPvpChallenge(sub);
  return [
    "用法:",
    "  pvp ai                      — 随机 AI 对战 (练兵)",
    "  pvp challenge <address>     — 挑战指定玩家的擂台防守阵容",
    "先用 list-arena 查看可挑战的对手。",
  ].join("\n");
}

async function cmdPvpAi(): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const playerTeam = resolveActiveTeam(state);
  if (playerTeam.length < 3) return "⚠️ 出战阵容不足 3 人。说「招募侠客」或「组队 <id> <id> <id>」。";

  const fitErr = checkTeamFit(state, playerTeam);
  if (fitErr) return fitErr;

  const opponentTeam = generateHeroes(3, Date.now() + 999, 1001n, []);

  const result = simulateBattle(playerTeam, opponentTeam, BigInt(Date.now()));

  const rewardLines: string[] = [];
  let lossVictims: Hero[] = [];
  if (result.winner === 0) {
    state.reputation += 25;
    rewardLines.push(`🏆 胜利!声望 +25 (当前: ${state.reputation})`);
  } else if (result.winner === 1) {
    // PVP loss = arena (擂台) = woundLevel 2
    lossVictims = applyDefeatWounds(state, playerTeam, true);
    rewardLines.push(`💀 擂台败北... (重伤等级 2)`);
    for (const v of lossVictims) {
      const secs = Math.max(0, Math.ceil((getHealth(state, v.tokenId).cooldownUntil - Date.now()) / 1000));
      rewardLines.push(`   ⚕️ ${SECT_NAMES[v.sect]}·${v.name} #${v.tokenId} 受伤,需恢复 ${secs}s`);
    }
  } else {
    rewardLines.push("⚖️ 平局。");
  }
  recordBattle(state, {
    kind: "pvp",
    subtitle: "🤖 AI 对战",
    winner: result.winner,
    playerTeam: [...playerTeam],
    opponentTeam: [...opponentTeam],
    opponentLabel: "对手阵容",
    events: [...result.events],
  });
  const achUnlocked = checkAchievements(state, {
    kind: "pvp",
    playerWon: result.winner === 0,
    playerTeam,
    events: result.events,
  });
  for (const l of renderUnlockBanner(achUnlocked)) rewardLines.push(l);
  saveState(state);

  if (mode === "onchain" && result.winner === 1 && lossVictims.length > 0) {
    const chainLines = await mirrorWoundsOnchain(state, lossVictims, 2);
    for (const l of chainLines) rewardLines.push(l);
  }

  // PVP 默认 full (擂台默认 epic 另行处理)
  const reportMode = resolveReportMode("full");

  return renderBattleReport({
    header: `🔗 模式: ${mode}`,
    subtitle: "🤖 AI 对战",
    playerTeam,
    opponentTeam,
    opponentLabel: "对手阵容",
    result,
    mode: reportMode,
    rewardLines,
    closingHint: "📜 请用金庸说书人风格,逐回合解说上述战报。描述招式交锋,加入角色性格,总结 MVP。",
  });
}

// ── Real PVP: setDefense / listArena / challenge ───────────────────────────
// 真·PVP: 玩家锁定 3 人防守阵容,其他玩家可通过 `pvp challenge <address>` 挑战。

function deriveMockOpponent(seed: string, index: number): { address: `0x${string}`; power: number; team: Hero[] } {
  // Deterministic fake opponent — same seed/index always yields same lineup,
  // so `list-arena` previews match the team that `challenge` actually fights.
  let h = 0;
  const s = `${seed}#${index}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  const rand = Math.abs(h);
  const addrBytes: string[] = [];
  let x = rand;
  for (let i = 0; i < 40; i++) {
    x = (x * 1103515245 + 12345 + i * 7) & 0x7fffffff;
    addrBytes.push((x & 0xf).toString(16));
  }
  const address = ("0x" + addrBytes.join("")) as `0x${string}`;
  const team = generateHeroes(3, rand + index * 17, BigInt(9000 + index * 3), []);
  const power = team.reduce((sum, hh) => sum + hh.hp + hh.atk * 2 + hh.def + hh.spd, 0);
  return { address, power, team };
}

function listMockArena(limit: number): Array<{ address: `0x${string}`; power: number; team: Hero[] }> {
  const n = Math.max(1, Math.min(50, limit));
  const out: Array<{ address: `0x${string}`; power: number; team: Hero[] }> = [];
  for (let i = 0; i < n; i++) out.push(deriveMockOpponent("xiake-mock-arena-v1", i));
  out.sort((a, b) => b.power - a.power);
  return out;
}

function previewTeam(team: Hero[]): string {
  return team.map(h => `${SECT_NAMES[h.sect]}·${h.name}`).join(" / ");
}

async function cmdSetDefense(args: string[]): Promise<string> {
  if (args.length < 3) {
    return "用法: defense <id> <id> <id> — 设置擂台防守阵容 (3 位自有 tokenId)";
  }
  const mode = getMode();
  const state = loadState();

  let ids: [bigint, bigint, bigint];
  try {
    const parsed = args.slice(0, 3).map(v => BigInt(String(v).replace(/^#/, "")));
    ids = [parsed[0]!, parsed[1]!, parsed[2]!];
  } catch {
    return `⚠️ tokenId 无法解析: ${args.slice(0, 3).join(" ")}`;
  }
  const [a, b, c] = ids;
  if (a === b || b === c || a === c) return "⚠️ 防守阵容不能有重复 tokenId。";

  const heroesById = new Map(state.heroes.map(h => [h.tokenId.toString(), h]));
  const picked: Hero[] = [];
  for (const id of ids) {
    const hero = heroesById.get(id.toString());
    if (!hero) return `⚠️ 侠客 #${id} 不在你的名册中,无法上擂台。`;
    picked.push(hero);
  }
  const now = Date.now();
  const wounded = picked.filter(h => isWounded(state, h.tokenId, now));
  if (wounded.length > 0) {
    const lines = wounded.map(h => {
      const secs = Math.max(0, Math.ceil((getHealth(state, h.tokenId).cooldownUntil - now) / 1000));
      return `   ⚕️ ${SECT_NAMES[h.sect]}·${h.name} #${h.tokenId}  还需 ${secs}s 恢复`;
    });
    return ["⚠️ 伤病中的侠客不能上擂台防守:", ...lines, "请先治疗或换人。"].join("\n");
  }

  state.defenseTeam = ids;
  saveState(state);

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push("🛡️ 防守阵容已锁定");
  lines.push("─".repeat(50));
  for (const h of picked) {
    const icon = SECT_ICON[h.sect] ?? "⚔️";
    lines.push(`  ${icon} ${SECT_NAMES[h.sect]}·${h.name} #${h.tokenId}  HP${h.hp} ATK${h.atk} DEF${h.def} SPD${h.spd}`);
  }

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { encodeFunctionData } = await import("viem");
      const { arenaAbi } = await import("./chain/abi.js");
      const { getAddresses, txUrl } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { arena } = getAddresses();
      const data = encodeFunctionData({
        abi: arenaAbi,
        functionName: "setDefenseTeam",
        args: [[a, b, c]],
      });
      const { txHash } = await signAndSend({ to: arena, data, from: player });
      lines.push(`🔗 onchain tx: ${txHash}`);
      lines.push(`   ${txUrl(txHash)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`⚠️ 写链失败 (本地已记录): ${msg}`);
    }
  }

  lines.push("");
  lines.push("✅ 防守阵容已锁定,可被他人挑战");
  return lines.join("\n");
}

async function cmdListArena(args: string[]): Promise<string> {
  const limitArg = args[0] ? parseInt(args[0], 10) : 5;
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? Math.min(limitArg, 50) : 5;
  const mode = getMode();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push(`🏟️  擂台排行榜 (前 ${limit} 位)`);
  lines.push("─".repeat(70));
  lines.push("| 排名 | 玩家地址                                       | 声望   | 阵容预览");
  lines.push("|------|------------------------------------------------|--------|---------");

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const { fetchArenaList, fetchDefenseTeam, fetchHeroes } = await import("./chain/reads.js");
      const { players, powers } = await fetchArenaList(0n, BigInt(limit));
      if (players.length === 0) {
        lines.push("| —    | (链上还没有玩家挂上防守阵容)                 | 0      | —");
      } else {
        for (let i = 0; i < players.length; i++) {
          const addr = players[i]!;
          const power = powers[i] ?? 0n;
          let preview = "(未公开)";
          try {
            const def = await fetchDefenseTeam(addr);
            const heroes = await fetchHeroes([def[0], def[1], def[2]]);
            preview = previewTeam(heroes);
          } catch {
            /* lineup unreadable — keep preview as 未公开 */
          }
          lines.push(`| ${(i + 1).toString().padEnd(4)} | ${addr.padEnd(46)} | ${power.toString().padEnd(6)} | ${preview}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(`⚠️ 读链失败: ${msg}`);
    }
  } else {
    const opponents = listMockArena(limit);
    for (let i = 0; i < opponents.length; i++) {
      const o = opponents[i]!;
      lines.push(`| ${(i + 1).toString().padEnd(4)} | ${o.address.padEnd(46)} | ${o.power.toString().padEnd(6)} | ${previewTeam(o.team)}`);
    }
  }

  lines.push("");
  lines.push("挑战命令: pvp challenge <address>");
  return lines.join("\n");
}

async function cmdPvpChallenge(targetArg: string | undefined): Promise<string> {
  if (!targetArg || !/^0x[0-9a-fA-F]{40}$/.test(targetArg)) {
    return "用法: pvp challenge <address> — 挑战指定地址玩家的防守阵容";
  }
  const target = targetArg as `0x${string}`;
  const mode = getMode();
  const state = loadState();
  const playerTeam = resolveActiveTeam(state);
  if (playerTeam.length < 3) return "⚠️ 出战阵容不足 3 人。说「招募侠客」或「组队 <id> <id> <id>」。";

  const fitErr = checkTeamFit(state, playerTeam);
  if (fitErr) return fitErr;

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      if (target.toLowerCase() === player.toLowerCase()) return "⚠️ 不能挑战自己。";

      const { encodeFunctionData, decodeEventLog } = await import("viem");
      const { arenaAbi } = await import("./chain/abi.js");
      const { getAddresses, txUrl, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { fetchDefenseTeam, fetchHeroes } = await import("./chain/reads.js");
      const { arena } = getAddresses();

      const def = await fetchDefenseTeam(target);
      const opponentTeam = await fetchHeroes([def[0], def[1], def[2]]);

      const data = encodeFunctionData({
        abi: arenaAbi,
        functionName: "challenge",
        args: [target],
      });
      const { txHash } = await signAndSend({ to: arena, data, from: player });
      const receipt = await getPublicClient().waitForTransactionReceipt({ hash: txHash });

      let chainWinner: 0 | 1 | 2 | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== arena.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: arenaAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "BattleSettled") {
            chainWinner = Number((decoded.args as { winner: number }).winner) as 0 | 1 | 2;
            break;
          }
        } catch { /* non-matching log */ }
      }

      const result = simulateBattle(playerTeam, opponentTeam, BigInt(Date.now()));
      const finalWinner: 0 | 1 | 2 = chainWinner ?? result.winner;

      const rewardLines: string[] = [];
      rewardLines.push(`🔗 onchain tx: ${txHash}`);
      rewardLines.push(`   ${txUrl(txHash)}`);
      if (finalWinner === 0) {
        state.reputation += 25;
        rewardLines.push(`🏆 擂台胜利!声望 +25 (当前: ${state.reputation})`);
      } else if (finalWinner === 1) {
        const victims = applyDefeatWounds(state, playerTeam, true);
        rewardLines.push(`💀 擂台败北 (重伤等级 2)`);
        for (const v of victims) {
          const secs = Math.max(0, Math.ceil((getHealth(state, v.tokenId).cooldownUntil - Date.now()) / 1000));
          rewardLines.push(`   ⚕️ ${SECT_NAMES[v.sect]}·${v.name} #${v.tokenId} 受伤,需恢复 ${secs}s`);
        }
      } else {
        rewardLines.push("⚖️ 平局。");
      }
      recordBattle(state, {
        kind: "pvp",
        subtitle: `🗡️ 挑战擂台 → ${target}`,
        winner: finalWinner,
        playerTeam: [...playerTeam],
        opponentTeam: [...opponentTeam],
        opponentLabel: `防守方 ${target}`,
        events: [...result.events],
      });
      const achUnlocked = checkAchievements(state, {
        kind: "pvp",
        playerWon: finalWinner === 0,
        playerTeam,
        events: result.events,
      });
      for (const l of renderUnlockBanner(achUnlocked)) rewardLines.push(l);
      saveState(state);

      const reportMode = resolveReportMode("full");
      return renderBattleReport({
        header: `🔗 模式: ${mode}`,
        subtitle: `🗡️ 挑战擂台 → ${target}`,
        playerTeam,
        opponentTeam,
        opponentLabel: `防守方 ${target}`,
        result,
        mode: reportMode,
        rewardLines,
        closingHint: "📜 请用金庸说书人风格,逐回合解说这场擂台挑战。",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `⚠️ 链上挑战失败: ${msg}`;
    }
  }

  // mock: 优先用 list-arena 的对手,否则随机匹配一个
  const pool = listMockArena(20);
  const matched = pool.find(o => o.address.toLowerCase() === target.toLowerCase());
  const opp = matched ?? pool[Math.floor(Math.random() * pool.length)]!;
  const opponentTeam = opp.team;

  const result = simulateBattle(playerTeam, opponentTeam, BigInt(Date.now()));

  const rewardLines: string[] = [];
  let lossVictims: Hero[] = [];
  if (result.winner === 0) {
    state.reputation += 25;
    rewardLines.push(`🏆 擂台胜利!声望 +25 (当前: ${state.reputation})`);
  } else if (result.winner === 1) {
    lossVictims = applyDefeatWounds(state, playerTeam, true);
    rewardLines.push(`💀 擂台败北 (重伤等级 2)`);
    for (const v of lossVictims) {
      const secs = Math.max(0, Math.ceil((getHealth(state, v.tokenId).cooldownUntil - Date.now()) / 1000));
      rewardLines.push(`   ⚕️ ${SECT_NAMES[v.sect]}·${v.name} #${v.tokenId} 受伤,需恢复 ${secs}s`);
    }
  } else {
    rewardLines.push("⚖️ 平局。");
  }
  recordBattle(state, {
    kind: "pvp",
    subtitle: `🗡️ 挑战擂台 → ${opp.address}${matched ? "" : " (随机匹配)"}`,
    winner: result.winner,
    playerTeam: [...playerTeam],
    opponentTeam: [...opponentTeam],
    opponentLabel: `防守方 ${opp.address}`,
    events: [...result.events],
  });
  const achUnlocked = checkAchievements(state, {
    kind: "pvp",
    playerWon: result.winner === 0,
    playerTeam,
    events: result.events,
  });
  for (const l of renderUnlockBanner(achUnlocked)) rewardLines.push(l);
  saveState(state);

  const reportMode = resolveReportMode("full");
  return renderBattleReport({
    header: `🔗 模式: ${mode}`,
    subtitle: `🗡️ 挑战擂台 → ${opp.address}${matched ? "" : " (随机匹配)"}`,
    playerTeam,
    opponentTeam,
    opponentLabel: `防守方 ${opp.address}`,
    result,
    mode: reportMode,
    rewardLines,
    closingHint: "📜 请用金庸说书人风格,逐回合解说这场擂台挑战。",
  });
}

// 🌙 AI 自主修行: 后台批量跑 PVE 训练,lite 模式汇总,不逐回合渲染
async function cmdAutoTrain(countArg?: string): Promise<string> {
  const mode = getMode();
  const state = loadState();

  let n = countArg ? parseInt(countArg, 10) : 5;
  if (!Number.isFinite(n) || n < 1) n = 5;
  if (n > 10) n = 10;

  const playerTeam = resolveActiveTeam(state);
  if (playerTeam.length < 3) return "⚠️ 出战阵容不足 3 人。说「招募侠客」或「组队 <id> <id> <id>」。";

  // 候选关卡: 声望已解锁的所有章节里的关卡
  const candidates = CHAPTERS
    .filter(ch => state.reputation >= ch.minRep)
    .flatMap(ch => ch.stages);
  if (candidates.length === 0) return "⚠️ 暂无可修行关卡 (声望不足)。";

  let wins = 0, losses = 0, draws = 0;
  let repGained = 0;
  let potionsGained = 0;
  let beadsGained = 0;
  let woundsInflicted = 0;
  const log: string[] = [];
  const potionsBefore = Object.values(state.heroHealth).reduce((s, h) => s + (h?.potionCount ?? 0), 0);

  for (let i = 0; i < n; i++) {
    // 伤病中的侠客不能上场 → 修行中断提醒
    const fitErr = checkTeamFit(state, playerTeam);
    if (fitErr) {
      log.push(`   ⏸ 第 ${i + 1} 场中止: 有侠客伤病需恢复`);
      break;
    }
    const stage = candidates[Math.floor(Math.random() * candidates.length)]!;
    const result = simulateBattle(playerTeam, stage.bossTeam, BigInt(Date.now() + i * 997));

    if (result.winner === 0) {
      wins++;
      const repGain = stage.isChapterBoss ? 80 : 20 * stage.chapter + 10 * stage.stageIdx;
      state.reputation += repGain;
      repGained += repGain;
      if (!state.clearedStages.includes(stage.id)) state.clearedStages.push(stage.id);
      const drop = maybeDropSkillBead(state, playerTeam);
      if (drop.drop) beadsGained++;
      log.push(`   ✅ ${stage.id} ${stage.name} · 胜 · +${repGain} 声望${drop.drop ? " · 得珠" : ""}`);
    } else if (result.winner === 1) {
      losses++;
      const victims = applyDefeatWounds(state, playerTeam, stage.isChapterBoss);
      woundsInflicted += victims.length;
      log.push(`   💀 ${stage.id} ${stage.name} · 败 · ${victims.length} 人受伤`);
    } else {
      draws++;
      log.push(`   ⚖️ ${stage.id} ${stage.name} · 僵局`);
    }
    recordBattle(state, {
      kind: "auto",
      stageId: stage.id,
      subtitle: `🌙 修行 ${stage.id}: ${stage.name}`,
      winner: result.winner,
      playerTeam: [...playerTeam],
      opponentTeam: [...stage.bossTeam],
      opponentLabel: "BOSS 阵容",
      events: [...result.events],
    });
    const achUnlocked = checkAchievements(state, {
      kind: "pve",
      stageId: stage.id,
      isChapterBoss: stage.isChapterBoss,
      playerWon: result.winner === 0,
      playerTeam,
      events: result.events,
      playerDeaths: countPlayerDeaths(result.events, playerTeam),
    });
    for (const id of achUnlocked) {
      const def = ACHIEVEMENT_BY_ID.get(id);
      if (def) log.push(`   🎖️ 成就解锁: ${def.name}`);
    }
  }

  saveState(state);

  // 金疮药数量在 PVE 本身不会增减 (没有该机制) — 统计增量兜底为 0
  const potionsAfter = Object.values(state.heroHealth).reduce((s, h) => s + (h?.potionCount ?? 0), 0);
  potionsGained = potionsAfter - potionsBefore;

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push(`🌙 AI 修行 — 共 ${n} 场`);
  lines.push("─".repeat(50));
  for (const l of log) lines.push(l);
  lines.push("─".repeat(50));
  lines.push(`🌙 修行归来,${wins} 胜 ${losses} 负 ${draws} 平,声望 +${repGained},金疮药 ${potionsGained >= 0 ? "+" : ""}${potionsGained},技能珠 +${beadsGained},伤病 ${woundsInflicted}`);
  lines.push(`(lite 汇总模式 · 逐回合细节请用「闯第 X-Y 关」)`);
  return lines.join("\n");
}

function cmdStatus(): string {
  const mode = getMode();
  const state = loadState();
  const wins = state.battleHistory.filter(b => b.winner === 0).length;
  const losses = state.battleHistory.filter(b => b.winner === 1).length;
  const activeTeam = resolveActiveTeam(state);
  const now = Date.now();
  const woundedCount = state.heroes.filter(h => isWounded(state, h.tokenId, now)).length;
  const beadCount = Object.values(state.skillBeads).reduce((s, arr) => s + arr.length, 0);
  const lines = [
    `🔗 模式: ${mode}`,
    `声望: ${state.reputation}`,
    `侠客: ${state.heroes.length} 位 (伤病中 ${woundedCount})`,
    `出战阵容: ${activeTeam.length > 0 ? activeTeam.map(h => `#${h.tokenId} ${h.name}`).join(" / ") : "未设置"}`,
    `战绩: ${wins}胜 ${losses}负`,
    `已通关: ${state.clearedStages.length > 0 ? state.clearedStages.join(", ") : "无"}`,
    `技能珠: ${beadCount} 颗`,
  ];
  if (state.playerAddress) lines.push(`链上地址: ${state.playerAddress}`);
  return lines.join("\n");
}

function cmdWounds(): string {
  const state = loadState();
  const now = Date.now();
  const wounded = state.heroes
    .map(h => ({ h, hp: getHealth(state, h.tokenId) }))
    .filter(x => x.hp.cooldownUntil > now);
  if (wounded.length === 0) return "⚕️ 目前没有侠客伤病。所有人都可以出战。";
  const lines: string[] = [];
  lines.push(`⚕️ 伤病状况 (${wounded.length} 人)`);
  lines.push("─".repeat(50));
  for (const { h, hp } of wounded) {
    const secs = Math.max(0, Math.ceil((hp.cooldownUntil - now) / 1000));
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const pretty = hrs > 0 ? `${hrs}h${mins % 60}m${secs % 60}s` : mins > 0 ? `${mins}m${secs % 60}s` : `${secs}s`;
    const levelTag = hp.woundLevel === 2 ? "重伤" : "轻伤";
    lines.push(`  ${SECT_NAMES[h.sect]}·${h.name} #${h.tokenId}  [${levelTag}]  剩余 ${pretty} (${secs}s)`);
  }
  lines.push("");
  lines.push("轻伤 (普通关战败): 12h  |  重伤 (章节BOSS/擂台战败): 24h");
  lines.push("提示: mock 模式下可编辑 state.json 的 cooldownUntil 字段加速测试。");
  return lines.join("\n");
}

function cmdEquip(args: string[]): string {
  if (args.length !== 3) return "用法: equip <heroId> <slot 0-2> <skillId> — 装备已获得的技能珠到指定槽位";
  const state = loadState();
  let tokenId: bigint;
  try {
    tokenId = BigInt(args[0]!.replace(/^#/, ""));
  } catch {
    return `⚠️ heroId 无法解析: ${args[0]}`;
  }
  const slot = parseInt(args[1]!, 10);
  const skillId = parseInt(args[2]!, 10);
  if (!Number.isFinite(slot) || slot < 0 || slot > 2) return "⚠️ slot 必须是 0 / 1 / 2";
  if (!Number.isFinite(skillId)) return `⚠️ skillId 无效: ${args[2]}`;

  const hero = state.heroes.find(h => h.tokenId === tokenId);
  if (!hero) return `⚠️ 侠客 #${tokenId} 不存在`;

  const k = tokenId.toString();
  const beads = state.skillBeads[k] ?? [];
  const beadIdx = beads.indexOf(skillId);
  if (beadIdx < 0) return `⚠️ 该侠客没有技能珠「${SKILL_NAMES[skillId] ?? skillId}」`;

  const oldSkill = hero.skillIds[slot];
  hero.skillIds = [...hero.skillIds];
  hero.skillIds[slot] = skillId;
  // Consume the bead; if there was an old skill being displaced, store it as a bead
  // so the player can re-equip it later (non-destructive swap).
  const newBeads = [...beads];
  newBeads.splice(beadIdx, 1);
  if (typeof oldSkill === "number" && oldSkill !== skillId) newBeads.push(oldSkill);
  state.skillBeads[k] = newBeads;
  saveState(state);

  const lines: string[] = [];
  lines.push(`🎁 装备成功!`);
  lines.push(`   ${SECT_NAMES[hero.sect]}·${hero.name} #${hero.tokenId} 槽位 ${slot}:`);
  lines.push(`     「${SKILL_NAMES[oldSkill ?? -1] ?? "空"}」 → 「${SKILL_NAMES[skillId] ?? skillId}」`);
  if (typeof oldSkill === "number" && oldSkill !== skillId) {
    lines.push(`   原技能「${SKILL_NAMES[oldSkill]}」已放入技能珠囊,可再次装备。`);
  }
  return lines.join("\n");
}

// ── heal: 消耗 1 瓶金疮药,立即清除指定侠客的伤病 cooldown ──────────────────
async function cmdHeal(tokenIdArg?: string): Promise<string> {
  if (!tokenIdArg) return "用法: heal <tokenId>  (例: heal 3 / 疗伤 #3)";
  const mode = getMode();
  const state = loadState();

  let tokenId: bigint;
  try {
    tokenId = BigInt(tokenIdArg.replace(/^#/, ""));
  } catch {
    return `⚠️ tokenId 无法解析: ${tokenIdArg}`;
  }
  const hero = state.heroes.find(h => h.tokenId === tokenId);
  if (!hero) return `⚠️ 侠客 #${tokenId} 不在你的门派中`;
  if (!isWounded(state, tokenId)) return `ℹ️ ${SECT_NAMES[hero.sect]}·${hero.name} #${tokenId} 未处于伤病状态,无需疗伤`;
  if (state.potions <= 0) {
    return `🔒 金疮药不足 (库存 0 瓶)。闯关胜利 10% 掉落,章节 BOSS 必掉,擂台必掉 2 瓶。`;
  }

  if (mode === "onchain" || mode === "sepolia") {
    const player = await ensurePlayerAddress(state);
    const { encodeFunctionData } = await import("viem");
    const { heroNftAbi } = await import("./chain/abi.js");
    const { getAddresses, getPublicClient } = await import("./chain/client.js");
    const { signAndSend } = await import("./onchainos/gateway.js");
    const { hero: heroAddr } = getAddresses();
    const data = encodeFunctionData({
      abi: heroNftAbi,
      functionName: "healHero",
      args: [tokenId],
    });
    const { txHash } = await withRetry(`healHero(#${tokenId})`, async () =>
      signAndSend({ to: heroAddr, data, from: player }),
    );
    await withRetry("等待交易上链", () =>
      getPublicClient().waitForTransactionReceipt({ hash: txHash }),
    );
    // 链上 healHero 会自动消耗 1 瓶 potion 并清零 cooldown;本地镜像状态。
    const k = tokenId.toString();
    const cur = state.heroHealth[k];
    if (cur) state.heroHealth[k] = { ...cur, woundLevel: 0, cooldownUntil: 0 };
    saveState(state);
    return [
      `🔗 模式: onchain`,
      `✅ ${SECT_NAMES[hero.sect]}·${hero.name} #${tokenId} 已康复`,
      `🔗 healHero tx: ${txHash}`,
    ].join("\n");
  }

  // mock: 本地扣除 1 瓶 + 清除 cooldown
  const k = tokenId.toString();
  const cur = state.heroHealth[k] ?? { woundLevel: 0, cooldownUntil: 0, potionCount: 0 };
  state.heroHealth[k] = { ...cur, woundLevel: 0, cooldownUntil: 0 };
  state.potions = Math.max(0, state.potions - 1);
  saveState(state);
  return [
    `🔗 模式: mock`,
    `✅ ${SECT_NAMES[hero.sect]}·${hero.name} #${tokenId} 已康复,剩余金疮药 ${state.potions} 瓶`,
  ].join("\n");
}

// ── Arena (名人擂台) — Week 3, task #11 ────────────────────────────────────
// Append-only: ARENA_BOSSES data + cmdArena entry point.
// 5 legendary Jin Yong bosses; each drops a unique signature skill bead on first win.
// Reputation gate: 50. Loss penalty: woundLevel=2 on 2 random active heroes.

interface ArenaBossDef {
  slug: string;
  title: string;
  tagline: string;
  minRep: number;
  signatureSkillId: number;
  team: Hero[];
}

const ARENA_BOSSES: ArenaBossDef[] = [
  {
    slug: "zhang-sanfeng",
    title: "武当·张三丰",
    tagline: "太极生两仪,回合开始自回 20HP",
    minRep: 50,
    signatureSkillId: 12,
    team: [
      mkHero(8001n, Sect.Shaolin, "张三丰", 260, 90, 130, 70, 800, [12, 10, 1]),
      mkHero(8002n, Sect.Shaolin, "宋远桥", 200, 85, 110, 68, 700, [0, 1, 2]),
      mkHero(8003n, Sect.Shaolin, "俞莲舟", 210, 88, 108, 72, 750, [2, 0, 1]),
    ],
  },
  {
    slug: "guo-jing",
    title: "丐帮·郭靖",
    tagline: "侠之大者,伤害递增 10%/回合",
    minRep: 50,
    signatureSkillId: 13,
    team: [
      mkHero(8101n, Sect.Shaolin, "郭靖", 240, 115, 100, 75, 1200, [13, 8, 0]),
      mkHero(8102n, Sect.Emei, "黄蓉", 160, 95, 70, 95, 1500, [7, 6, 8]),
      mkHero(8103n, Sect.Tangmen, "洪七公", 200, 108, 85, 85, 1400, [9, 3, 8]),
    ],
  },
  {
    slug: "zhou-zhiruo",
    title: "峨眉·周芷若",
    tagline: "九阴加身,每回合全队 +15HP",
    minRep: 50,
    signatureSkillId: 14,
    team: [
      mkHero(8201n, Sect.Emei, "周芷若", 180, 115, 75, 100, 2200, [14, 8, 7]),
      mkHero(8202n, Sect.Emei, "灭绝", 170, 105, 85, 85, 1800, [8, 10, 7]),
      mkHero(8203n, Sect.Emei, "静玄", 150, 88, 78, 88, 1200, [6, 8, 7]),
    ],
  },
  {
    slug: "huang-yaoshi",
    title: "桃花岛·黄药师",
    tagline: "碧海潮生,随机眩晕沉默",
    minRep: 50,
    signatureSkillId: 15,
    team: [
      mkHero(8301n, Sect.Tangmen, "黄药师", 190, 108, 80, 105, 1800, [15, 4, 7]),
      mkHero(8302n, Sect.Tangmen, "梅超风", 150, 110, 60, 100, 2000, [3, 14, 5]),
      mkHero(8303n, Sect.Tangmen, "陆乘风", 160, 95, 70, 92, 1500, [5, 4, 7]),
    ],
  },
  {
    slug: "ouyang-feng",
    title: "白驼山·欧阳锋",
    tagline: "蛤蟆功毒雾,中毒层数递增",
    minRep: 50,
    signatureSkillId: 16,
    team: [
      mkHero(8401n, Sect.Tangmen, "欧阳锋", 210, 118, 78, 88, 1900, [16, 5, 4]),
      mkHero(8402n, Sect.Tangmen, "欧阳克", 140, 100, 55, 95, 1700, [5, 3, 4]),
      mkHero(8403n, Sect.Tangmen, "灵蛇使", 130, 95, 50, 100, 1800, [4, 5, 3]),
    ],
  },
];

const ARENA_BOSS_BY_SLUG: Map<string, ArenaBossDef> = new Map(ARENA_BOSSES.map(b => [b.slug, b]));

// Arena-defeated list lives in a sidecar file so we don't have to modify
// loadState/emptyState (append-only constraint on Week 3). Sidecar sits next to
// state.json and is loaded fresh each invocation.
const ARENA_DEFEATED_FILE = join(STATE_DIR, "arena_defeated.json");

function loadArenaDefeated(): string[] {
  if (!existsSync(ARENA_DEFEATED_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(ARENA_DEFEATED_FILE, "utf-8"));
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveArenaDefeated(list: string[]): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(ARENA_DEFEATED_FILE, JSON.stringify(list, null, 2));
}

function getArenaDefeated(_state: GameState): string[] {
  return loadArenaDefeated();
}

function setArenaDefeated(_state: GameState, list: string[]): void {
  saveArenaDefeated(list);
}

async function cmdArena(bossSlug?: string): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const defeated = getArenaDefeated(state);

  if (!bossSlug) {
    const lines: string[] = [];
    lines.push(`🔗 模式: ${mode}`);
    lines.push("🏯 名人擂台 — 五绝 BOSS");
    lines.push("━".repeat(50));
    lines.push(`声望: ${state.reputation}  (解锁门槛: 50)`);
    lines.push("");
    for (const boss of ARENA_BOSSES) {
      const beaten = defeated.includes(boss.slug);
      const locked = state.reputation < boss.minRep;
      const status = locked ? "🔒 未解锁" : beaten ? "✅ 已击败" : "⚔️ 可挑战";
      lines.push(`  ${status}  ${boss.slug}  —  ${boss.title}`);
      lines.push(`     ${boss.tagline}`);
      lines.push(`     签名技能: 「${SKILL_NAMES[boss.signatureSkillId] ?? `#${boss.signatureSkillId}`}」`);
      lines.push("");
    }
    lines.push("用法: arena <slug>  (例: arena zhang-sanfeng)");
    lines.push("胜利首次必掉签名技能珠,再战不掉 (但声望照给)。败北全队重伤 24h。");
    return lines.join("\n");
  }

  const boss = ARENA_BOSS_BY_SLUG.get(bossSlug);
  if (!boss) {
    const slugs = ARENA_BOSSES.map(b => b.slug).join(", ");
    return `⚠️ 擂台 BOSS「${bossSlug}」不存在。可选: ${slugs}`;
  }
  if (state.reputation < boss.minRep) {
    return `🔒 名人擂台需要声望 ≥ ${boss.minRep} (当前 ${state.reputation})。先去闯关累积声望。`;
  }

  const playerTeam = resolveActiveTeam(state);
  if (playerTeam.length < 3) return "⚠️ 出战阵容不足 3 人。说「招募侠客」或「组队 <id> <id> <id>」。";
  const fitErr = checkTeamFit(state, playerTeam);
  if (fitErr) return fitErr;

  if (mode === "onchain" || mode === "sepolia") {
    return [
      `🔗 模式: onchain`,
      `🏯 名人擂台「${boss.title}」— onchain 分支尚未接入 (由 onchain-eng 负责)。`,
      `请切换到 mock 模式体验: XIAKE_MODE=mock`,
    ].join("\n");
  }

  const result = simulateBattle(playerTeam, boss.team, BigInt(Date.now()));

  const rewardLines: string[] = [];
  if (result.winner === 0) {
    const repGain = 120;
    state.reputation += repGain;
    rewardLines.push(`🏆 擂台大捷!击败「${boss.title}」,声望 +${repGain} (当前: ${state.reputation})`);

    const firstKill = !defeated.includes(boss.slug);
    if (firstKill) {
      setArenaDefeated(state, [...defeated, boss.slug]);
      const recipient = playerTeam[Math.floor(Math.random() * playerTeam.length)]!;
      const k = recipient.tokenId.toString();
      state.skillBeads[k] = [...(state.skillBeads[k] ?? []), boss.signatureSkillId];
      const skName = SKILL_NAMES[boss.signatureSkillId] ?? `技能#${boss.signatureSkillId}`;
      rewardLines.push(`🎁 签名技能珠掉落!${SECT_NAMES[recipient.sect]}·${recipient.name} 获得「${skName}」`);
      rewardLines.push(`   用「装备 #${recipient.tokenId} <slot> ${boss.signatureSkillId}」装备。`);
      // 擂台 BOSS 首杀奖励 +1 免费 mint 额度 (合约 grantBossMint 自动触发;mock 在此模拟)
      state.allowance.bossRewards = state.allowance.bossRewards + 1;
      state.allowance.free = state.allowance.free + 1;
      rewardLines.push(`🎁 免费额度 +1 (BOSS 首杀),当前 free=${state.allowance.free} boss=${state.allowance.bossRewards}`);
    } else {
      rewardLines.push(`ℹ️ 此 BOSS 你已击败过一次,签名技能珠不再掉落。`);
    }
    // 金疮药掉落: 擂台胜利必掉 2 瓶 (mock 分支,onchain 已 early return)
    state.potions += 2;
    rewardLines.push(`💊 金疮药 +2 (库存 ${state.potions} 瓶)`);
  } else if (result.winner === 1) {
    const victims = applyDefeatWounds(state, playerTeam, true);
    rewardLines.push(`💀 擂台败北... (重伤等级 2)`);
    for (const v of victims) {
      const secs = Math.max(0, Math.ceil((getHealth(state, v.tokenId).cooldownUntil - Date.now()) / 1000));
      rewardLines.push(`   ⚕️ ${SECT_NAMES[v.sect]}·${v.name} #${v.tokenId} 受伤,需恢复 ${secs}s`);
    }
  } else {
    rewardLines.push("⚖️ 平局,不分胜负。");
  }
  recordBattle(state, {
    kind: "arena",
    subtitle: `🏯 名人擂台: ${boss.title}`,
    winner: result.winner,
    playerTeam: [...playerTeam],
    opponentTeam: [...boss.team],
    opponentLabel: "擂主阵容",
    events: [...result.events],
  });
  const achUnlocked = checkAchievements(state, {
    kind: "arena",
    playerWon: result.winner === 0,
    playerTeam,
    events: result.events,
  });
  for (const l of renderUnlockBanner(achUnlocked)) rewardLines.push(l);
  saveState(state);

  // 擂台默认 epic
  const reportMode = resolveReportMode("epic");

  return renderBattleReport({
    header: `🔗 模式: ${mode}`,
    subtitle: `🏯 名人擂台: ${boss.title}\n   ${boss.tagline}`,
    playerTeam,
    opponentTeam: boss.team,
    opponentLabel: "擂主阵容",
    result,
    mode: reportMode,
    rewardLines,
    closingHint: "📜 请用金庸说书人风格,逐回合解说这场擂台决战。描述招式交锋,加入角色性格,总结 MVP。",
  });
}

// ── Hero generation ────────────────────────────────────────────────────────

function generateHeroes(
  count: number,
  seed: number,
  startId: bigint,
  existingHeroes: Hero[],
  forceSectOverride: Sect | null = null,
): Hero[] {
  let s = Math.abs(seed | 0) || 1;
  const rng = () => { s = Math.abs((s * 16807) % 2147483647) || 1; return s / 2147483647; };

  // Sect distribution — favour under-represented sects for diversity across mint calls.
  const sectCounts: Record<Sect, number> = {
    [Sect.Shaolin]: 0, [Sect.Tangmen]: 0, [Sect.Emei]: 0,
    [Sect.Wudang]: 0, [Sect.Beggars]: 0, [Sect.Huashan]: 0, [Sect.Ming]: 0,
  };
  for (const h of existingHeroes) sectCounts[h.sect] = (sectCounts[h.sect] ?? 0) + 1;

  const need = Math.max(1, Math.min(3, count));
  const picked: typeof HERO_POOL = [];
  const pickedSects: Sect[] = [];

  // First-mint genesis path: empty roster + mint 3 → guarantee one of each sect
  // (random permutation). Prevents the common "3-Shaolin start" that makes
  // early stages trivial due to lack of burst/healing variety.
  // Skipped when the caller demands an explicit派系 via `forceSectOverride`
  // (Wave 2 · 30 抽派系保底).
  // First-mint genesis keeps the classic Shaolin/Tangmen/Emei triplet because
  // the story tutorial (Chapter 1) is built around those three. Beyond the
  // genesis 3 free pulls, the full 7-sect pool opens up.
  const forcedSects: Sect[] | null =
    forceSectOverride === null && existingHeroes.length === 0 && need === 3
      ? (() => {
          const order: Sect[] = [Sect.Shaolin, Sect.Tangmen, Sect.Emei];
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [order[i], order[j]] = [order[j]!, order[i]!];
          }
          return order;
        })()
      : null;

  for (let i = 0; i < need; i++) {
    let chosenSect: Sect;
    if (forceSectOverride !== null) {
      chosenSect = forceSectOverride;
    } else if (forcedSects) {
      chosenSect = forcedSects[i]!;
    } else {
      // Weighted sect choice: weight = max(1, maxCount - thisCount + 1)
      // plus a strong penalty for sects already picked in this mint call so
      // diversity stays high even when roster is already lopsided.
      const effCounts: Record<Sect, number> = { ...sectCounts };
      for (const ps of pickedSects) effCounts[ps] += 5; // stronger penalty within the same call
      const sectList: Sect[] = [
        Sect.Shaolin, Sect.Tangmen, Sect.Emei,
        Sect.Wudang, Sect.Beggars, Sect.Huashan, Sect.Ming,
      ];
      const maxC = Math.max(...sectList.map(se => effCounts[se]));
      const weights = sectList.map(se => ({
        sect: se,
        w: Math.max(1, (maxC - effCounts[se]) * 2 + 1),
      }));
      const totalW = weights.reduce((a, b) => a + b.w, 0);
      let r = rng() * totalW;
      chosenSect = weights[0]!.sect;
      for (const w of weights) {
        r -= w.w;
        if (r <= 0) { chosenSect = w.sect; break; }
      }
    }

    // Avoid duplicate names already in hero roster or this mint batch
    const usedNames = new Set([...existingHeroes.map(h => h.name), ...picked.map(p => p.name)]);
    const candidates = HERO_POOL.filter(p => p.sect === chosenSect && !usedNames.has(p.name));
    const fallback = HERO_POOL.filter(p => p.sect === chosenSect);
    const pool = candidates.length > 0 ? candidates : fallback;
    const chosen = pool[Math.floor(rng() * pool.length)]!;
    picked.push(chosen);
    pickedSects.push(chosenSect);
    sectCounts[chosenSect]++;
  }

  return picked.map((h, i) => ({
    tokenId: startId + BigInt(i),
    sect: h.sect,
    name: h.name,
    hp: h.hp + Math.floor((rng() - 0.5) * 20),
    atk: h.atk + Math.floor((rng() - 0.5) * 10),
    def: h.def + Math.floor((rng() - 0.5) * 10),
    spd: h.spd + Math.floor((rng() - 0.5) * 10),
    crit: h.crit + Math.floor((rng() - 0.5) * 200),
    skillIds: h.skillIds,
  }));
}

// ── Battle simulation ───────────────────────────────────────────────────────

function simulateBattle(
  teamA: Hero[], teamB: Hero[], seed: bigint,
): { winner: 0 | 1 | 2; events: BattleEvent[]; snapshots: Map<number, HpSnapshot> } {
  const a: HeroState[] = teamA.map(h => ({ hero: h, currentHp: h.hp, buffs: [], alive: true }));
  const b: HeroState[] = teamB.map(h => ({ hero: h, currentHp: h.hp, buffs: [], alive: true }));
  const events: BattleEvent[] = [];
  const snapshots = new Map<number, HpSnapshot>();

  const buffLabel = (kind: SkillKind, skillHint?: number): string => {
    if (kind === SkillKind.Dot) return "中毒";
    if (kind === SkillKind.Control) return "沉默";
    if (typeof skillHint === "number") return SKILL_NAMES[skillHint] ?? "增益";
    return "增益";
  };

  const takeSnapshot = (round: number): void => {
    const heroes: HpSnapshot["heroes"] = [];
    a.forEach((st, i) => {
      heroes.push({
        hero: st.hero,
        side: "A",
        globalIdx: i,
        currentHp: st.currentHp,
        maxHp: st.hero.hp,
        alive: st.alive,
        buffs: st.buffs
          .filter(bf => bf.roundsLeft > 0)
          .map(bf => ({ label: buffLabel(bf.kind), rounds: bf.roundsLeft, kind: bf.kind })),
      });
    });
    b.forEach((st, i) => {
      heroes.push({
        hero: st.hero,
        side: "B",
        globalIdx: 3 + i,
        currentHp: st.currentHp,
        maxHp: st.hero.hp,
        alive: st.alive,
        buffs: st.buffs
          .filter(bf => bf.roundsLeft > 0)
          .map(bf => ({ label: buffLabel(bf.kind), rounds: bf.roundsLeft, kind: bf.kind })),
      });
    });
    snapshots.set(round, { heroes });
  };

  let s = Number(seed & 0xFFFFFFFFn) || 1;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };

  for (let round = 1; round <= 30; round++) {
    const turns: Array<{ side: "A"|"B"; idx: number; st: HeroState }> = [];
    a.forEach((st, i) => { if (st.alive) turns.push({ side: "A", idx: i, st }); });
    b.forEach((st, i) => { if (st.alive) turns.push({ side: "B", idx: i, st }); });
    turns.sort((x, y) => y.st.hero.spd - x.st.hero.spd);

    for (const turn of turns) {
      if (!turn.st.alive) continue;
      if (turn.st.buffs.some(bf => bf.kind === SkillKind.Control && bf.roundsLeft > 0)) continue;

      const mine = turn.side === "A" ? a : b;
      const theirs = turn.side === "A" ? b : a;
      const ga = turn.side === "A" ? turn.idx : turn.idx + 3;

      const skillId = pickSkill(turn.st, mine, theirs, rng);
      const eff = SKILL_EFFECT[skillId];
      if (!eff) continue;

      if (eff.kind === SkillKind.Damage) {
        const targets = eff.aoe ? theirs.filter(t => t.alive) : [lowest(theirs)].filter(Boolean);
        for (const t of targets) {
          if (!t) continue;
          const gt = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          const base = Math.floor((turn.st.hero.atk * eff.multBps) / 10000);
          const mit = Math.max(1, base - Math.floor(t.hero.def / 2));
          const isCrit = rng() * 10000 < turn.st.hero.crit;
          const dmg = isCrit ? Math.floor(mit * 1.5) : mit;
          t.currentHp = Math.max(0, t.currentHp - dmg);
          let fl = isCrit ? FLAG_CRIT : 0;
          if (t.currentHp === 0) { t.alive = false; fl |= FLAG_KILL; }
          events.push({ round, actorIdx: ga, skillId, targetIdx: gt, hpDelta: -dmg, flags: fl });
        }
      } else if (eff.kind === SkillKind.Heal) {
        const targets = eff.aoe ? mine.filter(t => t.alive) : [lowest(mine)].filter(Boolean);
        for (const t of targets) {
          if (!t) continue;
          const gt = (turn.side === "A" ? 0 : 3) + mine.indexOf(t);
          const healed = Math.min(eff.heal, t.hero.hp - t.currentHp);
          t.currentHp += healed;
          events.push({ round, actorIdx: ga, skillId, targetIdx: gt, hpDelta: healed, flags: 0 });
        }
      } else if (eff.kind === SkillKind.Buff) {
        turn.st.buffs.push({ kind: SkillKind.Buff, value: 30, roundsLeft: 2 });
        events.push({ round, actorIdx: ga, skillId, targetIdx: ga, hpDelta: 0, flags: 0 });
      } else if (eff.kind === SkillKind.Control) {
        const t = highAtk(theirs);
        if (t) {
          const gt = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          t.buffs.push({ kind: SkillKind.Control, value: 0, roundsLeft: 1 });
          events.push({ round, actorIdx: ga, skillId, targetIdx: gt, hpDelta: 0, flags: 0 });
        }
      } else if (eff.kind === SkillKind.Dot) {
        const t = lowest(theirs);
        if (t) {
          const gt = (turn.side === "A" ? 3 : 0) + theirs.indexOf(t);
          t.buffs.push({ kind: SkillKind.Dot, value: Math.max(1, Math.floor(t.hero.hp * 0.1)), roundsLeft: 3 });
          events.push({ round, actorIdx: ga, skillId, targetIdx: gt, hpDelta: 0, flags: 0 });
        }
      }
    }

    [...a, ...b].forEach(h => {
      h.buffs.filter(bf => bf.kind === SkillKind.Dot && bf.roundsLeft > 0).forEach(bf => {
        if (!h.alive) return;
        h.currentHp = Math.max(0, h.currentHp - bf.value);
        if (h.currentHp === 0) h.alive = false;
      });
      h.buffs = h.buffs.map(bf => ({ ...bf, roundsLeft: bf.roundsLeft - 1 })).filter(bf => bf.roundsLeft > 0);
    });

    takeSnapshot(round);

    const aOk = a.some(h => h.alive);
    const bOk = b.some(h => h.alive);
    if (!aOk && !bOk) return { winner: 2, events, snapshots };
    if (!aOk) return { winner: 1, events, snapshots };
    if (!bOk) return { winner: 0, events, snapshots };
  }

  const aHp = a.reduce((s, h) => s + h.currentHp, 0);
  const bHp = b.reduce((s, h) => s + h.currentHp, 0);
  const aMaxHp = a.reduce((s, h) => s + h.hero.hp, 0);
  const bMaxHp = b.reduce((s, h) => s + h.hero.hp, 0);
  const totalMax = Math.max(1, aMaxHp + bMaxHp);
  const hpDiffPct = Math.abs(aHp - bHp) / totalMax;
  if (hpDiffPct < 0.2) return { winner: 2, events, snapshots };
  return { winner: aHp >= bHp ? 0 : 1, events, snapshots };
}

function pickSkill(actor: HeroState, mine: HeroState[], theirs: HeroState[], rng: () => number): number {
  const sk = actor.hero.skillIds;
  const wounded = mine.find(h => h.alive && h.currentHp < h.hero.hp * 0.4);
  const healSk = sk.find(s => SKILL_EFFECT[s]?.kind === SkillKind.Heal);
  if (wounded && healSk !== undefined) return healSk;
  const nAlive = theirs.filter(h => h.alive).length;
  const aoeSk = sk.find(s => SKILL_EFFECT[s]?.kind === SkillKind.Damage && SKILL_EFFECT[s]?.aoe);
  if (nAlive >= 2 && aoeSk !== undefined && rng() > 0.4) return aoeSk;
  return sk.find(s => { const k = SKILL_EFFECT[s]?.kind; return k === SkillKind.Damage || k === SkillKind.Dot; }) ?? sk[0]!;
}

function lowest(t: HeroState[]): HeroState | undefined {
  return t.filter(h => h.alive).sort((a, b) => a.currentHp - b.currentHp)[0];
}

function highAtk(t: HeroState[]): HeroState | undefined {
  return t.filter(h => h.alive).sort((a, b) => b.hero.atk - a.hero.atk)[0];
}

// ── Wave 2 · gacha v2 commands ──────────────────────────────────────────────

async function cmdExchange(args: string[]): Promise<string> {
  const mode = getMode();
  const state = loadState();

  if (args.length === 0) {
    return [
      "用法: exchange <id> <id> ...  — 将重复英雄熔炼成声望碎片",
      `每位英雄 = ${SHARDS_PER_DUPLICATE} 碎片,${SHARDS_PER_PITY_BOOST} 碎片可 \`pity-boost\` 加速保底。`,
      `当前碎片: ${state.shards}`,
    ].join("\n");
  }

  let ids: bigint[];
  try {
    ids = args.map(a => BigInt(a));
  } catch {
    return `⚠️ tokenId 无法解析: ${args.join(" ")}`;
  }
  if (new Set(ids.map(id => id.toString())).size !== ids.length) {
    return "⚠️ tokenId 不可重复";
  }
  const owned = new Set(state.heroes.map(h => h.tokenId.toString()));
  const missing = ids.filter(id => !owned.has(id.toString()));
  if (missing.length > 0) {
    return `⚠️ 以下侠客不在你的名下,无法熔炼: ${missing.map(id => `#${id}`).join(", ")}`;
  }
  // Refuse to burn the entire active team — would soft-lock the player.
  const activeSet = new Set(resolveActiveTeam(state).map(h => h.tokenId.toString()));
  const activeHit = ids.filter(id => activeSet.has(id.toString()));
  if (activeHit.length > 0 && state.heroes.length - ids.length < 3) {
    return `⚠️ 出战阵容中的侠客不可熔炼,或熔炼后侠客不足 3 位: ${activeHit.map(id => `#${id}`).join(", ")}`;
  }

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { encodeFunctionData } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();

      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "exchangeDuplicate",
        args: [ids],
      });
      const { txHash } = await withRetry("exchangeDuplicate", () =>
        signAndSend({ to: hero, data, from: player }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );

      // Refresh shards from chain.
      try {
        const shardsVal = await getPublicClient().readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "shards",
          args: [player],
        }) as bigint;
        state.shards = Number(shardsVal);
      } catch {
        state.shards += ids.length * SHARDS_PER_DUPLICATE;
      }
      // Drop burnt heroes from the local roster.
      const burntKey = new Set(ids.map(id => id.toString()));
      state.heroes = state.heroes.filter(h => !burntKey.has(h.tokenId.toString()));
      state.activeTeam = state.activeTeam.filter(id => !burntKey.has(id.toString()));
      saveState(state);

      lines.push(`🔥 已熔炼 ${ids.length} 位重复侠客 → +${ids.length * SHARDS_PER_DUPLICATE} 声望碎片`);
      lines.push(`   总碎片: ${state.shards}`);
      lines.push(`   tx: ${txHash}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 上链熔炼失败: ${(err as Error).message}`);
      lines.push("   (回退本地 mock 记账,下次同步时请重试)");
    }
  }

  // mock path (or onchain fallback)
  const burntKey = new Set(ids.map(id => id.toString()));
  state.heroes = state.heroes.filter(h => !burntKey.has(h.tokenId.toString()));
  state.activeTeam = state.activeTeam.filter(id => !burntKey.has(id.toString()));
  const earned = ids.length * SHARDS_PER_DUPLICATE;
  state.shards += earned;
  saveState(state);

  lines.push(`🔥 已熔炼 ${ids.length} 位重复侠客 → +${earned} 声望碎片`);
  lines.push(`   总碎片: ${state.shards}`);
  if (state.shards >= SHARDS_PER_PITY_BOOST) {
    const maxBoost = Math.floor(state.shards / SHARDS_PER_PITY_BOOST);
    lines.push(`   💡 可用 \`pity-boost ${Math.min(maxBoost, 5)}\` 加速派系保底。`);
  }
  return lines.join("\n");
}

async function cmdRefer(args: string[]): Promise<string> {
  const mode = getMode();
  const state = loadState();

  if (args.length === 0) {
    const lines: string[] = [];
    lines.push(`🔗 模式: ${mode}`);
    lines.push("用法: refer <address>  — 绑定推荐人钱包 (首付费前一次性)");
    lines.push(`推荐奖励: 被推荐人首次付费时,推荐人获得 ${REFERRAL_REWARD_ETH} ETH 卡券`);
    if (state.referredBy) {
      lines.push(`当前推荐人: ${state.referredBy}${state.referralPaid ? "  (首付费奖励已发放)" : "  (待首付费触发)"}`);
    } else {
      lines.push("当前未绑定推荐人。");
    }
    if (mode === "onchain" || mode === "sepolia") {
      try {
        const player = await ensurePlayerAddress(state);
        const { getPublicClient, getAddresses } = await import("./chain/client.js");
        const { heroNftAbi } = await import("./chain/abi.js");
        const pc = getPublicClient();
        const { hero } = getAddresses();
        const earned = await pc.readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "earnedFromReferral",
          args: [player],
        }) as bigint;
        const eth = Number(earned) / 1e18;
        lines.push(`我作为推荐人累计卡券 (链上): ${eth.toFixed(4)} ETH`);
      } catch {
        lines.push(`我作为推荐人累计卡券 (本地): ${state.referralEarned.toFixed(4)} ETH`);
      }
    } else {
      lines.push(`我作为推荐人累计卡券 (本地): ${state.referralEarned.toFixed(4)} ETH`);
    }
    return lines.join("\n");
  }

  const addr = args[0] ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    return `⚠️ 地址格式错误: ${addr}`;
  }
  if (state.referredBy) {
    return `⚠️ 已绑定推荐人 ${state.referredBy},不可重绑。`;
  }
  const self = state.playerAddress ?? "";
  if (self && addr.toLowerCase() === self.toLowerCase()) {
    return "⚠️ 不能把自己设成推荐人。";
  }

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { encodeFunctionData } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();
      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "setReferrer",
        args: [addr as `0x${string}`],
      });
      const { txHash } = await withRetry("setReferrer", () =>
        signAndSend({ to: hero, data, from: player }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );
      state.referredBy = addr;
      saveState(state);
      lines.push(`✅ 已绑定推荐人: ${addr}`);
      lines.push(`   首次付费抽卡时,${addr} 将获得 ${REFERRAL_REWARD_ETH} ETH 卡券`);
      lines.push(`   tx: ${txHash}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 上链绑定失败: ${(err as Error).message}`);
      lines.push("   (可能已在链上绑定 / 已付费,请检查)");
      return lines.join("\n");
    }
  }

  state.referredBy = addr;
  saveState(state);
  lines.push(`✅ 已绑定推荐人: ${addr}`);
  lines.push(`   首次付费抽卡时,推荐人获得 ${REFERRAL_REWARD_ETH} ETH 卡券 (mock 账本)`);
  return lines.join("\n");
}

async function cmdPityBoost(stepsArg?: string): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const steps = stepsArg ? parseInt(stepsArg, 10) : 1;

  if (!Number.isFinite(steps) || steps < 1) {
    return [
      `用法: pity-boost [steps=1]  — 消耗 ${SHARDS_PER_PITY_BOOST} 碎片换 +1 保底进度`,
      `当前: 保底 ${state.pityProgress.currentCount}/${SECT_PITY_THRESHOLD} · 碎片 ${state.shards}`,
    ].join("\n");
  }
  const cost = steps * SHARDS_PER_PITY_BOOST;
  if (state.shards < cost) {
    return `⚠️ 碎片不足,需要 ${cost},当前 ${state.shards}`;
  }

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { encodeFunctionData } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();
      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "pityBoost",
        args: [steps],
      });
      const { txHash } = await withRetry("pityBoost", () =>
        signAndSend({ to: hero, data, from: player }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );
      // Re-read authoritative state.
      try {
        const [pity, shardsVal] = await Promise.all([
          getPublicClient().readContract({
            address: hero,
            abi: heroNftAbi,
            functionName: "getPityProgress",
            args: [player],
          }) as Promise<readonly [number, number, number]>,
          getPublicClient().readContract({
            address: hero,
            abi: heroNftAbi,
            functionName: "shards",
            args: [player],
          }) as Promise<bigint>,
        ]);
        state.pityProgress = {
          currentCount: Number(pity[0]),
          sectCycle: Number(pity[1]),
          bossPityCount: Number(pity[2]),
        };
        state.shards = Number(shardsVal);
      } catch {
        state.shards -= cost;
        const capped = Math.min(SECT_PITY_THRESHOLD - 1, state.pityProgress.currentCount + steps);
        state.pityProgress.currentCount = capped;
      }
      saveState(state);
      lines.push(`✨ 已消耗 ${cost} 碎片 → 保底 +${steps}`);
      lines.push(`   新保底进度: ${state.pityProgress.currentCount}/${SECT_PITY_THRESHOLD}`);
      lines.push(`   剩余碎片: ${state.shards}`);
      lines.push(`   tx: ${txHash}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 上链加速失败: ${(err as Error).message}`);
      return lines.join("\n");
    }
  }

  // mock path
  state.shards -= cost;
  const capped = Math.min(SECT_PITY_THRESHOLD - 1, state.pityProgress.currentCount + steps);
  state.pityProgress.currentCount = capped;
  saveState(state);
  lines.push(`✨ 已消耗 ${cost} 碎片 → 保底 +${steps}`);
  lines.push(`   新保底进度: ${state.pityProgress.currentCount}/${SECT_PITY_THRESHOLD}`);
  lines.push(`   剩余碎片: ${state.shards}`);
  return lines.join("\n");
}

async function cmdAllowance(): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push("┌─ 免费额度状态 ──────────────────────────────┐");

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { getPublicClient, getAddresses } = await import("./chain/client.js");
      const { heroNftAbi } = await import("./chain/abi.js");
      const pc = getPublicClient();
      const { hero } = getAddresses();
      const [allowanceTuple, poolBalance] = await Promise.all([
        pc.readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "getMintAllowance",
          args: [player],
        }) as Promise<readonly [number, number, number, number, number]>,
        pc.readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "getPoolBalance",
          args: [],
        }) as Promise<bigint>,
      ]);
      const [free, boss, daily, paid, remaining] = allowanceTuple;
      const poolEth = (Number(poolBalance) / 1e18).toFixed(4);
      lines.push(`│ 👤 玩家: ${player}`);
      lines.push(`│ 🎁 可用额度 (remaining): ${remaining}`);
      lines.push(`│ 📅 本周免费: ${free}/5`);
      lines.push(`│ 🏆 BOSS 击败奖励: ${boss}`);
      lines.push(`│ ☀️ 日登累积: ${daily}`);
      lines.push(`│ 💰 已付费次数: ${paid}`);
      lines.push(`│ 💧 付费池余额: ${poolEth} ETH`);
      lines.push(`│ 💰 付费单价: ${PAID_MINT_PRICE_ETH} ETH/次`);
    } catch (err) {
      lines.push(`│ ⚠️ 读链失败: ${(err as Error).message}`);
      lines.push(`│   (合约 Week 4 方法可能尚未部署,回退本地展示)`);
      lines.push(`│ 📅 本周免费 (本地): ${state.allowance.free}/5`);
      lines.push(`│ 🏆 BOSS 击败奖励 (本地): ${state.allowance.bossRewards}`);
      lines.push(`│ ☀️ 日登累积 (本地): ${state.allowance.dailyRewards}`);
    }
  } else {
    const resetDate = new Date(state.allowance.lastReset);
    const nextReset = new Date(resetDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const daysLeft = Math.max(0, Math.ceil((nextReset.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    lines.push(`│ 📅 本周剩余: ${state.allowance.free}/5 (${daysLeft} 天后重置)`);
    lines.push(`│ 🏆 BOSS 击败奖励: ${state.allowance.bossRewards}`);
    lines.push(`│ ☀️ 日登累积: ${state.allowance.dailyRewards}`);
    lines.push(`│ 💰 付费补充: ${PAID_MINT_PRICE_ETH} ETH/次 (无频率限制)`);
  }

  lines.push("│");
  // Pity / shards block — Wave 2 gacha v2 deepening.
  const p = state.pityProgress;
  const nextSect = SECT_CYCLE_NAMES[p.sectCycle % 3];
  lines.push(`│ 🎯 派系保底: ${p.currentCount}/${SECT_PITY_THRESHOLD}  → 下一保底 ${nextSect}`);
  lines.push(`│ 🏆 BOSS 保底: ${p.bossPityCount}/${BOSS_PITY_THRESHOLD}`);
  lines.push(`│ 🔸 声望碎片: ${state.shards}  (${SHARDS_PER_PITY_BOOST} 碎片 = +1 pity)`);
  lines.push(`│ 💰 三档定价: 🥉 ${TIER_PRICE_ETH.bronze} / 🥈 ${TIER_PRICE_ETH.silver} / 🥇 ${TIER_PRICE_ETH.gold} ETH (十连 -10%)`);
  if (state.referredBy) {
    lines.push(`│ 🤝 推荐人: ${state.referredBy}${state.referralPaid ? " · 首付已发放" : " · 待首付"}`);
  }
  lines.push("│");
  lines.push("│ 快速操作:");
  if (mode === "mock" && state.allowance.free > 0) {
    lines.push(`│  - \`mint 1\` — 免费抽 1 个 (剩余 ${state.allowance.free} 次)`);
  } else if (mode === "mock") {
    lines.push(`│  - 本周免费额度已用完,下周同日重置`);
  } else {
    lines.push(`│  - \`mint 1\` — 链上自动扣额度`);
  }
  lines.push("│  - `mint paid 10 --tier gold` — 十连黄金档");
  lines.push("│  - `exchange <id> ...` — 重复英雄换声望碎片");
  lines.push("│  - `pity-boost [n]` — 碎片加速保底");
  lines.push("│  - `daily` — 每日领取 1 次免费额度");
  lines.push("└────────────────────────────────────────────");
  return lines.join("\n");
}

async function cmdDaily(): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const now = Date.now();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const player = await ensurePlayerAddress(state);
      const { encodeFunctionData } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();

      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "grantDailyMint",
        args: [player],
      });
      const { txHash } = await withRetry("grantDailyMint", () =>
        signAndSend({ to: hero, data, from: player }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );
      // 读回最新 allowance 供展示
      let dailyCount = "?";
      try {
        const tuple = await getPublicClient().readContract({
          address: hero,
          abi: heroNftAbi,
          functionName: "getMintAllowance",
          args: [player],
        }) as readonly [number, number, number, number, number];
        dailyCount = String(tuple[2]);
      } catch {}
      lines.push(`✅ 今日福利已领取!本周累积 ${dailyCount}/7`);
      lines.push(`   tx: ${txHash}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 日登上链失败: ${(err as Error).message}`);
      lines.push("   (合约可能已记录今日领取,或合约未部署 Week 4 方法)");
      return lines.join("\n");
    }
  }

  // mock 分支
  const COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20h
  const elapsed = now - (state.lastDailyClaim || 0);
  if (state.lastDailyClaim > 0 && elapsed < COOLDOWN_MS) {
    const remainingMs = COOLDOWN_MS - elapsed;
    const hrs = Math.floor(remainingMs / (3600 * 1000));
    const mins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
    lines.push(`⏳ 今日已领,${hrs}h${mins}m 后可再领`);
    lines.push(`   本周日登累积: ${state.allowance.dailyRewards}/7`);
    return lines.join("\n");
  }
  state.lastDailyClaim = now;
  state.allowance.dailyRewards = Math.min(7, state.allowance.dailyRewards + 1);
  state.allowance.free = Math.min(7, state.allowance.free + 1);
  saveState(state);
  lines.push(`✅ 今日福利已领取,本周累积 ${state.allowance.dailyRewards}/7`);
  lines.push(`   当前免费额度: ${state.allowance.free}/5 (含日登叠加)`);
  return lines.join("\n");
}

// 2-step schedule → execute 时间锁。mock 用 GameState.pendingWithdrawal 模拟,
// onchain 调 scheduleWithdrawal / executeWithdrawal。
const WITHDRAWAL_LOCK_MS = 2 * 24 * 60 * 60 * 1000; // 2 天时间锁

async function cmdAdminWithdraw(amountArg?: string, targetArg?: string): Promise<string> {
  const amount = amountArg ? parseFloat(amountArg) : 0;
  if (!Number.isFinite(amount) || amount <= 0) {
    return "用法: admin withdraw <amount> [target]\n例: admin withdraw 0.5 0xabc...";
  }
  const mode = getMode();
  const state = loadState();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push("⚠️  提款需要管理员权限 (onlyOwner)");

  if (mode === "onchain" || mode === "sepolia") {
    if (!targetArg || !/^0x[0-9a-fA-F]{40}$/.test(targetArg)) {
      return "用法 (onchain): admin withdraw <amount> <target 0x...>\n建议 target 设为 Gnosis Safe 多签。";
    }
    try {
      const admin = await ensurePlayerAddress(state);
      const { encodeFunctionData, parseEther } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();

      const wei = parseEther(amount.toString());
      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "scheduleWithdrawal",
        args: [targetArg as `0x${string}`, wei],
      });
      const { txHash } = await withRetry("scheduleWithdrawal", () =>
        signAndSend({ to: hero, data, from: admin }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );
      lines.push(`💸 已调度提款: ${amount} ETH → ${targetArg}`);
      lines.push(`   tx: ${txHash}`);
      lines.push(`   ⏳ 48h 后可执行 (合约时间锁)`);
      lines.push(`   接下来: admin execute ${amount}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 上链失败: ${(err as Error).message}`);
      return lines.join("\n");
    }
  }

  // mock:记录本地 pendingWithdrawal
  const target = targetArg || "0xMOCK_TARGET";
  state.pendingWithdrawal = {
    target,
    amount,
    executeAfter: Date.now() + WITHDRAWAL_LOCK_MS,
  };
  saveState(state);
  lines.push(`💸 已调度提款: ${amount} ETH → ${target}`);
  lines.push(`   ⏳ 48h 后可执行 (${new Date(state.pendingWithdrawal.executeAfter).toISOString()})`);
  lines.push(`   接下来: admin execute ${amount}`);
  return lines.join("\n");
}

async function cmdAdminExecute(amountArg?: string): Promise<string> {
  const amount = amountArg ? parseFloat(amountArg) : 0;
  if (!Number.isFinite(amount) || amount <= 0) {
    return "用法: admin execute <amount>\n例: admin execute 0.5";
  }
  const mode = getMode();
  const state = loadState();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const admin = await ensurePlayerAddress(state);
      const { encodeFunctionData, parseEther } = await import("viem");
      const { heroNftAbi } = await import("./chain/abi.js");
      const { getAddresses, getPublicClient } = await import("./chain/client.js");
      const { signAndSend } = await import("./onchainos/gateway.js");
      const { hero } = getAddresses();

      const wei = parseEther(amount.toString());
      const data = encodeFunctionData({
        abi: heroNftAbi,
        functionName: "executeWithdrawal",
        args: [wei],
      });
      const { txHash } = await withRetry("executeWithdrawal", () =>
        signAndSend({ to: hero, data, from: admin }),
      );
      await withRetry("等待交易上链", () =>
        getPublicClient().waitForTransactionReceipt({ hash: txHash }),
      );
      lines.push(`✅ 执行提款: ${amount} ETH`);
      lines.push(`   tx: ${txHash}`);
      return lines.join("\n");
    } catch (err) {
      lines.push(`⚠️ 执行失败: ${(err as Error).message}`);
      lines.push("   (可能时间锁未到期或无 pending schedule)");
      return lines.join("\n");
    }
  }

  // mock
  const pending = state.pendingWithdrawal;
  if (!pending) return `${lines.join("\n")}\n⚠️ 无待执行的提款。先调用 admin withdraw <amount>`;
  if (Math.abs(pending.amount - amount) > 1e-9) {
    return `${lines.join("\n")}\n⚠️ 金额不匹配: 已调度 ${pending.amount} ETH,传入 ${amount} ETH`;
  }
  const now = Date.now();
  if (now < pending.executeAfter) {
    const remainingMs = pending.executeAfter - now;
    const hrs = Math.floor(remainingMs / (3600 * 1000));
    return `${lines.join("\n")}\n⏳ 时间锁未到期,还需 ${hrs}h 后可执行`;
  }
  lines.push(`✅ 执行提款: ${pending.amount} ETH → ${pending.target}`);
  state.pendingWithdrawal = undefined;
  saveState(state);
  return lines.join("\n");
}

async function cmdAdminStatus(): Promise<string> {
  const mode = getMode();
  const state = loadState();
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push("🔐 Admin — 提款状态");
  lines.push("─".repeat(50));

  if (mode === "onchain" || mode === "sepolia") {
    try {
      const { getPublicClient, getAddresses } = await import("./chain/client.js");
      const { heroNftAbi } = await import("./chain/abi.js");
      const pc = getPublicClient();
      const { hero } = getAddresses();
      const pending = await pc.readContract({
        address: hero,
        abi: heroNftAbi,
        functionName: "pendingWithdrawal",
        args: [],
      }) as readonly [`0x${string}`, bigint, bigint];
      const [target, amountWei, executeAfter] = pending;
      const amountEth = (Number(amountWei) / 1e18).toFixed(4);
      const executeAfterMs = Number(executeAfter) * 1000;
      const now = Date.now();
      if (amountWei === 0n) {
        lines.push("(无待执行的提款)");
      } else {
        lines.push(`💸 待执行: ${amountEth} ETH → ${target}`);
        if (now >= executeAfterMs) {
          lines.push(`   ✅ 时间锁已到期,可立即执行`);
        } else {
          const remainingMs = executeAfterMs - now;
          const hrs = Math.floor(remainingMs / (3600 * 1000));
          const mins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
          lines.push(`   ⏳ 还需 ${hrs}h${mins}m 到期 (${new Date(executeAfterMs).toISOString()})`);
        }
      }
      const poolBalance = await pc.readContract({
        address: hero,
        abi: heroNftAbi,
        functionName: "getPoolBalance",
        args: [],
      }) as bigint;
      lines.push(`💧 付费池: ${(Number(poolBalance) / 1e18).toFixed(4)} ETH`);
    } catch (err) {
      lines.push(`⚠️ 读链失败: ${(err as Error).message}`);
    }
    return lines.join("\n");
  }

  const pending = state.pendingWithdrawal;
  if (!pending) {
    lines.push("(无待执行的提款)");
    return lines.join("\n");
  }
  const now = Date.now();
  lines.push(`💸 待执行: ${pending.amount} ETH → ${pending.target}`);
  if (now >= pending.executeAfter) {
    lines.push(`   ✅ 时间锁已到期,可立即执行: admin execute ${pending.amount}`);
  } else {
    const remainingMs = pending.executeAfter - now;
    const hrs = Math.floor(remainingMs / (3600 * 1000));
    const mins = Math.floor((remainingMs % (3600 * 1000)) / (60 * 1000));
    lines.push(`   ⏳ 还需 ${hrs}h${mins}m 到期 (${new Date(pending.executeAfter).toISOString()})`);
  }
  return lines.join("\n");
}

// ── Achievements / Replay / Season commands ────────────────────────────────

function cmdAchievements(): string {
  const mode = getMode();
  const state = loadState();
  // Refresh stateless achievements (first_mint / three_sects / skill_bead /
  // chapter1_clear) in case earlier game actions predate this system.
  checkAchievements(state);
  saveState(state);

  const total = ACHIEVEMENTS.length;
  const got = ACHIEVEMENTS.filter(a => state.achievements[a.id]?.earned).length;
  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push(`🏆 已获成就 (${got}/${total})`);
  lines.push("━".repeat(50));
  for (const a of ACHIEVEMENTS) {
    const rec = state.achievements[a.id] ?? { earned: false, progress: 0, unlockedAt: 0 };
    if (rec.earned) {
      lines.push(`✅ ${a.name} — ${a.desc}`);
    } else {
      const prog = ` (进度 ${Math.min(rec.progress, a.target)}/${a.target})`;
      lines.push(`🔒 ${a.name} — ${a.desc}${prog}`);
    }
  }
  lines.push("");
  lines.push(`进度: ${got}/${total} 成就已解锁`);
  return lines.join("\n");
}

function cmdReplay(args: string[]): string {
  const mode = getMode();
  const state = loadState();
  // TODO(onchain): future versions can read BattleReport from chain via
  //   chain/reads.ts#fetchBattleReport(battleId) instead of local history.
  const history = state.battleHistory;
  if (history.length === 0) {
    return "📜 暂无战报。先打一场 PVE / 擂台再来复盘。";
  }

  if (args.length === 0) {
    const lines: string[] = [];
    lines.push(`🔗 模式: ${mode}`);
    lines.push(`📜 战报回放 (最近 ${Math.min(10, history.length)} 场 / 共 ${history.length})`);
    lines.push("━".repeat(50));
    const start = Math.max(0, history.length - 10);
    for (let i = history.length - 1; i >= start; i--) {
      const b = history[i]!;
      const idx = i + 1;
      const win = b.winner === 0 ? "🏆 胜" : b.winner === 1 ? "💀 败" : "⚖️ 平";
      const when = new Date(b.timestamp).toISOString().replace("T", " ").slice(0, 19);
      const kind = b.kind ?? "pve";
      const stage = b.stageId ? `[${b.stageId}] ` : "";
      const mvp = b.mvpName ? `  MVP ${b.mvpName}` : "";
      lines.push(`  #${idx}  ${when}  ${kind.padEnd(5)} ${stage}${win}${mvp}`);
    }
    lines.push("");
    lines.push("用法: replay <index> — 重放指定编号的战斗 (lite 模式)");
    return lines.join("\n");
  }

  const idx = parseInt(args[0] ?? "", 10);
  if (!Number.isFinite(idx) || idx < 1 || idx > history.length) {
    return `⚠️ 无效编号: ${args[0]} (可选范围 1..${history.length})`;
  }
  const b = history[idx - 1]!;
  if (!b.events || !b.playerTeam || !b.opponentTeam) {
    return `⚠️ 编号 #${idx} 为旧版战报,不含详细事件,无法重放。`;
  }
  const result = {
    winner: b.winner,
    events: b.events,
    snapshots: new Map<number, HpSnapshot>(),
  };
  const header = `🔗 模式: ${mode} · 📼 复盘 #${idx}`;
  const subtitle = b.subtitle ?? (b.stageId ? `⚔️ PVE ${b.stageId}` : "⚔️ 战斗回放");
  const rewardLines: string[] = [
    `⏱️ 战斗时间: ${new Date(b.timestamp).toISOString().replace("T", " ").slice(0, 19)}`,
    b.winner === 0 ? "🏆 胜利" : b.winner === 1 ? "💀 败北" : "⚖️ 僵局",
  ];
  return renderBattleReport({
    header,
    subtitle,
    playerTeam: b.playerTeam,
    opponentTeam: b.opponentTeam,
    opponentLabel: b.opponentLabel ?? "对手阵容",
    result,
    mode: "lite",
    rewardLines,
    closingHint: "📜 复盘模式 (lite) · 只显示结局 + MVP,想看细节请 XIAKE_REPORT_MODE=full 重打",
  });
}

function cmdSeason(): string {
  const mode = getMode();
  const state = loadState();
  const roll = checkSeasonEnd(state);
  if (roll.rolled) saveState(state);

  const now = Date.now();
  const remMs = Math.max(0, state.season.endsAt - now);
  const remDays = Math.floor(remMs / (24 * 3600 * 1000));
  const remHrs = Math.floor((remMs % (24 * 3600 * 1000)) / (3600 * 1000));

  const lines: string[] = [];
  lines.push(`🔗 模式: ${mode}`);
  lines.push(`🏅 赛季 ${state.season.current} (${SEASON_DAYS} 天一季)`);
  lines.push("━".repeat(50));
  lines.push(`开始: ${new Date(state.season.startsAt).toISOString().slice(0, 10)}`);
  lines.push(`结束: ${new Date(state.season.endsAt).toISOString().slice(0, 10)}`);
  lines.push(`剩余: ${remDays} 天 ${remHrs} 小时`);
  lines.push("");
  lines.push(`本赛季声望: ${state.reputation}`);
  if (state.season.lastRank !== undefined) {
    lines.push(`上赛季排名: #${state.season.lastRank}${state.season.lastRank <= 100 ? " (前 100,已获保底重置卡)" : ""}`);
  } else {
    lines.push(`上赛季排名: — (首个赛季)`);
  }
  lines.push("");
  lines.push("⚠️ 赛季结束后声望清零 50%,前 100 名获保底重置卡");
  lines.push("(赛季榜单 top100 将由 onchain-eng 在 P2 接合约读取)");
  if (roll.note) lines.push(roll.note);
  return lines.join("\n");
}

// ── Sect lore ───────────────────────────────────────────────────────────────

const SECT_LORE: Record<Sect, { name: string; role: string; home: string; bio: string; signature: string }> = {
  [Sect.Shaolin]: {
    name: "少林", role: "坦克·治疗", home: "嵩山少林寺",
    bio: "禅宗祖庭,武林泰山北斗。金钟罩铁布衫护体,易筋经养气调息。讲究「以武入禅」,出手先劝人回头,劝不动才抡起禅杖。",
    signature: "金钟罩 · 易筋经 · 狮子吼",
  },
  [Sect.Tangmen]: {
    name: "唐门", role: "刺客·爆发", home: "四川唐家堡",
    bio: "暗器与毒药的宗师世家。家规森严,暗器千变,毒药万计。远程秒杀最可怕,近战反而是他们的短板。",
    signature: "穿心刺 · 暗器急雨 · 毒针",
  },
  [Sect.Emei]: {
    name: "峨眉", role: "辅助·净化", home: "四川峨眉山",
    bio: "佛道合一的女子门派。慈航普渡救人,净心咒洗去邪魔。战场上的最后防线,也是最温柔的后盾。",
    signature: "慈航普渡 · 净心咒 · 般若掌",
  },
  [Sect.Wudang]: {
    name: "武当", role: "均衡·反制", home: "湖北武当山",
    bio: "张三丰开派,太极两仪。讲究「以柔克刚、后发制人」,打的不是比你快,而是比你稳。你一出招,他就知道你下一招。",
    signature: "太极推手 · 梯云纵 · 真武破军",
  },
  [Sect.Beggars]: {
    name: "丐帮", role: "控场·buff", home: "流浪江湖,遍地是家",
    bio: "天下第一大帮。没地盘、没金库、靠一根打狗棒闯天下。人多势众,醉八仙越喝越勇,降龙十八掌一出地动山摇。",
    signature: "降龙十八掌 · 打狗棒法 · 醉八仙",
  },
  [Sect.Huashan]: {
    name: "华山", role: "剑术·高暴击", home: "陕西华山",
    bio: "剑术一脉正宗,分气宗剑宗之争。独孤九剑「有进无退」——打架只看谁剑快,谁破绽先暴露给谁。华山论剑非虚名。",
    signature: "独孤九剑 · 紫霞神功 · 华山群剑",
  },
  [Sect.Ming]: {
    name: "明教", role: "毒术·破防", home: "昆仑光明顶",
    bio: "源自波斯,传入中原已历三百年。教众素服白衣,信奉光明战胜黑暗。江湖视其为魔教,教中人视江湖为腐朽。乾坤大挪移一出,旧秩序灰飞烟灭。",
    signature: "圣火令 · 乾坤大挪移 · 毒沙掌",
  },
};

function _parseSectArg(arg: string | undefined): Sect | null {
  if (arg === undefined) return null;
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 0 && n < SECT_CYCLE.length) return n as Sect;
  const map: Record<string, Sect> = {
    "少林": Sect.Shaolin, "shaolin": Sect.Shaolin,
    "唐门": Sect.Tangmen, "tangmen": Sect.Tangmen,
    "峨眉": Sect.Emei, "emei": Sect.Emei,
    "武当": Sect.Wudang, "wudang": Sect.Wudang,
    "丐帮": Sect.Beggars, "beggars": Sect.Beggars,
    "华山": Sect.Huashan, "huashan": Sect.Huashan,
    "明教": Sect.Ming, "ming": Sect.Ming,
  };
  return map[arg.toLowerCase()] ?? map[arg] ?? null;
}

function cmdLore(arg: string | undefined): string {
  const lines: string[] = [];
  const sect = _parseSectArg(arg);
  if (sect === null) {
    // List all 7 sects with one-line blurbs.
    lines.push("⛩️  七大门派");
    lines.push("─".repeat(50));
    for (const s of SECT_CYCLE) {
      const L = SECT_LORE[s];
      lines.push(`  ${SECT_ICON[s]} ${L.name} · ${L.role}`);
      lines.push(`    ${L.home}`);
    }
    lines.push("");
    lines.push("用 `lore <门派名>` 查看详细背景, 例如: lore 武当");
    return lines.join("\n");
  }
  const L = SECT_LORE[sect];
  lines.push(`${SECT_ICON[sect]}  ${L.name}  ·  ${L.role}`);
  lines.push("─".repeat(50));
  lines.push(`门派地盘: ${L.home}`);
  lines.push(`招牌武学: ${L.signature}`);
  lines.push("");
  lines.push(L.bio);
  // Affinity hints
  const cycle = SECT_CYCLE;
  const idx = cycle.indexOf(sect);
  const strong = cycle[(idx + 1) % cycle.length];
  const weak = cycle[(idx + cycle.length - 1) % cycle.length];
  lines.push("");
  lines.push(`⚔️ 克 ${SECT_NAMES[strong]} (+15% 伤害)`);
  lines.push(`🛡️ 被 ${SECT_NAMES[weak]} 克 (-15% 受伤)`);
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  try {
    switch (cmd) {
      case "init":    console.log(cmdInit()); break;
      case "mint":    {
        const paid = args.includes("paid");
        const dryRun = args.includes("--dry-run");
        const tier = parseTier(args);
        // Find the count token: first non-flag, non-"paid" positional arg.
        const skipSet = new Set(["paid", "--dry-run", "--tier", tier]);
        const countTok = args.find(a => !skipSet.has(a) && !a.startsWith("--"));
        console.log(await cmdMint(countTok, { paid, dryRun, tier }));
        break;
      }
      case "exchange": console.log(await cmdExchange(args)); break;
      case "refer":    console.log(await cmdRefer(args)); break;
      case "pity-boost": console.log(await cmdPityBoost(args[0])); break;
      case "allowance": console.log(await cmdAllowance()); break;
      case "daily":   console.log(await cmdDaily()); break;
      case "team":    console.log(cmdTeam(args)); break;
      case "heroes":  console.log(cmdHeroes()); break;
      case "stages":  console.log(cmdStages()); break;
      case "pve":     console.log(await cmdPve(args[0] ?? "1-1")); break;
      case "pvp":     console.log(await cmdPvp(args)); break;
      case "defense": console.log(await cmdSetDefense(args)); break;
      case "list-arena": console.log(await cmdListArena(args)); break;
      case "auto":    console.log(await cmdAutoTrain(args[0])); break;
      case "status":  console.log(cmdStatus()); break;
      case "wounds":  console.log(cmdWounds()); break;
      case "equip":   console.log(cmdEquip(args)); break;
      case "heal":    console.log(await cmdHeal(args[0])); break;
      case "arena":   console.log(await cmdArena(args[0])); break;
      case "achievements": console.log(cmdAchievements()); break;
      case "replay":  console.log(cmdReplay(args)); break;
      case "season":  console.log(cmdSeason()); break;
      case "lore":    console.log(cmdLore(args[0])); break;
      case "admin":   {
        const subcmd = args[0];
        if (subcmd === "withdraw") console.log(await cmdAdminWithdraw(args[1], args[2]));
        else if (subcmd === "execute") console.log(await cmdAdminExecute(args[1]));
        else if (subcmd === "status") console.log(await cmdAdminStatus());
        else console.log("admin 子命令: withdraw <amount> [target] | execute <amount> | status");
        break;
      }
      default:
        console.log("用法: node cli.js <init|mint|team|heroes|stages|pve|pvp|defense|list-arena|status|wounds|equip|allowance|daily|admin>");
        console.log("  init                          — 进入游戏 (首行打印当前模式)");
        console.log("  mint [count]                  — 招募侠客,自动检查免费额度");
        console.log("  mint paid [count]             — 显式付费抽卡");
        console.log("  mint paid [count] --dry-run   — 预览付费 (显示余额)");
        console.log("  mint paid [count] --tier gold — 三档: bronze/silver/gold (默认 silver, 十连 -10%)");
        console.log("  exchange <id> <id> ...        — 熔炼重复英雄换声望碎片 (5 碎片/位)");
        console.log("  pity-boost [steps=1]          — 消耗碎片加速 30 抽派系保底");
        console.log("  refer <address>               — 绑定推荐人 (首付费时推荐人得 0.002 ETH 卡券)");
        console.log("  allowance                     — 查看免费额度 + BOSS 奖励 + 日登");
        console.log("  daily                         — 领取每日福利 (每 20h 一次)");
        console.log("  team <id1> <id2> <id3>        — 设置出战阵容 (3 位 tokenId)");
        console.log("  heroes                        — 查看侠客 (含伤病/技能珠状态)");
        console.log("  stages                        — 查看关卡 (12 关,按章节分组)");
        console.log("  pve <stageId>                 — 闯关,支持 1-1 / 2-3 / 3-4 格式");
        console.log("  pvp ai                        — 随机 AI 对战 (练兵)");
        console.log("  pvp challenge <address>       — 挑战指定玩家的擂台防守阵容");
        console.log("  defense <id> <id> <id>        — 锁定擂台防守阵容 (3 位自有侠客)");
        console.log("  list-arena [limit]            — 查看擂台排行榜 (默认 5 位)");
        console.log("  status                        — 查看战绩");
        console.log("  wounds                        — 查看伤病中的侠客 + 剩余恢复秒数");
        console.log("  heal <tokenId>                — 消耗 1 瓶金疮药,立刻清除伤病");
        console.log("  equip <heroId> <slot> <skid>  — 装备技能珠 (slot 0-2)");
        console.log("  achievements                  — 查看成就列表 (10 项)");
        console.log("  replay [index]                — 战报复盘,无参数列最近 10 场");
        console.log("  season                        — 查看赛季信息 (14 天一季)");
        console.log("  lore [sect]                   — 查看门派背景 (7 派,参数: 少林/唐门/峨眉/武当/丐帮/华山/明教 或 0-6)");
        console.log("  admin withdraw <amt> [tgt]    — 调度提款 (2-step, 48h 时间锁)");
        console.log("  admin execute <amt>           — 时间锁到期后执行提款");
        console.log("  admin status                  — 查看待执行的 schedule");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`❌ 执行失败: ${msg}\n`);
    process.exit(1);
  }
}

main();
