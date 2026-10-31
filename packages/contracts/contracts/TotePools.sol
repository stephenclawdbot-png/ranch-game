// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice The two ArbSys precompile reads we need (0x...64 on Arbitrum chains). On Arbitrum,
/// `block.number` is an L1 estimate and `blockhash` is not the L2 block hash, so the L2 block
/// number and hash come from here.
interface IArbSysBlocks {
    /// @dev What arbBlockHash reverts with outside the last 256 blocks.
    error InvalidBlockNumber(uint256 requested, uint256 current);

    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 arbBlockNum) external view returns (bytes32);
}

/// @notice Optional external randomness (a VRF or a public beacon) mixed into a market's entropy.
/// Disabled by default (no beacon set); an admin can plug one in for markets created afterwards.
/// An adapter contract wraps whatever provider is chosen behind these two calls.
interface IEntropyBeacon {
    /// @notice Asks for randomness for this market (called once, from lockEntropy, after betting closed).
    function requestRandomness(bytes32 raceId) external;
    /// @notice The delivered randomness, or 0 while it isn't there yet.
    function randomness(bytes32 raceId) external view returns (bytes32);
}

/// @title TotePools
/// @notice DORMANT scaffold of a real-money pari-mutuel tote for POST TIME (docs/usdg-tote.md).
/// Not deployed; nothing in the app talks to it unless REAL_TOTE_ENABLED, WEB3_ENABLED and
/// TOTE_POOLS_ADDRESS are all set, which needs legal approval first.
///
/// Custody and trust: player stakes sit in this contract only, never with the operator. No role
/// can transfer a stake anywhere but back to its player (claim) or, for the takeout and rounding
/// dust, to the treasury: there is no owner withdrawal, no upgrade path and no arbitrary
/// transfer. Who wins is decided by a posted result: the OPERATOR posts it and an independent
/// RESULT_ATTESTOR (a separate key and service that replays the race) must attest the same
/// result before finalize; a mismatch freezes the market for the GUARDIAN multisig, which also
/// has a challenge window to correct or void. So the operator alone can't pick winners, but the
/// operator and attestor keys together (unless the guardian intervenes in time) could.
///
/// Stake asset: a per-market property. Each market settles entirely in its own asset: an
/// allow-listed ERC-20 (USDG, allow-listed at deployment) or native ETH (address(0), payable
/// `bet` with msg.value == amount; pull-based ETH payouts). No conversion, no price oracle.
///
/// Lifecycle of one race market:
///  1. OPERATOR `createMarket` when the field locks, with the race's seed commitment
///     (sha256 of the 32-byte server seed, the engine's `commitSeed`). Write-once.
///  2. Players `bet` with a short-lived, single-use EIP-712 BetPermit from PERMIT_SIGNER, bound to
///     the bettor, race, runner, pool, a max amount, an issue time and an expiry. Bets close
///     CLOSE_MARGIN before `closeTime` and can't be cancelled.
///  3. After `closeTime` anyone calls `lockEntropy` (picks a FUTURE block) and then
///     `sealEntropy` (mixes the hashes of ENTROPY_BLOCKS consecutive blocks from there, and the
///     beacon's randomness when one is configured). The race runs on
///     finalSeed = sha256(serverSeed ‖ entropy).
///  4. OPERATOR `postResult` with the revealed server seed (checked against the commitment) and
///     each runner's finishing position. RESULT_ATTESTOR `attestResult` with the same result
///     hash. GUARDIAN can `correctResult` (reopens the window; at most MAX_CORRECTIONS) or
///     `voidMarket` in the challenge window, or any time the result isn't attested.
///  5. After the window, with a matching attestation, anyone calls `finalize` (the pari-mutuel
///     split, same rules as game-core tote.ts) and each player `claim`s. Void markets refund.
///  6. A market with no result MAX_SETTLE_DELAY after `closeTime` (or a posted result that never
///     got a matching attestation MAX_SETTLE_DELAY after its window) can be expired by anyone:
///     every stake becomes refundable. Funds can never get stuck.
///
/// Unclaimed winnings and refunds stay claimable forever (no deadline, no sweep). Tokens sent to
/// this contract directly (not through `bet`) are not accounted anywhere and stay here for good:
/// there is deliberately no function that could move them. Plain ETH transfers are refused.
contract TotePools is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- roles

    /// @notice Creates markets, posts results, cancels a market before its entropy block is picked.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Server keys that sign BetPermits. Rotate by grant + revoke.
    bytes32 public constant PERMIT_SIGNER_ROLE = keccak256("PERMIT_SIGNER_ROLE");
    /// @notice Corrects or voids a posted result, voids an open market (a multisig).
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    /// @notice An independent service that replays each race from finalSeed and attests its result.
    bytes32 public constant RESULT_ATTESTOR_ROLE = keccak256("RESULT_ATTESTOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ---------------------------------------------------------------- constants

    uint16 private constant BPS = 10_000;
    /// @notice Hard cap on a market's takeout (25 %).
    uint16 public constant MAX_TAKEOUT_BPS = 2_500;
    uint8 public constant MAX_RUNNERS = 24;
    /// @notice A place pool needs this many runners that ran (game-core TOTE_PLACE_MIN_FIELD).
    uint8 private constant PLACE_MIN_FIELD = 5;
    /// @notice From this many runners the place pool pays three places (TOTE_PLACE_THREE_FROM).
    uint8 private constant PLACE_THREE_FROM = 8;
    /// @notice A pool needs this many distinct wallets on runners that ran, or it is refunded (TOTE_MIN_POOL_BETTORS).
    uint8 public constant MIN_POOL_BETTORS = 2;
    /// @notice ... backing this many distinct runners that ran (TOTE_MIN_POOL_RUNNERS).
    uint8 public constant MIN_POOL_RUNNERS = 2;
    /// @notice The guardian may correct a result this many times; after that only void.
    uint8 public constant MAX_CORRECTIONS = 2;
    /// @notice No BetPermit may be valid for longer than this, counted from its issue time.
    uint64 public constant MAX_PERMIT_TTL = 10 minutes;
    /// @notice A market can't be created further ahead than this.
    uint64 public constant MAX_MARKET_LEAD = 7 days;
    /// @notice lcm(1..24): every dead-heat share is a whole multiple of 1/DEAD_HEAT_DENOM.
    uint256 private constant DEAD_HEAT_DENOM = 5_354_228_880;

    bytes32 public constant BET_PERMIT_TYPEHASH = keccak256(
        "BetPermit(address bettor,bytes32 raceId,uint8 runner,uint8 pool,uint256 maxAmount,uint256 nonce,uint64 issuedAt,uint64 expiry)"
    );

    bytes32 private constant VOID_GUARDIAN = "guardian";
    bytes32 private constant VOID_CANCELLED = "cancelled";
    bytes32 private constant VOID_EXPIRED = "expired";
    bytes32 private constant VOID_ENTROPY_MISSED = "entropy_missed";
    bytes32 private constant POOL_NO_PLACE = "no_place_pool";
    bytes32 private constant POOL_THIN = "thin_pool";
    bytes32 private constant POOL_WINNERS_SHORT = "winners_short";

    // ---------------------------------------------------------------- types

    enum Pool {
        WIN,
        PLACE
    }

    enum Status {
        None,
        Open,
        ResultPosted,
        Finalized,
        Void
    }

    /// @dev How a finalized pool pays: winners share; nobody backed a paying runner (net pool
    /// back pro rata); no pool at all (every stake back in full).
    enum PoolMode {
        Unset,
        Winners,
        NoWinner,
        RefundAll
    }

    struct Market {
        uint64 closeTime;
        uint64 challengeEnd;
        /// @dev the first of ENTROPY_BLOCKS consecutive entropy blocks (0 = not locked yet)
        uint64 entropyBlock;
        uint16 takeoutBps;
        uint8 runnerCount;
        uint8 placeTerms;
        Status status;
        uint8 corrections;
        /// @dev an attestation didn't match the posted result: frozen until the guardian acts
        bool disputed;
        uint128 maxPool;
        /// @dev the stake asset: an allow-listed ERC-20, or NATIVE_ETH
        address asset;
        /// @dev the randomness beacon fixed at creation (address(0) = none)
        address beacon;
        bytes32 seedCommitment;
        /// @dev the block-hash part of the entropy (stored while a beacon's randomness is awaited)
        bytes32 blockEntropy;
        bytes32 entropy;
        bytes32 revealedSeed;
        bytes32 finalSeed;
        /// @dev byte i (little-endian) = finishing position of runner i; 0 = non-runner.
        bytes32 positions;
        /// @dev what RESULT_ATTESTOR attested (resultHashOf of its own replay)
        bytes32 attestedHash;
    }

    struct PoolState {
        uint128 total; // every stake in the pool (non-runners included)
        uint128 toPay; // what the bettors share once finalized
        uint128 paid;
        uint128 entitledStake; // stakes that share `toPay`
        uint128 claimedStake;
        PoolMode mode;
    }

    struct BetPermit {
        address bettor; // must be msg.sender
        bytes32 raceId;
        uint8 runner; // the bet must be on this runner ...
        uint8 pool; // ... in this pool
        uint256 maxAmount; // this bet may be at most this much
        uint256 nonce; // single-use per bettor
        uint64 issuedAt; // not valid before this (unix seconds)
        uint64 expiry; // nor after this; at most MAX_PERMIT_TTL after issuedAt
    }

    /// @notice Native ETH as a stake asset (msg.value bets, call-based payouts).
    address public constant NATIVE_ETH = address(0);

    struct StakeLimits {
        uint128 minStake;
        uint128 maxStakePerBet;
        uint128 maxStakePerWalletPerRace;
    }

    /// @notice Constructor role holders (each a different key).
    struct Roles {
        address admin;
        address operator;
        address permitSigner;
        address guardian;
        address attestor;
    }

    /// @notice Constructor timing.
    struct Timing {
        uint64 closeMargin;
        uint64 challengeWindow;
        uint64 maxSettleDelay;
        uint64 entropyDelayBlocks;
        uint64 entropyBlocks;
    }

    /// @dev The first wallet on a (pool, runner) and whether another one followed: enough to tell
    /// at finalize whether a pool has 2 distinct bettors, in O(runners).
    struct RunnerBettors {
        address first;
        bool multi;
    }

    /// @dev The settlement inputs of one pool (a struct keeps the stack small).
    struct Split {
        uint256[MAX_RUNNERS] weight;
        uint256 w;
        uint256 live;
        uint256 winStakes;
        uint256 backedRunners;
        bool twoBettors;
    }

    // ---------------------------------------------------------------- immutables

    /// @notice Bets are refused from closeTime - CLOSE_MARGIN (covers sequencer timestamp drift).
    uint64 public immutable CLOSE_MARGIN;
    uint64 public immutable CHALLENGE_WINDOW;
    uint64 public immutable MAX_SETTLE_DELAY;
    /// @notice lockEntropy targets the block this many L2 blocks ahead ...
    uint64 public immutable ENTROPY_DELAY_BLOCKS;
    /// @notice ... and this many consecutive blocks from there are mixed (at least 3).
    uint64 public immutable ENTROPY_BLOCKS;
    /// @notice The ArbSys precompile, or address(0) to use the EVM's own block number and hash
    /// (local test networks and non-Arbitrum chains; refused on Robinhood Chain).
    address public immutable arbSys;

    // ---------------------------------------------------------------- storage

    address public treasury;
    /// @notice The randomness beacon new markets will use (address(0) = none, the default).
    address public entropyBeacon;
    /// @notice Stake assets new markets may use (and new bets may be placed in).
    mapping(address asset => bool) public assetAllowed;
    /// @notice Per-asset stake limits, in that asset's base units.
    mapping(address asset => StakeLimits) public stakeLimits;
    /// @notice Takeout and rounding dust owed to the treasury, per asset (never player stakes).
    mapping(address asset => uint256) public treasuryOwed;

    mapping(bytes32 raceId => Market) private _markets;
    mapping(bytes32 raceId => mapping(uint8 pool => PoolState)) private _pools;
    /// @dev key = pool * 32 + runner
    mapping(bytes32 raceId => mapping(uint256 key => uint128)) private _runnerStake;
    mapping(bytes32 raceId => mapping(uint256 key => uint128)) private _runnerShare;
    mapping(bytes32 raceId => mapping(uint256 key => RunnerBettors)) private _runnerBettors;
    mapping(bytes32 raceId => mapping(address wallet => mapping(uint256 key => uint128))) private _stakeOf;
    /// @dev bit `key` set when the wallet holds a stake on that (pool, runner)
    mapping(bytes32 raceId => mapping(address wallet => uint64)) private _walletKeys;
    mapping(bytes32 raceId => mapping(address wallet => uint128)) public walletTotal;
    mapping(bytes32 raceId => mapping(address wallet => bool)) public claimed;
    mapping(address bettor => mapping(uint256 nonce => bool)) public nonceUsed;

    // ---------------------------------------------------------------- events

    event MarketCreated(
        bytes32 indexed raceId,
        address indexed asset,
        uint64 closeTime,
        uint8 runnerCount,
        uint8 placeTerms,
        bytes32 seedCommitment,
        uint16 takeoutBps,
        uint128 maxPool
    );
    event BetPlaced(
        bytes32 indexed raceId, address indexed bettor, uint8 pool, uint8 runner, uint256 amount, uint256 indexed nonce, uint256 poolTotal, uint256 runnerTotal
    );
    event EntropyLocked(bytes32 indexed raceId, uint64 entropyBlock);
    event BlockEntropyStored(bytes32 indexed raceId, bytes32 blockEntropy);
    event EntropySealed(bytes32 indexed raceId, uint64 entropyBlock, bytes32 entropy);
    event ResultPosted(bytes32 indexed raceId, bytes32 revealedSeed, bytes32 finalSeed, bytes32 positions, bytes32 resultHash, uint64 challengeEnd);
    event ResultAttested(bytes32 indexed raceId, bytes32 attestedHash, bool matches);
    event ResultCorrected(bytes32 indexed raceId, bytes32 oldPositions, bytes32 newPositions, bytes32 resultHash, uint64 challengeEnd, uint8 corrections);
    event MarketFinalized(bytes32 indexed raceId, uint256 winTotal, uint256 placeTotal, uint256 toTreasury);
    event PoolRefunded(bytes32 indexed raceId, uint8 pool, bytes32 reason);
    event MarketVoided(bytes32 indexed raceId, bytes32 reason);
    event Claimed(bytes32 indexed raceId, address indexed bettor, address to, uint256 amount);
    event DustSwept(bytes32 indexed raceId, uint8 pool, uint256 amount);
    event TreasuryWithdrawn(address indexed asset, address indexed treasury, uint256 amount);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event EntropyBeaconSet(address indexed oldBeacon, address indexed newBeacon);
    event StakeLimitsSet(address indexed asset, uint128 minStake, uint128 maxStakePerBet, uint128 maxStakePerWalletPerRace);
    event AssetAllowedSet(address indexed asset, bool allowed);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error BadConfig();
    error SharedRoleKey();
    error MarketExists(bytes32 raceId);
    error BadMarket();
    error MarketNotOpen(bytes32 raceId);
    error BettingClosed(uint64 closesAt);
    error BadRunner(uint8 runner);
    error NoPlacePool();
    error NotPermitBettor(address expected, address actual);
    error PermitRaceMismatch();
    error PermitTermsMismatch();
    error PermitNotYetValid(uint64 issuedAt);
    error PermitExpired(uint64 expiry);
    error PermitTtlTooLong(uint64 expiry);
    error NonceUsed(uint256 nonce);
    error InvalidSignature();
    error AboveMaxAmount(uint256 amount, uint256 maxAmount);
    error StakeBelowMin(uint256 amount, uint256 min);
    error StakeAboveMax(uint256 amount, uint256 max);
    error WalletCapExceeded(uint256 total, uint256 cap);
    error PoolCapExceeded(uint256 total, uint256 cap);
    error UnexpectedAmountReceived(uint256 expected, uint256 received);
    error EntropyTooEarly(uint64 closeTime);
    error EntropyAlreadyLocked();
    error EntropyNotLocked();
    error EntropyNotReady(uint64 lastBlock);
    error EntropyAlreadySealed();
    error EntropyNotSealed();
    error EntropyReadFailed();
    error BeaconNotReady();
    error SeedMismatch();
    error BadPositions();
    error ResultTooLate();
    error NotResultPosted(bytes32 raceId);
    error ChallengeWindowOver(uint64 challengeEnd);
    error ChallengeWindowOpen(uint64 challengeEnd);
    error NotAttested();
    error AttestationMismatch();
    error ResultDisputed();
    error TooManyCorrections();
    error NotVoidable();
    error NotExpired(uint64 expiresAt);
    error NotClaimable(bytes32 raceId);
    error AlreadyClaimed();
    error NothingToClaim();
    error AssetNotAllowed(address asset);
    error WrongEthAmount(uint256 expected, uint256 sent);
    error EthTransferFailed();

    constructor(Roles memory roles, address treasury_, address usdg, address arbSys_, Timing memory t) EIP712("PostTimeTotePools", "1") {
        if (
            roles.admin == address(0) || roles.operator == address(0) || roles.permitSigner == address(0) || roles.guardian == address(0)
                || roles.attestor == address(0) || treasury_ == address(0) || usdg == address(0)
        ) revert ZeroAddress();
        // The keys that decide or check results must be different keys.
        if (
            roles.attestor == roles.operator || roles.guardian == roles.operator || roles.guardian == roles.attestor
                || roles.permitSigner == roles.operator || roles.permitSigner == roles.attestor
        ) revert SharedRoleKey();
        if (
            t.closeMargin == 0 || t.closeMargin > 1 hours || t.challengeWindow < 10 minutes || t.challengeWindow > 7 days || t.maxSettleDelay < t.challengeWindow
                || t.maxSettleDelay > 30 days || t.entropyDelayBlocks == 0 || t.entropyDelayBlocks > 64 || t.entropyBlocks < 3 || t.entropyBlocks > 16
        ) revert BadConfig();
        // On Robinhood Chain the block reads must come from ArbSys; any ArbSys given must exist.
        uint256 id = _chainId();
        if ((id == 4663 || id == 46630) && arbSys_ == address(0)) revert BadConfig();
        if (arbSys_ != address(0) && arbSys_.code.length == 0) revert BadConfig();
        _grantRole(DEFAULT_ADMIN_ROLE, roles.admin);
        _grantRole(PAUSER_ROLE, roles.admin);
        _grantRole(OPERATOR_ROLE, roles.operator);
        _grantRole(PERMIT_SIGNER_ROLE, roles.permitSigner);
        _grantRole(GUARDIAN_ROLE, roles.guardian);
        _grantRole(RESULT_ATTESTOR_ROLE, roles.attestor);
        arbSys = arbSys_;
        CLOSE_MARGIN = t.closeMargin;
        CHALLENGE_WINDOW = t.challengeWindow;
        MAX_SETTLE_DELAY = t.maxSettleDelay;
        ENTROPY_DELAY_BLOCKS = t.entropyDelayBlocks;
        ENTROPY_BLOCKS = t.entropyBlocks;
        treasury = treasury_;
        emit TreasurySet(address(0), treasury_);
        // Only USDG is allow-listed at deployment (6 decimals: 1 USDG minimum, 100 per bet, 250
        // per wallet per race until changed). ETH stays off until an admin configures it.
        _setStakeLimits(usdg, 1e6, 100e6, 250e6);
        assetAllowed[usdg] = true;
        emit AssetAllowedSet(usdg, true);
    }

    // ---------------------------------------------------------------- markets

    /// @notice Opens a race market in one stake asset. The seed commitment is fixed here, before
    /// any bet, forever. So is the randomness beacon (the one configured now, if any).
    function createMarket(
        bytes32 raceId,
        address asset,
        uint64 closeTime,
        uint8 runnerCount,
        uint8 placeTerms,
        bytes32 seedCommitment,
        uint16 takeoutBps,
        uint128 maxPool
    ) external onlyRole(OPERATOR_ROLE) {
        if (_markets[raceId].status != Status.None) revert MarketExists(raceId);
        if (!assetAllowed[asset]) revert AssetNotAllowed(asset);
        if (raceId == bytes32(0) || seedCommitment == bytes32(0) || maxPool == 0) revert BadMarket();
        if (closeTime <= block.timestamp + CLOSE_MARGIN || closeTime > block.timestamp + MAX_MARKET_LEAD) revert BadMarket();
        if (runnerCount < 2 || runnerCount > MAX_RUNNERS) revert BadMarket();
        if (placeTerms != 0 && (placeTerms < 2 || placeTerms > 3 || placeTerms >= runnerCount)) revert BadMarket();
        if (takeoutBps > MAX_TAKEOUT_BPS) revert BadMarket();
        Market storage m = _markets[raceId];
        m.closeTime = closeTime;
        m.runnerCount = runnerCount;
        m.placeTerms = placeTerms;
        m.takeoutBps = takeoutBps;
        m.maxPool = maxPool;
        m.asset = asset;
        m.beacon = entropyBeacon;
        m.seedCommitment = seedCommitment;
        m.status = Status.Open;
        emit MarketCreated(raceId, asset, closeTime, runnerCount, placeTerms, seedCommitment, takeoutBps, maxPool);
    }

    /// @notice Places a bet in the market's asset: an ERC-20 market needs `amount` approved and
    /// no ETH sent; an ETH market needs msg.value == amount. Bets are final.
    function bet(bytes32 raceId, uint8 runner, Pool pool, uint256 amount, BetPermit calldata permit, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        _checkPermit(raceId, runner, uint8(pool), amount, permit, signature);
        nonceUsed[msg.sender][permit.nonce] = true;
        (uint256 pTotal, uint256 rTotal) = _recordBet(raceId, runner, uint8(pool), amount);
        _collect(_markets[raceId].asset, amount);
        emit BetPlaced(raceId, msg.sender, uint8(pool), runner, amount, permit.nonce, pTotal, rTotal);
    }

    /// @dev Takes the stake: ETH must arrive as msg.value; an ERC-20 is pulled and the exact
    /// amount received checked (fee-on-transfer tokens are refused).
    function _collect(address asset, uint256 amount) private {
        if (asset == NATIVE_ETH) {
            if (msg.value != amount) revert WrongEthAmount(amount, msg.value);
            return;
        }
        if (msg.value != 0) revert WrongEthAmount(0, msg.value);
        IERC20 t = IERC20(asset);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = t.balanceOf(address(this)) - before;
        if (received != amount) revert UnexpectedAmountReceived(amount, received);
    }

    /// @dev Market, timing and cap checks, then the bookkeeping (before any token call).
    function _recordBet(bytes32 raceId, uint8 runner, uint8 pool, uint256 amount) private returns (uint256 pTotal, uint256 rTotal) {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (block.timestamp + CLOSE_MARGIN >= m.closeTime) revert BettingClosed(m.closeTime - CLOSE_MARGIN);
        if (runner >= m.runnerCount) revert BadRunner(runner);
        if (pool == uint8(Pool.PLACE) && m.placeTerms == 0) revert NoPlacePool();
        if (!assetAllowed[m.asset]) revert AssetNotAllowed(m.asset); // a de-listed asset takes no new bets
        StakeLimits memory lim = stakeLimits[m.asset];
        if (amount < lim.minStake) revert StakeBelowMin(amount, lim.minStake);
        if (amount > lim.maxStakePerBet) revert StakeAboveMax(amount, lim.maxStakePerBet);
        uint256 wTotal = walletTotal[raceId][msg.sender] + amount;
        if (wTotal > lim.maxStakePerWalletPerRace) revert WalletCapExceeded(wTotal, lim.maxStakePerWalletPerRace);
        PoolState storage ps = _pools[raceId][pool];
        pTotal = ps.total + amount;
        if (pTotal > m.maxPool) revert PoolCapExceeded(pTotal, m.maxPool);

        // amount <= maxStakePerBet and every total <= a uint128 cap, so the casts are exact.
        uint256 key = _key(pool, runner);
        walletTotal[raceId][msg.sender] = uint128(wTotal);
        ps.total = uint128(pTotal);
        rTotal = _runnerStake[raceId][key] + amount;
        _runnerStake[raceId][key] = uint128(rTotal);
        _stakeOf[raceId][msg.sender][key] += uint128(amount);
        _walletKeys[raceId][msg.sender] |= uint64(1 << key); // key < 56
        RunnerBettors storage rb = _runnerBettors[raceId][key];
        if (rb.first == address(0)) rb.first = msg.sender;
        else if (!rb.multi && rb.first != msg.sender) rb.multi = true;
    }

    // ---------------------------------------------------------------- entropy

    /// @notice After closeTime anyone fixes the entropy blocks: the first is ENTROPY_DELAY_BLOCKS
    /// ahead, so none of their hashes exist yet and the caller can't pick them. With a beacon,
    /// asks it for randomness too.
    function lockEntropy(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (block.timestamp < m.closeTime) revert EntropyTooEarly(m.closeTime);
        if (m.entropyBlock != 0) revert EntropyAlreadyLocked();
        uint64 target = uint64(_currentBlock()) + ENTROPY_DELAY_BLOCKS;
        m.entropyBlock = target;
        emit EntropyLocked(raceId, target);
        if (m.beacon != address(0)) IEntropyBeacon(m.beacon).requestRandomness(raceId);
    }

    /// @notice Anyone mixes the ENTROPY_BLOCKS block hashes once the last of them exists (and the
    /// beacon's randomness, when the market has a beacon). If any of those hashes was no longer
    /// readable (256 blocks), the market is void and every stake refundable: re-picking blocks
    /// would let whoever knows the server seed choose an outcome.
    function sealEntropy(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (m.entropyBlock == 0) revert EntropyNotLocked();
        if (m.entropy != bytes32(0)) revert EntropyAlreadySealed();
        bool fresh = m.blockEntropy == bytes32(0);
        if (fresh) {
            uint256 last = uint256(m.entropyBlock) + ENTROPY_BLOCKS - 1;
            if (_currentBlock() <= last) revert EntropyNotReady(uint64(last));
            bytes32 mix = _mixBlocks(raceId, m.entropyBlock);
            if (mix == bytes32(0)) {
                _void(raceId, VOID_ENTROPY_MISSED);
                return;
            }
            m.blockEntropy = mix;
        }
        bytes32 e = m.blockEntropy;
        if (m.beacon != address(0)) {
            bytes32 r = IEntropyBeacon(m.beacon).randomness(raceId);
            if (r == bytes32(0)) {
                if (!fresh) revert BeaconNotReady();
                emit BlockEntropyStored(raceId, e); // the block part is fixed; the beacon completes it
                return;
            }
            e = keccak256(abi.encodePacked(e, r));
        }
        m.entropy = e;
        emit EntropySealed(raceId, m.entropyBlock, e);
    }

    // ---------------------------------------------------------------- results

    /// @notice Posts the result: the revealed server seed (must match the commitment) and each
    /// runner's finishing position (0 = non-runner; equal positions = dead heat). Opens the
    /// challenge window. It needs a matching attestation before it can be finalized.
    function postResult(bytes32 raceId, bytes32 revealedSeed, uint8[] calldata positions) external onlyRole(OPERATOR_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (m.entropy == bytes32(0)) revert EntropyNotSealed();
        if (block.timestamp > uint256(m.closeTime) + MAX_SETTLE_DELAY) revert ResultTooLate();
        if (sha256(abi.encodePacked(revealedSeed)) != m.seedCommitment) revert SeedMismatch();
        bytes32 packed = _packPositions(m.runnerCount, positions);
        bytes32 finalSeed = sha256(abi.encodePacked(revealedSeed, m.entropy));
        uint64 end = uint64(block.timestamp) + CHALLENGE_WINDOW;
        m.revealedSeed = revealedSeed;
        m.finalSeed = finalSeed;
        m.positions = packed;
        m.challengeEnd = end;
        m.status = Status.ResultPosted;
        emit ResultPosted(raceId, revealedSeed, finalSeed, packed, resultHashOf(raceId, finalSeed, packed), end);
    }

    /// @notice RESULT_ATTESTOR's independent check: the hash of the result it got by replaying the
    /// race from finalSeed. A mismatch freezes the market until the guardian corrects or voids it.
    function attestResult(bytes32 raceId, bytes32 attestedHash) external onlyRole(RESULT_ATTESTOR_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.ResultPosted) revert NotResultPosted(raceId);
        if (attestedHash == bytes32(0)) revert BadPositions();
        bool matches = attestedHash == resultHashOf(raceId, m.finalSeed, m.positions);
        m.attestedHash = attestedHash;
        if (!matches) m.disputed = true;
        emit ResultAttested(raceId, attestedHash, matches);
    }

    /// @notice GUARDIAN replaces the posted positions: in the challenge window, or any time the
    /// result isn't finalizable (disputed or unattested). Each correction reopens the full
    /// window and clears a dispute; at most MAX_CORRECTIONS, then only void.
    function correctResult(bytes32 raceId, uint8[] calldata positions) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.ResultPosted) revert NotResultPosted(raceId);
        if (block.timestamp >= m.challengeEnd && _finalizable(raceId, m)) revert ChallengeWindowOver(m.challengeEnd);
        if (m.corrections >= MAX_CORRECTIONS) revert TooManyCorrections();
        bytes32 packed = _packPositions(m.runnerCount, positions);
        bytes32 old = m.positions;
        uint64 end = uint64(block.timestamp) + CHALLENGE_WINDOW;
        m.positions = packed;
        m.challengeEnd = end;
        m.disputed = false;
        m.corrections += 1;
        emit ResultCorrected(raceId, old, packed, resultHashOf(raceId, m.finalSeed, packed), end, m.corrections);
    }

    /// @notice GUARDIAN voids a market (every stake refundable): any time before a result; after
    /// one, during the challenge window or while it isn't finalizable.
    function voidMarket(bytes32 raceId) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status == Status.ResultPosted) {
            if (block.timestamp >= m.challengeEnd && _finalizable(raceId, m)) revert ChallengeWindowOver(m.challengeEnd);
        } else if (m.status != Status.Open) {
            revert NotVoidable();
        }
        _void(raceId, VOID_GUARDIAN);
    }

    /// @notice OPERATOR calls off a market (race abandoned, field problem) only while nobody can
    /// know anything about the outcome: before the entropy blocks are picked. After that only the
    /// guardian can void (or anyone, once it expires).
    function cancelMarket(bytes32 raceId) external onlyRole(OPERATOR_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open || m.entropyBlock != 0) revert NotVoidable();
        _void(raceId, VOID_CANCELLED);
    }

    /// @notice Anyone: a market with no result MAX_SETTLE_DELAY after closeTime is void, and so is
    /// a posted result still not finalizable MAX_SETTLE_DELAY after its challenge window.
    function expireMarket(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        uint64 expiresAt;
        if (m.status == Status.Open) {
            expiresAt = m.closeTime + MAX_SETTLE_DELAY;
        } else if (m.status == Status.ResultPosted) {
            if (_finalizable(raceId, m)) revert NotVoidable();
            expiresAt = m.challengeEnd + MAX_SETTLE_DELAY;
        } else {
            revert MarketNotOpen(raceId);
        }
        if (block.timestamp <= expiresAt) revert NotExpired(expiresAt);
        _void(raceId, VOID_EXPIRED);
    }

    /// @notice Anyone, after the challenge window, once RESULT_ATTESTOR's hash matches: the
    /// pari-mutuel split. No token moves here.
    function finalize(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.ResultPosted) revert NotResultPosted(raceId);
        if (block.timestamp < m.challengeEnd) revert ChallengeWindowOpen(m.challengeEnd);
        if (m.disputed) revert ResultDisputed();
        if (m.attestedHash == bytes32(0)) revert NotAttested();
        if (m.attestedHash != resultHashOf(raceId, m.finalSeed, m.positions)) revert AttestationMismatch();
        m.status = Status.Finalized;

        uint8 n = m.runnerCount;
        bytes32 packed = m.positions;
        uint256[MAX_RUNNERS + 1] memory tie; // runners per position
        uint256 ran;
        for (uint8 r = 0; r < n; r++) {
            uint256 p = _positionOf(packed, r);
            if (p != 0) {
                tie[p]++;
                ran++;
            }
        }
        uint256 toTreasury = _settlePool(raceId, 0, 1, tie);
        uint256 places = _placesFor(ran);
        if (m.placeTerms < places) places = m.placeTerms;
        toTreasury += _settlePool(raceId, 1, places, tie);
        treasuryOwed[m.asset] += toTreasury;
        emit MarketFinalized(raceId, _pools[raceId][0].total, _pools[raceId][1].total, toTreasury);
    }

    // ---------------------------------------------------------------- claims

    /// @notice Pays out everything the caller is owed on this race (winnings, refunds for
    /// non-runners, void markets and void pools) to `to`. Once per wallet per race, with no
    /// deadline. Never blocked by pause.
    function claim(bytes32 raceId, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        Status s = _markets[raceId].status;
        address asset = _markets[raceId].asset;
        if (s != Status.Finalized && s != Status.Void) revert NotClaimable(raceId);
        if (claimed[raceId][msg.sender]) revert AlreadyClaimed();
        if (_walletKeys[raceId][msg.sender] == 0) revert NothingToClaim();
        uint128[2] memory stakeDelta;
        uint128[2] memory payDelta;
        (amount, stakeDelta, payDelta) = _claimable(raceId, msg.sender);

        // Effects
        claimed[raceId][msg.sender] = true;
        for (uint8 p = 0; p < 2; p++) {
            if (stakeDelta[p] == 0 && payDelta[p] == 0) continue;
            PoolState storage ps = _pools[raceId][p];
            ps.claimedStake += stakeDelta[p];
            ps.paid += payDelta[p];
            // The last share claimed: the rounding dust left in this pool goes to the treasury.
            if (ps.claimedStake == ps.entitledStake && ps.paid < ps.toPay) {
                uint256 dust = ps.toPay - ps.paid;
                ps.paid = ps.toPay;
                treasuryOwed[asset] += dust;
                emit DustSwept(raceId, p, dust);
            }
        }
        // Interaction
        if (amount > 0) _send(asset, to, amount);
        emit Claimed(raceId, msg.sender, to, amount);
    }

    /// @notice Anyone: sends one asset's accrued takeout and dust to the treasury. Never player funds.
    function withdrawTreasury(address asset) external nonReentrant {
        uint256 amount = treasuryOwed[asset];
        treasuryOwed[asset] = 0;
        if (amount > 0) _send(asset, treasury, amount);
        emit TreasuryWithdrawn(asset, treasury, amount);
    }

    // ---------------------------------------------------------------- views

    function getMarket(bytes32 raceId) external view returns (Market memory) {
        return _markets[raceId];
    }

    function getPool(bytes32 raceId, Pool pool) external view returns (PoolState memory) {
        return _pools[raceId][uint8(pool)];
    }

    /// @notice Stakes per runner in one pool (the live odds come from these).
    function runnerStakes(bytes32 raceId, Pool pool) external view returns (uint256[] memory out) {
        uint8 n = _markets[raceId].runnerCount;
        out = new uint256[](n);
        for (uint8 r = 0; r < n; r++) {
            out[r] = _runnerStake[raceId][_key(uint8(pool), r)];
        }
    }

    function stakeOf(bytes32 raceId, address wallet, Pool pool, uint8 runner) external view returns (uint256) {
        return _stakeOf[raceId][wallet][_key(uint8(pool), runner)];
    }

    /// @notice The finalized share of a paying runner's backers (0 for others).
    function runnerShare(bytes32 raceId, Pool pool, uint8 runner) external view returns (uint256) {
        return _runnerShare[raceId][_key(uint8(pool), runner)];
    }

    /// @notice What `claim` would pay this wallet now (0 once claimed or before it can claim).
    function claimable(bytes32 raceId, address wallet) external view returns (uint256 amount) {
        Status s = _markets[raceId].status;
        if ((s != Status.Finalized && s != Status.Void) || claimed[raceId][wallet]) return 0;
        (amount,,) = _claimable(raceId, wallet);
    }

    /// @notice EIP-712 digest of a BetPermit (what the permit signer signs).
    function hashBetPermit(BetPermit calldata p) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(BET_PERMIT_TYPEHASH, p.bettor, p.raceId, p.runner, p.pool, p.maxAmount, p.nonce, p.issuedAt, p.expiry))
        );
    }

    /// @notice What the attestor attests: keccak256(abi.encode(raceId, finalSeed, packed positions)).
    function resultHashOf(bytes32 raceId, bytes32 finalSeed, bytes32 positions) public pure returns (bytes32) {
        return keccak256(abi.encode(raceId, finalSeed, positions));
    }

    /// @notice finalSeed = sha256(serverSeed ‖ entropy), the seed the race runs on.
    function finalSeedOf(bytes32 serverSeed, bytes32 entropy) external pure returns (bytes32) {
        return sha256(abi.encodePacked(serverSeed, entropy));
    }

    // ---------------------------------------------------------------- admin

    /// @notice Stake limits of one asset (its base units), for bets from now on.
    function setStakeLimits(address asset, uint128 min_, uint128 perBet, uint128 perWalletPerRace) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setStakeLimits(asset, min_, perBet, perWalletPerRace);
    }

    /// @notice Allow-lists (or de-lists) a stake asset; NATIVE_ETH is address(0). Allowing needs
    /// its stake limits set first. De-listing stops new markets and new bets in that asset; it
    /// never blocks results, refunds or claims of existing markets.
    function setAssetAllowed(address asset, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (allowed && stakeLimits[asset].minStake == 0) revert BadConfig();
        assetAllowed[asset] = allowed;
        emit AssetAllowedSet(asset, allowed);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Plugs in (or removes, with address(0)) the randomness beacon for markets created
    /// from now on. Existing markets keep the one they were created with.
    function setEntropyBeacon(address beacon) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (beacon != address(0) && beacon.code.length == 0) revert BadConfig();
        emit EntropyBeaconSet(entropyBeacon, beacon);
        entropyBeacon = beacon;
    }

    /// @notice Stops new bets only. Entropy, results, refunds and claims keep working.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- internals

    /// @dev The chain id the constructor checks (overridden only by a test harness).
    function _chainId() internal view virtual returns (uint256) {
        return block.chainid;
    }

    function _setStakeLimits(address asset, uint128 min_, uint128 perBet, uint128 perWalletPerRace) private {
        if (min_ == 0 || perBet < min_ || perWalletPerRace < perBet) revert BadConfig();
        stakeLimits[asset] = StakeLimits(min_, perBet, perWalletPerRace);
        emit StakeLimitsSet(asset, min_, perBet, perWalletPerRace);
    }

    /// @dev Pays out in a market's asset. ETH by call (callers are nonReentrant; a recipient that
    /// refuses ETH fails only its own claim, and can claim to another address).
    function _send(address asset, address to, uint256 amount) private {
        if (asset == NATIVE_ETH) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    function _checkPermit(bytes32 raceId, uint8 runner, uint8 pool, uint256 amount, BetPermit calldata permit, bytes calldata signature) private view {
        if (permit.bettor != msg.sender) revert NotPermitBettor(permit.bettor, msg.sender);
        if (permit.raceId != raceId) revert PermitRaceMismatch();
        if (permit.runner != runner || permit.pool != pool) revert PermitTermsMismatch();
        if (block.timestamp < permit.issuedAt) revert PermitNotYetValid(permit.issuedAt);
        if (block.timestamp > permit.expiry) revert PermitExpired(permit.expiry);
        if (permit.expiry > uint256(permit.issuedAt) + MAX_PERMIT_TTL) revert PermitTtlTooLong(permit.expiry);
        if (nonceUsed[msg.sender][permit.nonce]) revert NonceUsed(permit.nonce);
        if (amount > permit.maxAmount) revert AboveMaxAmount(amount, permit.maxAmount);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashBetPermit(permit), signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(PERMIT_SIGNER_ROLE, signer)) revert InvalidSignature();
    }

    function _finalizable(bytes32 raceId, Market storage m) private view returns (bool) {
        return !m.disputed && m.attestedHash != bytes32(0) && m.attestedHash == resultHashOf(raceId, m.finalSeed, m.positions);
    }

    function _void(bytes32 raceId, bytes32 reason) private {
        _markets[raceId].status = Status.Void;
        emit MarketVoided(raceId, reason);
    }

    function _key(uint8 pool, uint8 runner) private pure returns (uint256) {
        return uint256(pool) * 32 + runner;
    }

    function _positionOf(bytes32 packed, uint8 runner) private pure returns (uint256) {
        return (uint256(packed) >> (8 * uint256(runner))) & 0xff;
    }

    function _placesFor(uint256 ran) private pure returns (uint256) {
        if (ran >= PLACE_THREE_FROM) return 3;
        if (ran >= PLACE_MIN_FIELD) return 2;
        return 0;
    }

    /// @dev Validates a finish (standard competition ranking: 1, 1, 3, 4 ...) and packs it.
    function _packPositions(uint8 runnerCount, uint8[] calldata positions) private pure returns (bytes32 packed) {
        if (positions.length != runnerCount) revert BadPositions();
        uint256[MAX_RUNNERS + 1] memory count;
        uint256 ran;
        uint256 word;
        for (uint256 i = 0; i < runnerCount; i++) {
            uint256 p = positions[i];
            if (p > runnerCount) revert BadPositions();
            if (p != 0) {
                count[p]++;
                ran++;
            }
            word |= p << (8 * i);
        }
        uint256 next = 1;
        for (uint256 p = 1; p <= runnerCount; p++) {
            if (p == next && next <= ran) {
                if (count[p] == 0) revert BadPositions();
                next += count[p];
            } else if (count[p] != 0) {
                revert BadPositions();
            }
        }
        packed = bytes32(word);
    }

    /// @dev Every stake on this pool back in full, no take (no place pool, a thin pool).
    function _refundPool(bytes32 raceId, uint8 pool, bytes32 reason) private {
        _pools[raceId][pool].mode = PoolMode.RefundAll;
        emit PoolRefunded(raceId, pool, reason);
    }

    /// @dev Settles one pool (game-core settleTotePool): returns what goes to the treasury now
    /// (the take plus the rounding left between the net pool and the runners' shares).
    function _settlePool(bytes32 raceId, uint8 pool, uint256 places, uint256[MAX_RUNNERS + 1] memory tie) private returns (uint256) {
        PoolState storage ps = _pools[raceId][pool];
        if (ps.total == 0) return 0;
        if (places == 0) {
            _refundPool(raceId, pool, POOL_NO_PLACE); // no place pool for this field: every stake back
            return 0;
        }
        Split memory sp = _split(raceId, pool, places, tie);
        if (sp.live == 0) {
            ps.mode = PoolMode.RefundAll; // only non-runner stakes: all refunded in full
            return 0;
        }
        // Minimum pool: 2 distinct wallets backing 2 distinct runners that ran, or every stake back.
        if (!sp.twoBettors || sp.backedRunners < MIN_POOL_RUNNERS) {
            _refundPool(raceId, pool, POOL_THIN);
            return 0;
        }
        uint256 take = (sp.live * _markets[raceId].takeoutBps) / BPS;
        if (sp.w == 0) {
            ps.mode = PoolMode.NoWinner; // nobody backed a paying runner: net pool back pro rata
            ps.toPay = uint128(sp.live - take);
            ps.entitledStake = uint128(sp.live);
            return take;
        }
        // Winners never lose: their stakes come back first, so the take is at most what is left.
        // The winning stakes are part of the live pool, so this can't trigger (kept as the
        // assertion game-core has: void rather than pay a winner short).
        if (sp.winStakes > sp.live) {
            _refundPool(raceId, pool, POOL_WINNERS_SHORT);
            return 0;
        }
        if (take > sp.live - sp.winStakes) take = sp.live - sp.winStakes;
        uint256 profit = sp.live - take - sp.winStakes;
        (uint256 shared, uint256 entitled) = _assignShares(raceId, pool, sp.weight, sp.w, profit);
        ps.mode = PoolMode.Winners;
        ps.toPay = uint128(shared);
        ps.entitledStake = uint128(entitled);
        return take + (sp.live - take - shared);
    }

    /// @dev Each backed paying runner's share: its backers' stakes back plus its part of the
    /// profit, rounded down. Only a runner with a share counts toward entitledStake, so the
    /// pool's dust is swept when the last share is claimed.
    function _assignShares(bytes32 raceId, uint8 pool, uint256[MAX_RUNNERS] memory weight, uint256 w, uint256 profit)
        private
        returns (uint256 shared, uint256 entitled)
    {
        for (uint8 r = 0; r < MAX_RUNNERS; r++) {
            if (weight[r] == 0) continue;
            uint256 key = _key(pool, r);
            uint256 s = _runnerStake[raceId][key];
            uint256 a = s + (profit * weight[r]) / w;
            if (a == 0) continue;
            _runnerShare[raceId][key] = uint128(a);
            shared += a;
            entitled += s;
        }
    }

    /// @dev One pool's settlement inputs: the live pool (stakes on runners that ran), the
    /// dead-heat weights and stakes of the backed paying runners (k runners tied at position p
    /// cover places p..p+k-1, each taking the paying ones among them divided by k), how many
    /// runners that ran are backed, and whether 2 distinct wallets back them.
    function _split(bytes32 raceId, uint8 pool, uint256 places, uint256[MAX_RUNNERS + 1] memory tie) private view returns (Split memory sp) {
        Market storage m = _markets[raceId];
        bytes32 packed = m.positions;
        uint8 n = m.runnerCount;
        address seen;
        for (uint8 r = 0; r < n; r++) {
            uint256 p = _positionOf(packed, r);
            if (p == 0) continue;
            uint256 key = _key(pool, r);
            uint256 s = _runnerStake[raceId][key];
            if (s == 0) continue;
            sp.live += s;
            sp.backedRunners++;
            RunnerBettors memory rb = _runnerBettors[raceId][key];
            if (rb.multi) sp.twoBettors = true;
            else if (seen == address(0)) seen = rb.first;
            else if (rb.first != seen) sp.twoBettors = true;
            if (p > places) continue;
            uint256 last = p + tie[p] - 1;
            uint256 covered = (last < places ? last : places) - p + 1;
            sp.weight[r] = (covered * DEAD_HEAT_DENOM) / tie[p];
            sp.w += sp.weight[r];
            sp.winStakes += s;
        }
    }

    function _claimable(bytes32 raceId, address wallet) private view returns (uint256 amount, uint128[2] memory stakeDelta, uint128[2] memory payDelta) {
        bool isVoid = _markets[raceId].status == Status.Void;
        uint64 keys = _walletKeys[raceId][wallet];
        uint256[2] memory noWinnerStake;
        for (uint256 key = 0; keys >> key != 0; key++) {
            if ((keys >> key) & 1 == 0) continue;
            uint256 s = _stakeOf[raceId][wallet][key];
            if (isVoid) {
                amount += s; // void market: every stake back in full
                continue;
            }
            (uint256 refund, uint256 pay, bool shares, bool noWinner) = _keyOutcome(raceId, key, s);
            uint256 pool = key / 32;
            amount += refund + pay;
            if (noWinner) {
                noWinnerStake[pool] += s;
            } else if (shares) {
                stakeDelta[pool] += uint128(s);
                payDelta[pool] += uint128(pay);
            }
        }
        for (uint8 p = 0; p < 2; p++) {
            if (noWinnerStake[p] == 0) continue;
            PoolState storage ps = _pools[raceId][p];
            uint256 pay = (uint256(ps.toPay) * noWinnerStake[p]) / ps.entitledStake;
            amount += pay;
            stakeDelta[p] += uint128(noWinnerStake[p]);
            payDelta[p] += uint128(pay);
        }
    }

    /// @dev What a finalized stake `s` on (pool, runner) `key` gets: a full refund (no pool, a void
    /// pool, or a non-runner), a share of its runner's dividend, a pro-rata part of a no-winner
    /// pool, or nothing.
    function _keyOutcome(bytes32 raceId, uint256 key, uint256 s) private view returns (uint256 refund, uint256 pay, bool shares, bool noWinner) {
        PoolMode mode = _pools[raceId][uint8(key / 32)].mode;
        if (mode == PoolMode.RefundAll || _positionOf(_markets[raceId].positions, uint8(key % 32)) == 0) return (s, 0, false, false);
        if (mode == PoolMode.NoWinner) return (0, 0, false, true);
        uint256 share = _runnerShare[raceId][key];
        if (share == 0) return (0, 0, false, false); // a losing runner
        return (0, (share * s) / _runnerStake[raceId][key], true, false);
    }

    function _currentBlock() private view returns (uint256) {
        return arbSys == address(0) ? block.number : IArbSysBlocks(arbSys).arbBlockNumber();
    }

    /// @dev keccak256(raceId ‖ hash(start) ‖ ... ‖ hash(start + ENTROPY_BLOCKS - 1)), or 0 when any
    /// of those hashes is no longer readable.
    function _mixBlocks(bytes32 raceId, uint256 start) private view returns (bytes32) {
        bytes memory buf = abi.encodePacked(raceId);
        for (uint256 i = 0; i < ENTROPY_BLOCKS; i++) {
            bytes32 h = _blockHash(start + i);
            if (h == bytes32(0)) return bytes32(0);
            buf = abi.encodePacked(buf, h);
        }
        return keccak256(buf);
    }

    /// @dev A block's hash, or 0 when it is out of range. Only ArbSys' own out-of-range error
    /// counts as "out of range": any other failure (out of gas included) reverts, so a caller
    /// can't void a market by starving the call.
    function _blockHash(uint256 n) private view returns (bytes32) {
        if (arbSys == address(0)) return blockhash(n);
        try IArbSysBlocks(arbSys).arbBlockHash(n) returns (bytes32 h) {
            return h;
        } catch (bytes memory reason) {
            if (reason.length >= 4 && bytes4(reason) == IArbSysBlocks.InvalidBlockNumber.selector) return bytes32(0);
            revert EntropyReadFailed();
        }
    }
}
