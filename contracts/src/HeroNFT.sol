// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Types} from "./Types.sol";
import {SkillRegistry} from "./SkillRegistry.sol";

/// @title HeroNFT
/// @notice ERC-721 of Jianghu heroes. Players may call `mintHero(to, count, isPaid)`
///         to forge heroes either off free allowance or by paying `PRICE_PER_MINT`.
///         `mintGenesis(to)` is retained as a back-compat convenience that
///         mints exactly one hero per sect on first call.
/// @dev Attribute formulas are intentionally simple and reproducible off-chain.
contract HeroNFT is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Next token id to mint. Starts at 1 so #0 is "empty / invalid".
    uint256 public nextTokenId = 1;

    /// @notice Cumulative heroes minted per player across all mint entrypoints.
    mapping(address => uint256) public playerMintCount;

    /// @notice On-chain hero record keyed by tokenId.
    mapping(uint256 => Types.Hero) private _heroes;

    /// @notice Optional metadata base URI (skill reads this to hint OpenSea render).
    string private _baseTokenURI;

    /// @notice Read-only registry so wallets can resolve skill metadata without bundling ABI.
    SkillRegistry public immutable registry;

    /// @notice Per-hero wound / cooldown state. Populated by Arena after battles.
    mapping(uint256 => Types.HeroHealth) public heroHealth;

    /// @notice Additional skills unlocked through gameplay beyond the base 3.
    mapping(uint256 => uint8[]) private _unlockedSkills;

    /// @notice Arena contract authorised to mutate health / unlock skills.
    ///         Set post-deploy via `setArena` to break the circular deploy dep.
    address public arenaAddr;

    // ---------------------------------------------------------------------
    // Gacha economy (Week 4)
    // ---------------------------------------------------------------------

    /// @notice Per-player free / paid mint accounting. All fields monotonic.
    ///         `freeGranted` seeded to 3 on first mint (see `_ensureSeeded`).
    struct MintAllowance {
        uint8  freeGranted;      // Lifetime free quota granted (seed 3 + earned caps).
        uint8  earnedFromBoss;   // Accrued via BOSS first-clear, max 255.
        uint8  earnedFromDaily;  // Accrued via daily claim, capped at DAILY_CLAIM_CAP.
        uint16 usedFree;         // Count of free mints consumed so far.
        uint16 usedPaid;         // Count of paid mints consumed so far.
    }

    /// @notice Per-player allowance ledger.
    mapping(address => MintAllowance) public playerAllowance;

    /// @notice Tracks which BOSS ids have already paid out a first-clear reward
    ///         to a given player. `bossId` covers擂台 BOSS range (>= BOSS_ARENA_THRESHOLD).
    mapping(address => mapping(uint8 => bool)) public bossFirstCleared;

    /// @notice Last unix ts a player claimed daily mint.
    mapping(address => uint64) public lastDailyClaim;

    /// @notice Price per paid mint, default 0.005 ETH. Owner-adjustable via `setPrice`.
    uint256 public pricePerMint = 5e15;

    // ---------------------------------------------------------------------
    // Gacha v2 — pity / tier / duplicate exchange / referral (Wave 2)
    // ---------------------------------------------------------------------

    /// @notice Rolling pity counter per player. `currentCount` increments every
    ///         mint; when it reaches SECT_PITY_THRESHOLD the next mint is forced
    ///         onto `sectCycle` (Shaolin→Tangmen→Emei, wrapping mod 3) and the
    ///         counter resets. `bossPityCount` mirrors the 80-pull BOSS bead
    ///         guarantee (tracked here; actual bead grant is mirrored via the
    ///         off-chain drop table + `unlockSkill`).
    struct PityProgress {
        uint16 currentCount;   // 0..SECT_PITY_THRESHOLD (inclusive)
        uint8  sectCycle;      // next forced sect when pity fires (mod 3)
        uint8  bossPityCount;  // 0..BOSS_PITY_THRESHOLD
    }

    /// @notice Per-player pity ledger.
    mapping(address => PityProgress) public playerPity;

    /// @notice Burnt / exchanged duplicate token ids → shards earned. Kept as a
    ///         flag so we never double-spend an NFT across two exchange calls.
    mapping(uint256 => bool) public exchanged;

    /// @notice Per-player声望碎片 accumulator. 1 duplicate = SHARDS_PER_DUPLICATE.
    ///         Burn SHARDS_PER_PITY_BOOST to bump `currentCount` by +1.
    mapping(address => uint256) public shards;

    /// @notice Referral link. `referredBy[newPlayer] = referrer`. Set once via
    ///         `setReferrer` before first paid mint. Reward fires on first
    ///         paid mint of the referee.
    mapping(address => address) public referredBy;

    /// @notice Accrued ETH-denominated credit earnt via referrals. Credited
    ///         on the referee's first paid mint; redeemable by withdrawal
    ///         mechanism (future work) or off-chain settlement.
    mapping(address => uint256) public earnedFromReferral;

    /// @notice Tracks whether a referee has already triggered the first-paid
    ///         mint referral reward, so a single referee只能 trigger 一次.
    mapping(address => bool) public referralRewardPaid;

    /// @notice Tier prices. Bronze / silver / gold correspond to three mint
    ///         price tiers; the rarity pool used off-chain differs per tier.
    uint256 public constant PRICE_BRONZE = 1e15;   // 0.001 ETH
    uint256 public constant PRICE_SILVER = 5e15;   // 0.005 ETH (mirrors legacy price)
    uint256 public constant PRICE_GOLD   = 10e15;  // 0.010 ETH

    /// @notice Trigger thresholds for pity.
    uint16 public constant SECT_PITY_THRESHOLD = 30;
    uint8  public constant BOSS_PITY_THRESHOLD = 80;

    /// @notice 10-连 discount basis points. 9000 = 90% of sticker price.
    uint16 public constant TEN_PULL_DISCOUNT_BPS = 9000;

    /// @notice Duplicate exchange economy.
    uint256 public constant SHARDS_PER_DUPLICATE = 5;
    uint256 public constant SHARDS_PER_PITY_BOOST = 5;

    /// @notice Referral reward paid to the referrer on the referee's first
    ///         paid mint. 0.002 ETH in credit (off-chain settled, tracked on
    ///         `earnedFromReferral`).
    uint256 public constant REFERRAL_REWARD = 2e15;

    /// @notice Cooldown that separates two successive daily claims. 20h so players
    ///         are not punished for checking in slightly earlier each day.
    uint64  public constant DAILY_CLAIM_COOLDOWN = 20 hours;

    /// @notice Upper bound on `earnedFromDaily` (first-week welfare ceiling).
    uint8   public constant DAILY_CLAIM_CAP = 7;

    /// @notice Seed free allowance — matches PRD §1.1 (3 free on入坑).
    uint8   public constant FREE_MINT_SEED = 3;

    /// @notice Single mint call cannot exceed this many heroes.
    uint8   public constant MAX_MINT_PER_CALL = 10;

    /// @notice BOSS ids below this threshold are tutorial PVE; first-clear reward only
    ///         fires for ids >= threshold (擂台 BOSS in PRD §2.4).
    uint8   public constant BOSS_ARENA_THRESHOLD = 5;

    /// @notice Mandatory delay between `scheduleWithdrawal` and `executeWithdrawal`.
    uint64  public constant WITHDRAWAL_DELAY = 2 days;

    /// @notice Pending withdrawal target / amount / unlock time. Single outstanding schedule.
    address public pendingWithdrawalTarget;
    uint256 public pendingWithdrawalAmount;
    uint64  public pendingWithdrawalUnlockAt;

    /// @notice When true, all mint + withdrawal entrypoints revert. Owner-flippable.
    bool public emergencyPaused;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event GenesisMinted(address indexed to, uint256[3] tokenIds);
    event HeroMinted(address indexed to, uint256 indexed tokenId, Types.Sect sect);
    event BaseURIUpdated(string newBaseURI);
    event ArenaUpdated(address indexed arena);
    event HeroWounded(uint256 indexed tokenId, uint8 woundLevel, uint64 cooldownUntil);
    event HeroHealed(uint256 indexed tokenId);
    event SkillUnlocked(uint256 indexed tokenId, uint8 skillId);

    // Week 4 — gacha economy
    event MintAllowanceGranted(address indexed player, string source, uint8 amount);
    event PaidMintProcessed(address indexed player, uint8 count, uint256 totalCost);
    event BossMintGranted(address indexed player, uint8 bossId);
    event DailyMintGranted(address indexed player, uint8 day);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event WithdrawalScheduled(address indexed target, uint256 amount, uint64 executeAfter);
    event WithdrawalExecuted(address indexed target, uint256 amount);
    event EmergencyPauseToggled(bool paused);

    // Wave 2 — gacha v2 deepening (pity / tier / exchange / referral)
    event SectPityReached(address indexed player, Types.Sect forcedSect, uint8 nextCycle);
    event BossPityReached(address indexed player, uint8 cycleIndex);
    event DuplicateExchanged(address indexed player, uint256[] tokenIds, uint256 shardsEarned);
    event PityBoosted(address indexed player, uint16 newCurrentCount, uint256 shardsSpent);
    event ReferrerSet(address indexed player, address indexed referrer);
    event ReferralRewardGranted(address indexed referrer, address indexed referee, uint256 amount);

    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    /// @dev Until `arenaAddr` is wired up, the contract owner is allowed to
    ///      call arena-only functions. Prevents a deadlock if deploy order
    ///      is HeroNFT → Arena → setArena.
    modifier onlyArena() {
        require(
            msg.sender == arenaAddr || (arenaAddr == address(0) && msg.sender == owner()),
            "HeroNFT: not arena"
        );
        _;
    }

    modifier whenNotPaused() {
        require(!emergencyPaused, "HeroNFT: paused");
        _;
    }

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address initialOwner, SkillRegistry registry_)
        ERC721(unicode"江湖侠客", "JHHERO")
        Ownable(initialOwner)
    {
        registry = registry_;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setBaseURI(string calldata uri) external onlyOwner {
        _baseTokenURI = uri;
        emit BaseURIUpdated(uri);
    }

    /// @notice Wire up the Arena contract allowed to mutate hero health / unlock skills.
    /// @dev Not payable — Paymaster-friendly.
    function setArena(address arena_) external onlyOwner {
        arenaAddr = arena_;
        emit ArenaUpdated(arena_);
    }

    // ---------------------------------------------------------------------
    // Hero health / wound state
    // ---------------------------------------------------------------------

    /// @notice True when the hero is out of cooldown and may be fielded.
    function isAvailable(uint256 tokenId) public view returns (bool) {
        return block.timestamp >= heroHealth[tokenId].cooldownUntil;
    }

    /// @notice Apply a wound level and the corresponding cooldown.
    /// @dev 0 → 0h, 1 → 12h (轻伤), 2 → 24h (重伤). Callable only by Arena.
    function setWound(uint256 tokenId, uint8 woundLevel) external onlyArena {
        _requireOwned(tokenId);
        uint64 duration = uint64(12 hours) * woundLevel;
        uint64 until = uint64(block.timestamp) + duration;
        heroHealth[tokenId].woundLevel = woundLevel;
        heroHealth[tokenId].cooldownUntil = until;
        emit HeroWounded(tokenId, woundLevel, until);
    }

    /// @notice Consume a golden-wound potion to instantly clear the cooldown.
    function healHero(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "HeroNFT: not owner");
        require(heroHealth[tokenId].potionCount > 0, "HeroNFT: no potion");
        heroHealth[tokenId].potionCount--;
        heroHealth[tokenId].woundLevel = 0;
        heroHealth[tokenId].cooldownUntil = 0;
        emit HeroHealed(tokenId);
    }

    /// @notice Credit a hero with potions. Arena-gated so drops are earnt in battle.
    function addPotion(uint256 tokenId, uint8 amount) external onlyArena {
        _requireOwned(tokenId);
        heroHealth[tokenId].potionCount += amount;
    }

    // ---------------------------------------------------------------------
    // Unlockable skills (技能珠)
    // ---------------------------------------------------------------------

    /// @notice Grant an extra skillId to a hero. Arena-gated.
    function unlockSkill(uint256 tokenId, uint8 skillId) external onlyArena {
        _requireOwned(tokenId);
        _unlockedSkills[tokenId].push(skillId);
        emit SkillUnlocked(tokenId, skillId);
    }

    /// @notice Read all additional skills unlocked beyond the base 3.
    function getUnlockedSkills(uint256 tokenId) external view returns (uint8[] memory) {
        return _unlockedSkills[tokenId];
    }

    // ---------------------------------------------------------------------
    // Public mint
    // ---------------------------------------------------------------------

    /// @notice Free mint: 3 heroes, one per sect. Retained for back-compat.
    /// @param to  Recipient. Typically the MPC wallet address from OnchainOS WaaS.
    /// @return tokenIds The three newly minted token ids (sect order: Shaolin, Tangmen, Emei).
    function mintGenesis(address to)
        external
        returns (uint256[3] memory tokenIds)
    {
        require(to != address(0), "HeroNFT: zero recipient");

        for (uint8 i = 0; i < 3; i++) {
            Types.Sect sect = Types.Sect(i);
            uint256 id = nextTokenId++;
            tokenIds[i] = id;

            _heroes[id] = _generateHero(id, sect, to);
            _safeMint(to, id);
            emit HeroMinted(to, id, sect);
        }

        playerMintCount[to] += 3;
        emit GenesisMinted(to, tokenIds);
    }

    /// @notice Legacy Week 4 mint entrypoint (silver tier, single price). Retained
    ///         for back-compat with the existing skill clients; delegates to the
    ///         tiered variant so there is exactly one mint code path.
    /// @param to      Recipient wallet.
    /// @param count   Number of heroes to mint in this call (1..MAX_MINT_PER_CALL).
    /// @param isPaid  True to charge msg.value; false to consume free allowance.
    function mintHero(address to, uint8 count, bool isPaid)
        external
        payable
        returns (uint256[] memory tokenIds)
    {
        return _mintHeroTiered(to, count, isPaid, 1); // 1 = silver (default)
    }

    /// @notice Wave 2 tiered mint. `tier` picks price/rarity pool:
    ///         0 = bronze (0.001 ETH · 普通池), 1 = silver (0.005 ETH · 默认),
    ///         2 = gold (0.010 ETH · 高爆击池). Off-chain rarity selection
    ///         interprets the emitted `PaidMintProcessed` + tier log.
    /// @dev 10-pull count=10 automatically applies TEN_PULL_DISCOUNT_BPS.
    function mintHeroTier(address to, uint8 count, bool isPaid, uint8 tier)
        external
        payable
        returns (uint256[] memory tokenIds)
    {
        return _mintHeroTiered(to, count, isPaid, tier);
    }

    function _mintHeroTiered(address to, uint8 count, bool isPaid, uint8 tier)
        internal
        nonReentrant
        whenNotPaused
        returns (uint256[] memory tokenIds)
    {
        require(to != address(0), "HeroNFT: zero recipient");
        require(count >= 1 && count <= MAX_MINT_PER_CALL, "HeroNFT: count out of range");
        require(tier <= 2, "HeroNFT: bad tier");

        _ensureSeeded(to);

        if (isPaid) {
            uint256 unit = _tierPrice(tier);
            uint256 sticker = uint256(count) * unit;
            uint256 cost = count == 10
                ? (sticker * TEN_PULL_DISCOUNT_BPS) / 10000
                : sticker;
            require(msg.value >= cost, "HeroNFT: insufficient payment");

            // State change first (CEI).
            playerAllowance[to].usedPaid += count;
            emit PaidMintProcessed(to, count, cost);

            // First-paid-mint referral reward (K-factor). We check before
            // bumping pity so referral accounting is independent.
            _maybePayReferralReward(to, cost);

            // Refund overpayment to the caller (not `to`) — relay-friendly.
            uint256 refund = msg.value - cost;
            if (refund > 0) {
                (bool ok, ) = payable(msg.sender).call{value: refund}("");
                require(ok, "HeroNFT: refund failed");
            }
        } else {
            require(msg.value == 0, "HeroNFT: free mint not payable");
            MintAllowance storage a = playerAllowance[to];
            uint16 totalFree = uint16(a.freeGranted) + uint16(a.earnedFromBoss) + uint16(a.earnedFromDaily);
            require(uint16(a.usedFree) + count <= totalFree, "HeroNFT: no free allowance");
            a.usedFree += count;
        }

        // Tick pity counters (both sect- and boss-side). Counters are rolling;
        // the off-chain drop table reads these and the sect-forced flag.
        _bumpPity(to, count);

        tokenIds = _mintBatch(to, count);
    }

    function _tierPrice(uint8 tier) internal pure returns (uint256) {
        if (tier == 0) return PRICE_BRONZE;
        if (tier == 2) return PRICE_GOLD;
        return PRICE_SILVER;
    }

    function _bumpPity(address to, uint8 count) internal {
        PityProgress storage p = playerPity[to];
        uint16 c = p.currentCount + uint16(count);
        uint16 bp = uint16(p.bossPityCount) + uint16(count);

        // Sect pity: cross threshold → force current cycle sect next pull,
        // reset counter to the overflow remainder, advance cycle.
        if (c >= SECT_PITY_THRESHOLD) {
            Types.Sect forced = Types.Sect(p.sectCycle % 3);
            uint8 nextCycle = uint8((uint16(p.sectCycle) + 1) % 3);
            p.sectCycle = nextCycle;
            p.currentCount = c - SECT_PITY_THRESHOLD;
            emit SectPityReached(to, forced, nextCycle);
        } else {
            p.currentCount = c;
        }

        if (bp >= BOSS_PITY_THRESHOLD) {
            p.bossPityCount = uint8(bp - BOSS_PITY_THRESHOLD);
            emit BossPityReached(to, p.sectCycle);
        } else {
            p.bossPityCount = uint8(bp);
        }
    }

    function _maybePayReferralReward(address referee, uint256 /*spend*/) internal {
        if (referralRewardPaid[referee]) return;
        address ref = referredBy[referee];
        if (ref == address(0)) return;
        referralRewardPaid[referee] = true;
        earnedFromReferral[ref] += REFERRAL_REWARD;
        emit ReferralRewardGranted(ref, referee, REFERRAL_REWARD);
    }

    /// @dev Shared mint loop used by both free and paid paths plus mintGenesis legacy.
    function _mintBatch(address to, uint8 count) internal returns (uint256[] memory tokenIds) {
        tokenIds = new uint256[](count);

        uint256 seed = uint256(keccak256(
            abi.encode(to, nextTokenId, block.prevrandao, block.number, block.chainid)
        ));

        for (uint8 i = 0; i < count; i++) {
            Types.Sect sect = Types.Sect(uint8((seed >> (i * 8)) % 3));
            uint256 id = nextTokenId++;
            tokenIds[i] = id;

            _heroes[id] = _generateHero(id, sect, to);
            _safeMint(to, id);
            emit HeroMinted(to, id, sect);
        }

        playerMintCount[to] += count;
    }

    /// @dev Seed 3 free mints on first interaction. Idempotent via `freeGranted` check.
    function _ensureSeeded(address player) internal {
        MintAllowance storage a = playerAllowance[player];
        if (a.freeGranted == 0 && a.usedFree == 0 && a.usedPaid == 0
            && a.earnedFromBoss == 0 && a.earnedFromDaily == 0) {
            a.freeGranted = FREE_MINT_SEED;
            emit MintAllowanceGranted(player, "seed", FREE_MINT_SEED);
        }
    }

    // ---------------------------------------------------------------------
    // Allowance grants (Arena + daily cron + admin)
    // ---------------------------------------------------------------------

    /// @notice Credit a BOSS first-clear free mint. Callable only by the Arena contract.
    /// @dev Arena enforces the "first clear" invariant via `bossFirstCleared`.
    function grantBossMint(address player, uint8 bossId) external onlyArena {
        require(player != address(0), "HeroNFT: zero player");
        _ensureSeeded(player);
        MintAllowance storage a = playerAllowance[player];
        require(a.earnedFromBoss < type(uint8).max, "HeroNFT: boss cap");
        a.earnedFromBoss += 1;
        emit BossMintGranted(player, bossId);
        emit MintAllowanceGranted(player, "boss", 1);
    }

    /// @notice Claim today's daily login free mint. Permissionless; enforced by
    ///         a 20h cooldown and a DAILY_CLAIM_CAP ceiling.
    /// @dev Any relayer may trigger on behalf of `player`; accounting is per-player.
    function grantDailyMint(address player) external whenNotPaused {
        require(player != address(0), "HeroNFT: zero player");
        _ensureSeeded(player);
        MintAllowance storage a = playerAllowance[player];
        require(a.earnedFromDaily < DAILY_CLAIM_CAP, "HeroNFT: daily cap");

        uint64 last = lastDailyClaim[player];
        require(block.timestamp >= uint256(last) + DAILY_CLAIM_COOLDOWN, "HeroNFT: daily cooldown");

        lastDailyClaim[player] = uint64(block.timestamp);
        a.earnedFromDaily += 1;
        emit DailyMintGranted(player, a.earnedFromDaily);
        emit MintAllowanceGranted(player, "daily", 1);
    }

    // ---------------------------------------------------------------------
    // Admin: pricing, pause, withdrawal
    // ---------------------------------------------------------------------

    /// @notice Adjust the per-mint price (e.g. promo weeks). Emits `PriceUpdated`.
    function setPrice(uint256 newPrice) external onlyOwner {
        uint256 old = pricePerMint;
        pricePerMint = newPrice;
        emit PriceUpdated(old, newPrice);
    }

    /// @notice Flip the emergency pause — blocks mints + withdrawal execution.
    function setEmergencyPause(bool paused) external onlyOwner {
        emergencyPaused = paused;
        emit EmergencyPauseToggled(paused);
    }

    /// @notice Queue a withdrawal that can only execute after `WITHDRAWAL_DELAY`.
    /// @dev Overwrites any previously scheduled withdrawal — single outstanding slot.
    function scheduleWithdrawal(address target, uint256 amount) external onlyOwner {
        require(target != address(0), "HeroNFT: zero target");
        require(amount > 0 && amount <= address(this).balance, "HeroNFT: bad amount");

        uint64 unlockAt = uint64(block.timestamp) + WITHDRAWAL_DELAY;
        pendingWithdrawalTarget = target;
        pendingWithdrawalAmount = amount;
        pendingWithdrawalUnlockAt = unlockAt;
        emit WithdrawalScheduled(target, amount, unlockAt);
    }

    /// @notice Execute the previously scheduled withdrawal. `amount` must match
    ///         the scheduled amount exactly so a compromised owner cannot inflate it
    ///         after the 48h community window closed.
    function executeWithdrawal(uint256 amount) external onlyOwner nonReentrant whenNotPaused {
        require(pendingWithdrawalTarget != address(0), "HeroNFT: no pending");
        require(pendingWithdrawalAmount == amount, "HeroNFT: amount mismatch");
        require(block.timestamp >= pendingWithdrawalUnlockAt, "HeroNFT: timelock active");
        require(amount <= address(this).balance, "HeroNFT: short balance");

        address target = pendingWithdrawalTarget;

        // Clear state before transfer (CEI).
        pendingWithdrawalTarget   = address(0);
        pendingWithdrawalAmount   = 0;
        pendingWithdrawalUnlockAt = 0;

        (bool ok, ) = payable(target).call{value: amount}("");
        require(ok, "HeroNFT: transfer failed");
        emit WithdrawalExecuted(target, amount);
    }

    // ---------------------------------------------------------------------
    // Wave 2 — duplicate exchange / pity boost / referral
    // ---------------------------------------------------------------------

    /// @notice Burn duplicate heroes in exchange for声望碎片. Each token
    ///         contributes SHARDS_PER_DUPLICATE. All ids must be owned by
    ///         `msg.sender` and not previously exchanged. The tokens are
    ///         marked as exchanged and also ERC-721 burnt so they no longer
    ///         show up in the roster.
    function exchangeDuplicate(uint256[] calldata tokenIds) external whenNotPaused {
        require(tokenIds.length > 0, "HeroNFT: empty ids");
        uint256 earned;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 id = tokenIds[i];
            require(ownerOf(id) == msg.sender, "HeroNFT: not owner");
            require(!exchanged[id], "HeroNFT: already exchanged");
            exchanged[id] = true;
            _burn(id);
            earned += SHARDS_PER_DUPLICATE;
        }
        shards[msg.sender] += earned;
        emit DuplicateExchanged(msg.sender, tokenIds, earned);
    }

    /// @notice Spend SHARDS_PER_PITY_BOOST shards to bump the sect-pity
    ///         counter by `steps` (accelerates the 30-pull保底). Reverts
    ///         if the player has insufficient shards.
    function pityBoost(uint16 steps) external whenNotPaused {
        require(steps > 0, "HeroNFT: zero steps");
        uint256 cost = uint256(steps) * SHARDS_PER_PITY_BOOST;
        require(shards[msg.sender] >= cost, "HeroNFT: insufficient shards");
        shards[msg.sender] -= cost;
        PityProgress storage p = playerPity[msg.sender];
        uint16 c = p.currentCount + steps;
        // Cap at threshold - 1 so the next real mint still deterministically fires pity.
        if (c >= SECT_PITY_THRESHOLD) {
            c = SECT_PITY_THRESHOLD - 1;
        }
        p.currentCount = c;
        emit PityBoosted(msg.sender, c, cost);
    }

    /// @notice Bind a referrer for the caller. Must be called before the
    ///         referee's first paid mint; one-shot (cannot be rebound).
    ///         `referrer` must differ from the caller and be non-zero.
    function setReferrer(address referrer) external {
        require(referrer != address(0), "HeroNFT: zero referrer");
        require(referrer != msg.sender, "HeroNFT: self referral");
        require(referredBy[msg.sender] == address(0), "HeroNFT: already set");
        require(playerAllowance[msg.sender].usedPaid == 0, "HeroNFT: already paid");
        referredBy[msg.sender] = referrer;
        emit ReferrerSet(msg.sender, referrer);
    }

    /// @notice Compact pity view for the skill UI.
    function getPityProgress(address player)
        external
        view
        returns (uint16 currentCount, uint8 sectCycle, uint8 bossPityCount)
    {
        PityProgress storage p = playerPity[player];
        return (p.currentCount, p.sectCycle, p.bossPityCount);
    }

    // ---------------------------------------------------------------------
    // Gacha views
    // ---------------------------------------------------------------------

    /// @notice Compact allowance read. `remaining` = total free - usedFree, clamped to 255.
    /// @dev `remaining` is uint8 to match the Week 4 ABI contract (PRD §2.2);
    ///      total allowance is bounded by 3 + 255 + 7 = 265 which we saturate at 255.
    function getMintAllowance(address player)
        external
        view
        returns (uint8 free, uint8 boss, uint8 daily, uint16 paid, uint8 remaining)
    {
        MintAllowance storage a = playerAllowance[player];
        free  = a.freeGranted;
        boss  = a.earnedFromBoss;
        daily = a.earnedFromDaily;
        paid  = a.usedPaid;
        uint16 total = uint16(a.freeGranted) + uint16(a.earnedFromBoss) + uint16(a.earnedFromDaily);
        uint16 r = total > a.usedFree ? total - a.usedFree : 0;
        remaining = r > 255 ? 255 : uint8(r);
    }

    /// @notice Current ETH held by the contract (pool balance, pre-withdrawal).
    function getPoolBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Tuple view over the pending withdrawal slot so clients don't have
    ///         to assemble three separate RPC reads.
    function pendingWithdrawal()
        external
        view
        returns (address target, uint256 amount, uint64 executeAfter)
    {
        return (pendingWithdrawalTarget, pendingWithdrawalAmount, pendingWithdrawalUnlockAt);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Full Hero record for a tokenId. Reverts if not minted.
    function getHero(uint256 tokenId) external view returns (Types.Hero memory) {
        _requireOwned(tokenId);
        return _heroes[tokenId];
    }

    /// @notice Batch lookup used by the skill to hydrate a roster in one RPC call.
    function getHeroes(uint256[] calldata ids) external view returns (Types.Hero[] memory out) {
        out = new Types.Hero[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            _requireOwned(ids[i]);
            out[i] = _heroes[ids[i]];
        }
    }

    /// @notice Fetch an entire team as a fixed-size array (for BattleEngine input shape).
    /// @dev Reverts unless caller passes exactly 3 ids; each must be minted.
    function getTeam(uint256[3] calldata ids) external view returns (Types.Hero[3] memory out) {
        for (uint256 i = 0; i < 3; i++) {
            _requireOwned(ids[i]);
            out[i] = _heroes[ids[i]];
        }
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (bytes(_baseTokenURI).length == 0) return "";
        return string.concat(_baseTokenURI, tokenId.toString());
    }

    // ---------------------------------------------------------------------
    // Internal: attribute generation
    // ---------------------------------------------------------------------

    /// @dev Deterministic-enough per-hero stats based on (tokenId, sect, owner, prevrandao).
    ///      Ranges follow PRD §5.2. Sect biases the rolls.
    function _generateHero(uint256 tokenId, Types.Sect sect, address owner_)
        internal
        view
        returns (Types.Hero memory h)
    {
        uint256 seed = uint256(keccak256(
            abi.encode(tokenId, sect, owner_, block.prevrandao, block.chainid)
        ));

        // Base random rolls
        uint16 hpRoll   = uint16(seed % 101);              // 0..100
        uint16 atkRoll  = uint16((seed >> 16) % 41);       // 0..40
        uint16 defRoll  = uint16((seed >> 32) % 61);       // 0..60
        uint16 spdRoll  = uint16((seed >> 48) % 51);       // 0..50
        uint16 critRoll = uint16((seed >> 64) % 3001);     // 0..30.00%

        uint16 hp;  uint16 atk;  uint16 def;  uint16 spd;  uint16 crit;

        if (sect == Types.Sect.Shaolin) {
            hp   = 150 + hpRoll;      // 150..250 (tanky)
            atk  = 60  + atkRoll;     // 60..100
            def  = 80  + defRoll;     // 80..140
            spd  = 50  + spdRoll / 2; // 50..75   (slow)
            crit = critRoll / 3;      // 0..10%
        } else if (sect == Types.Sect.Tangmen) {
            hp   = 100 + hpRoll / 2;  // 100..150 (frail)
            atk  = 80  + atkRoll;     // 80..120
            def  = 40  + defRoll / 2; // 40..70
            spd  = 80  + spdRoll / 2; // 80..105
            crit = 500 + critRoll;    // 5..35%
        } else {
            // Emei — balanced / fast utility
            hp   = 120 + hpRoll * 2 / 3;
            atk  = 70  + atkRoll;
            def  = 50  + defRoll / 2;
            spd  = 75  + spdRoll / 2;
            crit = critRoll / 2;      // 0..15%
        }

        uint8[3] memory skillIds = registry.sectSkills(sect);
        uint8[] memory skills = new uint8[](3);
        skills[0] = skillIds[0];
        skills[1] = skillIds[1];
        skills[2] = skillIds[2];

        h = Types.Hero({
            tokenId: tokenId,
            sect:    sect,
            hp:      hp,
            atk:     atk,
            def:     def,
            spd:     spd,
            crit:    crit,
            skillIds: skills
        });
    }
}
