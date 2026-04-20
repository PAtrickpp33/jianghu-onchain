// Shared types across the xiake-skill codebase.
// Authoritative reference: docs/TECHNICAL_DESIGN.md §3.2

// Sect indices must mirror Solidity `Types.Sect` exactly. Append-only.
export enum Sect {
  Shaolin = 0,
  Tangmen = 1,
  Emei = 2,
  Wudang = 3,
  Beggars = 4,
  Huashan = 5,
  Ming = 6,
}

export const SECT_NAMES: Record<Sect, string> = {
  [Sect.Shaolin]: "少林",
  [Sect.Tangmen]: "唐门",
  [Sect.Emei]: "峨眉",
  [Sect.Wudang]: "武当",
  [Sect.Beggars]: "丐帮",
  [Sect.Huashan]: "华山",
  [Sect.Ming]: "明教",
};

/// One-line role tag used in menus.
export const SECT_ROLE: Record<Sect, string> = {
  [Sect.Shaolin]: "坦克·治疗",
  [Sect.Tangmen]: "刺客·爆发",
  [Sect.Emei]: "辅助·净化",
  [Sect.Wudang]: "均衡·反制",
  [Sect.Beggars]: "控场·buff",
  [Sect.Huashan]: "剑术·高暴",
  [Sect.Ming]: "毒术·破防",
};

/// Unicode icon shown in hero cards.
export const SECT_ICON: Record<Sect, string> = {
  [Sect.Shaolin]: "🥋",
  [Sect.Tangmen]: "🗡️",
  [Sect.Emei]: "⛩️",
  [Sect.Wudang]: "☯️",
  [Sect.Beggars]: "🥖",
  [Sect.Huashan]: "⚔️",
  [Sect.Ming]: "🔥",
};

/// Ring-of-7 counter matrix. Each sect does +15% damage to the next in the
/// ring and takes +15% from the one before. Matches SectAffinity.sol.
export const SECT_CYCLE: Sect[] = [
  Sect.Shaolin,
  Sect.Tangmen,
  Sect.Emei,
  Sect.Wudang,
  Sect.Beggars,
  Sect.Huashan,
  Sect.Ming,
];

export function sectCounters(attacker: Sect, defender: Sect): number {
  const aIdx = SECT_CYCLE.indexOf(attacker);
  const dIdx = SECT_CYCLE.indexOf(defender);
  if (aIdx < 0 || dIdx < 0) return 10000;
  if ((aIdx + 1) % SECT_CYCLE.length === dIdx) return 11500; // attacker counters defender
  if ((dIdx + 1) % SECT_CYCLE.length === aIdx) return 8500;  // defender counters attacker
  return 10000;
}

export enum SkillKind {
  Damage = 0,
  Heal = 1,
  Buff = 2,
  Control = 3,
  Dot = 4,
}

export interface Hero {
  tokenId: bigint;
  sect: Sect;
  name: string;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  crit: number; // basis points, 0..10000
  skillIds: number[];
}

export interface SkillDef {
  id: number;
  name: string;
  kind: SkillKind;
  multiplier: number; // bps, 10000 = 100%
  duration: number;   // rounds for buff/debuff/dot
  description: string;
}

export interface BattleEvent {
  round: number;
  actorIdx: number;      // 0..5 (0..2 = side A, 3..5 = side B)
  skillId: number;
  targetIdx: number;
  hpDelta: number;       // negative for damage, positive for heal
  flags: number;         // bit0=crit, bit1=miss, bit2=kill
}

export interface BattleReport {
  battleId: `0x${string}`;
  attacker: `0x${string}`;
  defender: `0x${string}`;
  winner: 0 | 1 | 2;     // 0=attacker, 1=defender, 2=draw
  timestamp: number;
  attackerTeam: Hero[];
  defenderTeam: Hero[];
  events: BattleEvent[];
  txHash?: `0x${string}`;
}

export interface HeroState {
  hero: Hero;
  currentHp: number;
  buffs: Array<{ kind: SkillKind; value: number; roundsLeft: number }>;
  alive: boolean;
}

export interface AgentDecisionInput {
  mySide: HeroState[];
  enemySide: HeroState[];
  lastEnemyAction: BattleEvent | null;
  round: number;
  sectChart: Record<Sect, { counters: Sect; weakTo: Sect }>;
}

export interface AgentDecisionOutput {
  actorIdx: number;
  skillId: number;
  targetIdx: number;
  trashTalk: string;
}

// Flag helpers
export const FLAG_CRIT = 1 << 0;
export const FLAG_MISS = 1 << 1;
export const FLAG_KILL = 1 << 2;

export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}
