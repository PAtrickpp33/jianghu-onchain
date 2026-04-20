// Viem ABI constants for HeroNFT and Arena contracts.
// Authoritative reference: docs/TECHNICAL_DESIGN.md §3.3-§3.5
//
// Struct layouts mirror Types.sol exactly so `viem` can decode returned tuples
// via `parseAbi`-friendly fully-qualified signatures. We use the inline JSON
// ABI form here (not the human-readable parseAbi shorthand) because our
// structs include dynamic arrays which are clearer as explicit tuple components.

export const heroNftAbi = [
  {
    type: "function",
    name: "mintGenesis",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [{ name: "tokenIds", type: "uint256[3]" }],
  },
  {
    // Week 4: mintHero now takes an isPaid flag and is payable.
    type: "function",
    name: "mintHero",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "count", type: "uint8" },
      { name: "isPaid", type: "bool" },
    ],
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
  },
  {
    // Week 4 admin / allowance / daily surface. Mirrors
    // docs/GACHA_PRD_TECH.md §2.2 — contract-eng may land the final Solidity
    // after CLI Week 4; until then these fragments are authoritative for
    // encoding calldata on the skill side.
    type: "function",
    name: "getMintAllowance",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "free", type: "uint8" },
      { name: "boss", type: "uint8" },
      { name: "daily", type: "uint8" },
      { name: "paid", type: "uint16" },
      { name: "remaining", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "getPoolBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "grantDailyMint",
    stateMutability: "nonpayable",
    inputs: [{ name: "player", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "scheduleWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "executeWithdrawal",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pendingWithdrawal",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "target", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "executeAfter", type: "uint64" },
    ],
  },
  // -------------------------------------------------------------------------
  // Week 4 — gacha economy surface (BOSS / pause / price / allowance public map)
  // -------------------------------------------------------------------------
  {
    type: "function",
    name: "playerAllowance",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "freeGranted", type: "uint8" },
      { name: "earnedFromBoss", type: "uint8" },
      { name: "earnedFromDaily", type: "uint8" },
      { name: "usedFree", type: "uint16" },
      { name: "usedPaid", type: "uint16" },
    ],
  },
  {
    type: "function",
    name: "lastDailyClaim",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "bossFirstCleared",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "bossId", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "pricePerMint",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "emergencyPaused",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setPrice",
    stateMutability: "nonpayable",
    inputs: [{ name: "newPrice", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setEmergencyPause",
    stateMutability: "nonpayable",
    inputs: [{ name: "paused", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "grantBossMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "bossId", type: "uint8" },
    ],
    outputs: [],
  },
  // -------------------------------------------------------------------------
  // Wave 2 — gacha v2 deepening (pity / tier / exchange / referral)
  // -------------------------------------------------------------------------
  {
    type: "function",
    name: "mintHeroTier",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "count", type: "uint8" },
      { name: "isPaid", type: "bool" },
      { name: "tier", type: "uint8" },
    ],
    outputs: [{ name: "tokenIds", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "exchangeDuplicate",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenIds", type: "uint256[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "pityBoost",
    stateMutability: "nonpayable",
    inputs: [{ name: "steps", type: "uint16" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setReferrer",
    stateMutability: "nonpayable",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getPityProgress",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "currentCount", type: "uint16" },
      { name: "sectCycle", type: "uint8" },
      { name: "bossPityCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "playerPity",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "currentCount", type: "uint16" },
      { name: "sectCycle", type: "uint8" },
      { name: "bossPityCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "shards",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "referredBy",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "earnedFromReferral",
    stateMutability: "view",
    inputs: [{ name: "referrer", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PRICE_BRONZE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PRICE_SILVER",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "PRICE_GOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "SectPityReached",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "forcedSect", type: "uint8", indexed: false },
      { name: "nextCycle", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BossPityReached",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "cycleIndex", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DuplicateExchanged",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "tokenIds", type: "uint256[]", indexed: false },
      { name: "shardsEarned", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PityBoosted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "newCurrentCount", type: "uint16", indexed: false },
      { name: "shardsSpent", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ReferrerSet",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "referrer", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ReferralRewardGranted",
    inputs: [
      { name: "referrer", type: "address", indexed: true },
      { name: "referee", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MintAllowanceGranted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "source", type: "string", indexed: false },
      { name: "amount", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PaidMintProcessed",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "count", type: "uint8", indexed: false },
      { name: "totalCost", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BossMintGranted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "bossId", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DailyMintGranted",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "day", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PriceUpdated",
    inputs: [
      { name: "oldPrice", type: "uint256", indexed: false },
      { name: "newPrice", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalScheduled",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "executeAfter", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalExecuted",
    inputs: [
      { name: "target", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencyPauseToggled",
    inputs: [{ name: "paused", type: "bool", indexed: false }],
  },
  {
    type: "function",
    name: "playerMintCount",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "function",
    name: "hasMintedGenesis",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "HeroMinted",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "sect", type: "uint8", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getHero",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "hero",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "sect", type: "uint8" },
          { name: "hp", type: "uint16" },
          { name: "atk", type: "uint16" },
          { name: "def", type: "uint16" },
          { name: "spd", type: "uint16" },
          { name: "crit", type: "uint16" },
          { name: "skillIds", type: "uint8[]" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getHeroes",
    stateMutability: "view",
    inputs: [{ name: "ids", type: "uint256[]" }],
    outputs: [
      {
        name: "heroes",
        type: "tuple[]",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "sect", type: "uint8" },
          { name: "hp", type: "uint16" },
          { name: "atk", type: "uint16" },
          { name: "def", type: "uint16" },
          { name: "spd", type: "uint16" },
          { name: "crit", type: "uint16" },
          { name: "skillIds", type: "uint8[]" },
        ],
      },
    ],
  },
  // -------------------------------------------------------------------------
  // Week 2 — wound / cooldown + unlockable skills
  // -------------------------------------------------------------------------
  {
    type: "function",
    name: "heroHealth",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "woundLevel", type: "uint8" },
      { name: "cooldownUntil", type: "uint64" },
      { name: "potionCount", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "isAvailable",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setWound",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "woundLevel", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "healHero",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "addPotion",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unlockSkill",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "skillId", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getUnlockedSkills",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "uint8[]" }],
  },
  {
    type: "function",
    name: "setArena",
    stateMutability: "nonpayable",
    inputs: [{ name: "arena_", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "arenaAddr",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "HeroWounded",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "woundLevel", type: "uint8", indexed: false },
      { name: "cooldownUntil", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "HeroHealed",
    inputs: [{ name: "tokenId", type: "uint256", indexed: true }],
  },
  {
    type: "event",
    name: "SkillUnlocked",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "skillId", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ArenaUpdated",
    inputs: [{ name: "arena", type: "address", indexed: true }],
  },
] as const;

const battleEventTuple = {
  name: "events",
  type: "tuple[]",
  components: [
    { name: "round", type: "uint8" },
    { name: "actorIdx", type: "uint8" },
    { name: "skillId", type: "uint8" },
    { name: "targetIdx", type: "uint8" },
    { name: "hpDelta", type: "int16" },
    { name: "flags", type: "uint8" },
  ],
} as const;

const heroTupleComponents = [
  { name: "tokenId", type: "uint256" },
  { name: "sect", type: "uint8" },
  { name: "hp", type: "uint16" },
  { name: "atk", type: "uint16" },
  { name: "def", type: "uint16" },
  { name: "spd", type: "uint16" },
  { name: "crit", type: "uint16" },
  { name: "skillIds", type: "uint8[]" },
] as const;

const battleReportTuple = {
  name: "report",
  type: "tuple",
  components: [
    { name: "battleId", type: "bytes32" },
    { name: "attacker", type: "address" },
    { name: "defender", type: "address" },
    { name: "winner", type: "uint8" },
    { name: "totalRounds", type: "uint8" },
    { name: "timestamp", type: "uint64" },
    { name: "attackerTeam", type: "tuple[3]", components: heroTupleComponents },
    { name: "defenderTeam", type: "tuple[3]", components: heroTupleComponents },
    battleEventTuple,
  ],
} as const;

export const arenaAbi = [
  {
    type: "function",
    name: "startPve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "heroIds", type: "uint256[3]" },
      { name: "stageId", type: "uint8" },
    ],
    outputs: [{ name: "battleId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "challenge",
    stateMutability: "nonpayable",
    inputs: [{ name: "defender", type: "address" }],
    outputs: [{ name: "battleId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "setDefenseTeam",
    stateMutability: "nonpayable",
    inputs: [{ name: "heroIds", type: "uint256[3]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "challengeRelay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attacker", type: "address" },
      { name: "defender", type: "address" },
      { name: "attackerSig", type: "bytes" },
      { name: "defenderSig", type: "bytes" },
    ],
    outputs: [{ name: "battleId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getBattleReport",
    stateMutability: "view",
    inputs: [{ name: "battleId", type: "bytes32" }],
    outputs: [battleReportTuple],
  },
  {
    type: "function",
    name: "getDefenseTeam",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [{ name: "", type: "uint256[3]" }],
  },
  {
    type: "function",
    name: "listArena",
    stateMutability: "view",
    inputs: [
      { name: "offset", type: "uint256" },
      { name: "limit", type: "uint256" },
    ],
    outputs: [
      { name: "players", type: "address[]" },
      { name: "powers", type: "uint256[]" },
    ],
  },
  {
    type: "event",
    name: "BattleSettled",
    inputs: [
      { name: "battleId", type: "bytes32", indexed: true },
      { name: "attacker", type: "address", indexed: true },
      { name: "defender", type: "address", indexed: true },
      { name: "winner", type: "uint8", indexed: false },
    ],
  },
  // -------------------------------------------------------------------------
  // Week 2 — story progress
  // -------------------------------------------------------------------------
  {
    type: "function",
    name: "completeStage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "player", type: "address" },
      { name: "bossId", type: "uint8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "playerProgress",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      { name: "currentChapter", type: "uint8" },
      { name: "totalExp", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getStoryProgress",
    stateMutability: "view",
    inputs: [{ name: "player", type: "address" }],
    outputs: [
      {
        name: "progress",
        type: "tuple",
        components: [
          { name: "currentChapter", type: "uint8" },
          { name: "bossDefeated", type: "uint64[]" },
          { name: "totalExp", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "setGameAuthority",
    stateMutability: "nonpayable",
    inputs: [{ name: "authority", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "gameAuthority",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "ChapterProgress",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "chapter", type: "uint8", indexed: false },
      { name: "bossId", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "GameAuthoritySet",
    inputs: [{ name: "authority", type: "address", indexed: true }],
  },
  // -------------------------------------------------------------------------
  // Week 4 — first-clear ledger (arena side, mirrors HeroNFT.bossFirstCleared)
  // -------------------------------------------------------------------------
  {
    type: "function",
    name: "bossFirstCleared",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "bossId", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "BOSS_ARENA_THRESHOLD",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "event",
    name: "BossFirstCleared",
    inputs: [
      { name: "player", type: "address", indexed: true },
      { name: "bossId", type: "uint8", indexed: false },
    ],
  },
] as const;
