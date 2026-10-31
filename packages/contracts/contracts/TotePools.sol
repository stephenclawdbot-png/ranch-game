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
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 arbBlockNum) external view returns (bytes32);
}

/// @title TotePools
/// @notice DORMANT scaffold of a real-USDG pari-mutuel tote for POST TIME (docs/usdg-tote.md).
/// Not deployed; nothing in the app talks to it unless REAL_TOTE_ENABLED, WEB3_ENABLED and
/// TOTE_POOLS_ADDRESS are all set, which needs legal approval first.
///
/// Non-custodial: player stakes sit in this contract only, never with the operator. No role can
/// move a player's stake or winnings anywhere but back to that player: there is no owner
/// withdrawal, no upgrade path and no arbitrary transfer. The treasury only ever receives the
/// takeout and rounding dust, which the contract accounts for itself.
///
/// Lifecycle of one race market:
///  1. OPERATOR `createMarket` when the field locks, with the race's seed commitment
///     (sha256 of the 32-byte server seed, the engine's `commitSeed`). Write-once.
///  2. Players `bet` with a short-lived, single-use EIP-712 BetPermit from PERMIT_SIGNER (the
///     server's off-chain checks: conflicts of interest, linked accounts, limits, self-exclusion,
///     age and location). Bets close CLOSE_MARGIN before `closeTime`. Bets can't be cancelled.
///  3. After `closeTime` anyone calls `lockEntropy` (picks a FUTURE block) and then
///     `sealEntropy` (stores that block's hash). The race runs on
///     finalSeed = sha256(serverSeed ‖ entropy), unknown to everyone until betting has closed.
///  4. OPERATOR `postResult` with the revealed server seed (checked against the commitment) and
///     each runner's finishing position (0 = non-runner; equal positions = dead heat). A
///     CHALLENGE_WINDOW opens in which GUARDIAN can `correctResult` or `voidMarket`.
///  5. After the window anyone calls `finalize` (the pari-mutuel split, same rules as game-core
///     tote.ts) and each player `claim`s (pull payments). Void markets refund every stake.
///  6. A market with no result within MAX_SETTLE_DELAY of `closeTime` can be expired by anyone:
///     every stake becomes refundable. Funds can never get stuck.
contract TotePools is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- roles

    /// @notice Creates markets, posts results, cancels a market before its entropy is sealed.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    /// @notice Server keys that sign BetPermits. Rotate by grant + revoke.
    bytes32 public constant PERMIT_SIGNER_ROLE = keccak256("PERMIT_SIGNER_ROLE");
    /// @notice Corrects or voids a posted result during the challenge window (a multisig).
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ---------------------------------------------------------------- constants

    uint16 public constant BPS = 10_000;
    /// @notice Hard cap on a market's takeout (25 %).
    uint16 public constant MAX_TAKEOUT_BPS = 2_500;
    uint8 public constant MAX_RUNNERS = 24;
    /// @notice A place pool needs this many runners that ran (game-core TOTE_PLACE_MIN_FIELD).
    uint8 public constant PLACE_MIN_FIELD = 5;
    /// @notice From this many runners the place pool pays three places (TOTE_PLACE_THREE_FROM).
    uint8 public constant PLACE_THREE_FROM = 8;
    /// @notice No BetPermit may be valid for longer than this.
    uint64 public constant MAX_PERMIT_TTL = 10 minutes;
    /// @notice A market can't be created further ahead than this.
    uint64 public constant MAX_MARKET_LEAD = 7 days;
    /// @notice lcm(1..24): every dead-heat share is a whole multiple of 1/DEAD_HEAT_DENOM.
    uint256 public constant DEAD_HEAT_DENOM = 5_354_228_880;

    bytes32 public constant BET_PERMIT_TYPEHASH =
        keccak256("BetPermit(address bettor,bytes32 raceId,uint256 maxAmount,uint256 nonce,uint64 expiry)");

    bytes32 public constant VOID_GUARDIAN = "guardian";
    bytes32 public constant VOID_CANCELLED = "cancelled";
    bytes32 public constant VOID_EXPIRED = "expired";
    bytes32 public constant VOID_ENTROPY_MISSED = "entropy_missed";

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
        uint64 entropyBlock;
        uint16 takeoutBps;
        uint8 runnerCount;
        uint8 placeTerms;
        Status status;
        uint128 maxPool;
        bytes32 seedCommitment;
        bytes32 entropy;
        bytes32 revealedSeed;
        bytes32 finalSeed;
        /// @dev byte i (little-endian) = finishing position of runner i; 0 = non-runner.
        bytes32 positions;
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
        uint256 maxAmount; // this bet may be at most this much
        uint256 nonce; // single-use per bettor
        uint64 expiry; // unix seconds, at most MAX_PERMIT_TTL ahead
    }

    // ---------------------------------------------------------------- immutables

    IERC20 public immutable token;
    /// @notice Bets are refused from closeTime - CLOSE_MARGIN (covers sequencer timestamp drift).
    uint64 public immutable CLOSE_MARGIN;
    uint64 public immutable CHALLENGE_WINDOW;
    uint64 public immutable MAX_SETTLE_DELAY;
    /// @notice lockEntropy targets the block this many L2 blocks ahead.
    uint64 public immutable ENTROPY_DELAY_BLOCKS;
    /// @notice The ArbSys precompile, or address(0) to use the EVM's own block number and hash
    /// (local test networks and non-Arbitrum chains).
    address public immutable arbSys;

    // ---------------------------------------------------------------- storage

    address public treasury;
    /// @notice Takeout and rounding dust owed to the treasury (never player stakes).
    uint256 public treasuryOwed;
    uint128 public minStake;
    uint128 public maxStakePerBet;
    uint128 public maxStakePerWalletPerRace;

    mapping(bytes32 raceId => Market) private _markets;
    mapping(bytes32 raceId => mapping(uint8 pool => PoolState)) private _pools;
    /// @dev key = pool * 32 + runner
    mapping(bytes32 raceId => mapping(uint256 key => uint128)) private _runnerStake;
    mapping(bytes32 raceId => mapping(uint256 key => uint128)) private _runnerShare;
    mapping(bytes32 raceId => mapping(address wallet => mapping(uint256 key => uint128))) private _stakeOf;
    /// @dev bit `key` set when the wallet holds a stake on that (pool, runner)
    mapping(bytes32 raceId => mapping(address wallet => uint64)) private _walletKeys;
    mapping(bytes32 raceId => mapping(address wallet => uint128)) public walletTotal;
    mapping(bytes32 raceId => mapping(address wallet => bool)) public claimed;
    mapping(address bettor => mapping(uint256 nonce => bool)) public nonceUsed;

    // ---------------------------------------------------------------- events

    event MarketCreated(
        bytes32 indexed raceId, uint64 closeTime, uint8 runnerCount, uint8 placeTerms, bytes32 seedCommitment, uint16 takeoutBps, uint128 maxPool
    );
    event BetPlaced(
        bytes32 indexed raceId, address indexed bettor, uint8 pool, uint8 runner, uint256 amount, uint256 indexed nonce, uint256 poolTotal, uint256 runnerTotal
    );
    event EntropyLocked(bytes32 indexed raceId, uint64 entropyBlock);
    event EntropySealed(bytes32 indexed raceId, uint64 entropyBlock, bytes32 entropy);
    event ResultPosted(bytes32 indexed raceId, bytes32 revealedSeed, bytes32 finalSeed, bytes32 positions, uint64 challengeEnd);
    event ResultCorrected(bytes32 indexed raceId, bytes32 oldPositions, bytes32 newPositions);
    event MarketFinalized(bytes32 indexed raceId, uint256 winTotal, uint256 placeTotal, uint256 toTreasury);
    event MarketVoided(bytes32 indexed raceId, bytes32 reason);
    event Claimed(bytes32 indexed raceId, address indexed bettor, address to, uint256 amount);
    event DustSwept(bytes32 indexed raceId, uint8 pool, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event StakeLimitsSet(uint128 minStake, uint128 maxStakePerBet, uint128 maxStakePerWalletPerRace);

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error BadConfig();
    error MarketExists(bytes32 raceId);
    error BadMarket();
    error MarketNotOpen(bytes32 raceId);
    error BettingClosed(uint64 closesAt);
    error BadRunner(uint8 runner);
    error NoPlacePool();
    error NotPermitBettor(address expected, address actual);
    error PermitRaceMismatch();
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
    error EntropyNotReady(uint64 entropyBlock);
    error EntropyAlreadySealed();
    error EntropyNotSealed();
    error SeedMismatch();
    error BadPositions();
    error ResultTooLate();
    error NotResultPosted(bytes32 raceId);
    error ChallengeWindowOver(uint64 challengeEnd);
    error ChallengeWindowOpen(uint64 challengeEnd);
    error NotVoidable();
    error NotExpired(uint64 expiresAt);
    error NotClaimable(bytes32 raceId);
    error AlreadyClaimed();
    error NothingToClaim();

    constructor(
        address admin,
        address operator,
        address permitSigner,
        address guardian,
        address treasury_,
        address token_,
        address arbSys_,
        uint64 closeMargin,
        uint64 challengeWindow,
        uint64 maxSettleDelay,
        uint64 entropyDelayBlocks
    ) EIP712("PostTimeTotePools", "1") {
        if (
            admin == address(0) || operator == address(0) || permitSigner == address(0) || guardian == address(0) || treasury_ == address(0)
                || token_ == address(0)
        ) revert ZeroAddress();
        if (
            closeMargin == 0 || closeMargin > 1 hours || challengeWindow < 10 minutes || challengeWindow > 7 days || maxSettleDelay < challengeWindow
                || maxSettleDelay > 30 days || entropyDelayBlocks == 0 || entropyDelayBlocks > 64
        ) revert BadConfig();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(PERMIT_SIGNER_ROLE, permitSigner);
        _grantRole(GUARDIAN_ROLE, guardian);
        token = IERC20(token_);
        arbSys = arbSys_;
        CLOSE_MARGIN = closeMargin;
        CHALLENGE_WINDOW = challengeWindow;
        MAX_SETTLE_DELAY = maxSettleDelay;
        ENTROPY_DELAY_BLOCKS = entropyDelayBlocks;
        treasury = treasury_;
        emit TreasurySet(address(0), treasury_);
        // USDG has 6 decimals: 1 USDG minimum, 100 per bet, 250 per wallet per race until set.
        _setStakeLimits(1e6, 100e6, 250e6);
    }

    // ---------------------------------------------------------------- markets

    /// @notice Opens a race market. The seed commitment is fixed here, before any bet, forever.
    function createMarket(
        bytes32 raceId,
        uint64 closeTime,
        uint8 runnerCount,
        uint8 placeTerms,
        bytes32 seedCommitment,
        uint16 takeoutBps,
        uint128 maxPool
    ) external onlyRole(OPERATOR_ROLE) {
        if (_markets[raceId].status != Status.None) revert MarketExists(raceId);
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
        m.seedCommitment = seedCommitment;
        m.status = Status.Open;
        emit MarketCreated(raceId, closeTime, runnerCount, placeTerms, seedCommitment, takeoutBps, maxPool);
    }

    /// @notice Places a bet. The bettor must have approved `amount` of the token. Bets are final.
    function bet(bytes32 raceId, uint8 runner, Pool pool, uint256 amount, BetPermit calldata permit, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
    {
        _checkPermit(raceId, amount, permit, signature);
        nonceUsed[msg.sender][permit.nonce] = true;
        (uint256 pTotal, uint256 rTotal) = _recordBet(raceId, runner, uint8(pool), amount);

        // Interaction: pull the stake and check exactly that much arrived.
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received != amount) revert UnexpectedAmountReceived(amount, received);
        emit BetPlaced(raceId, msg.sender, uint8(pool), runner, amount, permit.nonce, pTotal, rTotal);
    }

    /// @dev Market, timing and cap checks, then the bookkeeping (before any token call).
    function _recordBet(bytes32 raceId, uint8 runner, uint8 pool, uint256 amount) private returns (uint256 pTotal, uint256 rTotal) {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (block.timestamp + CLOSE_MARGIN >= m.closeTime) revert BettingClosed(m.closeTime - CLOSE_MARGIN);
        if (runner >= m.runnerCount) revert BadRunner(runner);
        if (pool == uint8(Pool.PLACE) && m.placeTerms == 0) revert NoPlacePool();
        if (amount < minStake) revert StakeBelowMin(amount, minStake);
        if (amount > maxStakePerBet) revert StakeAboveMax(amount, maxStakePerBet);
        uint256 wTotal = walletTotal[raceId][msg.sender] + amount;
        if (wTotal > maxStakePerWalletPerRace) revert WalletCapExceeded(wTotal, maxStakePerWalletPerRace);
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
    }

    // ---------------------------------------------------------------- entropy

    /// @notice After closeTime anyone fixes the entropy block: ENTROPY_DELAY_BLOCKS ahead, so its
    /// hash does not exist yet and the caller can't pick it.
    function lockEntropy(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (block.timestamp < m.closeTime) revert EntropyTooEarly(m.closeTime);
        if (m.entropyBlock != 0) revert EntropyAlreadyLocked();
        uint64 target = uint64(_currentBlock()) + ENTROPY_DELAY_BLOCKS;
        m.entropyBlock = target;
        emit EntropyLocked(raceId, target);
    }

    /// @notice Anyone stores the entropy block's hash once it exists. If nobody sealed it while
    /// the hash was still readable (256 blocks), the market is void and every stake refundable:
    /// re-picking a block would let whoever knows the server seed choose an outcome.
    function sealEntropy(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        if (m.entropyBlock == 0) revert EntropyNotLocked();
        if (m.entropy != bytes32(0)) revert EntropyAlreadySealed();
        if (_currentBlock() <= m.entropyBlock) revert EntropyNotReady(m.entropyBlock);
        bytes32 h = _blockHash(m.entropyBlock);
        if (h == bytes32(0)) {
            _void(raceId, VOID_ENTROPY_MISSED);
            return;
        }
        m.entropy = h;
        emit EntropySealed(raceId, m.entropyBlock, h);
    }

    // ---------------------------------------------------------------- results

    /// @notice Posts the result: the revealed server seed (must match the commitment) and each
    /// runner's finishing position (0 = non-runner; equal positions = dead heat). Opens the
    /// challenge window.
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
        emit ResultPosted(raceId, revealedSeed, finalSeed, packed, end);
    }

    /// @notice GUARDIAN replaces the posted positions, only during the challenge window.
    function correctResult(bytes32 raceId, uint8[] calldata positions) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.ResultPosted) revert NotResultPosted(raceId);
        if (block.timestamp >= m.challengeEnd) revert ChallengeWindowOver(m.challengeEnd);
        bytes32 packed = _packPositions(m.runnerCount, positions);
        emit ResultCorrected(raceId, m.positions, packed);
        m.positions = packed;
    }

    /// @notice GUARDIAN voids a market (every stake refundable): any time before a result, or
    /// during the challenge window after one.
    function voidMarket(bytes32 raceId) external onlyRole(GUARDIAN_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status == Status.ResultPosted) {
            if (block.timestamp >= m.challengeEnd) revert ChallengeWindowOver(m.challengeEnd);
        } else if (m.status != Status.Open) {
            revert NotVoidable();
        }
        _void(raceId, VOID_GUARDIAN);
    }

    /// @notice OPERATOR calls off a market (race abandoned, field problem) only while nobody can
    /// know the outcome yet: before the entropy is sealed.
    function cancelMarket(bytes32 raceId) external onlyRole(OPERATOR_ROLE) {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open || m.entropy != bytes32(0)) revert NotVoidable();
        _void(raceId, VOID_CANCELLED);
    }

    /// @notice Anyone: a market with no result MAX_SETTLE_DELAY after closeTime is void.
    function expireMarket(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.Open) revert MarketNotOpen(raceId);
        uint64 expiresAt = m.closeTime + MAX_SETTLE_DELAY;
        if (block.timestamp <= expiresAt) revert NotExpired(expiresAt);
        _void(raceId, VOID_EXPIRED);
    }

    /// @notice Anyone, after the challenge window: the pari-mutuel split. No token moves here.
    function finalize(bytes32 raceId) external {
        Market storage m = _markets[raceId];
        if (m.status != Status.ResultPosted) revert NotResultPosted(raceId);
        if (block.timestamp < m.challengeEnd) revert ChallengeWindowOpen(m.challengeEnd);
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
        treasuryOwed += toTreasury;
        emit MarketFinalized(raceId, _pools[raceId][0].total, _pools[raceId][1].total, toTreasury);
    }

    // ---------------------------------------------------------------- claims

    /// @notice Pays out everything the caller is owed on this race (winnings, refunds for
    /// non-runners, void markets) to `to`. Once per wallet per race. Never blocked by pause.
    function claim(bytes32 raceId, address to) external nonReentrant returns (uint256 amount) {
        if (to == address(0)) revert ZeroAddress();
        Status s = _markets[raceId].status;
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
                treasuryOwed += dust;
                emit DustSwept(raceId, p, dust);
            }
        }
        // Interaction
        if (amount > 0) token.safeTransfer(to, amount);
        emit Claimed(raceId, msg.sender, to, amount);
    }

    /// @notice Anyone: sends the accrued takeout and dust to the treasury. Never player funds.
    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryOwed;
        treasuryOwed = 0;
        if (amount > 0) token.safeTransfer(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
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
        return _hashTypedDataV4(keccak256(abi.encode(BET_PERMIT_TYPEHASH, p.bettor, p.raceId, p.maxAmount, p.nonce, p.expiry)));
    }

    /// @notice finalSeed = sha256(serverSeed ‖ entropy), the seed the race runs on.
    function finalSeedOf(bytes32 serverSeed, bytes32 entropy) external pure returns (bytes32) {
        return sha256(abi.encodePacked(serverSeed, entropy));
    }

    /// @notice Paying places of the place pool for `ran` runners (game-core totePlaces).
    function placesFor(uint256 ran) external pure returns (uint256) {
        return _placesFor(ran);
    }

    // ---------------------------------------------------------------- admin

    function setStakeLimits(uint128 min_, uint128 perBet, uint128 perWalletPerRace) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setStakeLimits(min_, perBet, perWalletPerRace);
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Stops new bets only. Entropy, results, refunds and claims keep working.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- internals

    function _setStakeLimits(uint128 min_, uint128 perBet, uint128 perWalletPerRace) private {
        if (min_ == 0 || perBet < min_ || perWalletPerRace < perBet) revert BadConfig();
        minStake = min_;
        maxStakePerBet = perBet;
        maxStakePerWalletPerRace = perWalletPerRace;
        emit StakeLimitsSet(min_, perBet, perWalletPerRace);
    }

    function _checkPermit(bytes32 raceId, uint256 amount, BetPermit calldata permit, bytes calldata signature) private view {
        if (permit.bettor != msg.sender) revert NotPermitBettor(permit.bettor, msg.sender);
        if (permit.raceId != raceId) revert PermitRaceMismatch();
        if (block.timestamp > permit.expiry) revert PermitExpired(permit.expiry);
        if (permit.expiry > block.timestamp + MAX_PERMIT_TTL) revert PermitTtlTooLong(permit.expiry);
        if (nonceUsed[msg.sender][permit.nonce]) revert NonceUsed(permit.nonce);
        if (amount > permit.maxAmount) revert AboveMaxAmount(amount, permit.maxAmount);
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashBetPermit(permit), signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(PERMIT_SIGNER_ROLE, signer)) revert InvalidSignature();
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

    /// @dev Settles one pool (game-core settleTotePool): returns what goes to the treasury now
    /// (takeout plus the rounding left between the net pool and the runners' shares).
    function _settlePool(bytes32 raceId, uint8 pool, uint256 places, uint256[MAX_RUNNERS + 1] memory tie) private returns (uint256) {
        PoolState storage ps = _pools[raceId][pool];
        if (ps.total == 0) return 0;
        if (places == 0) {
            ps.mode = PoolMode.RefundAll; // no place pool for this field: every stake back
            return 0;
        }
        (uint256[MAX_RUNNERS] memory weight, uint256 w, uint256 live) = _weights(raceId, pool, places, tie);
        if (live == 0) {
            ps.mode = PoolMode.RefundAll; // only non-runner stakes: all refunded in full
            return 0;
        }
        uint256 take = (live * _markets[raceId].takeoutBps) / BPS;
        uint256 net = live - take;
        if (w == 0) {
            ps.mode = PoolMode.NoWinner; // nobody backed a paying runner: net pool back pro rata
            ps.toPay = uint128(net);
            ps.entitledStake = uint128(live);
            return take;
        }
        (uint256 shared, uint256 entitled) = _assignShares(raceId, pool, weight, w, net);
        ps.mode = PoolMode.Winners;
        ps.toPay = uint128(shared);
        ps.entitledStake = uint128(entitled);
        return take + (net - shared);
    }

    /// @dev Each backed paying runner's part of the net pool, rounded down.
    function _assignShares(bytes32 raceId, uint8 pool, uint256[MAX_RUNNERS] memory weight, uint256 w, uint256 net)
        private
        returns (uint256 shared, uint256 entitled)
    {
        for (uint8 r = 0; r < MAX_RUNNERS; r++) {
            if (weight[r] == 0) continue;
            uint256 key = _key(pool, r);
            uint256 a = (net * weight[r]) / w;
            _runnerShare[raceId][key] = uint128(a);
            shared += a;
            entitled += _runnerStake[raceId][key];
        }
    }

    /// @dev Dead-heat weights of the backed paying runners: k runners tied at position p cover
    /// places p..p+k-1, and each takes the paying ones among them divided by k.
    function _weights(bytes32 raceId, uint8 pool, uint256 places, uint256[MAX_RUNNERS + 1] memory tie)
        private
        view
        returns (uint256[MAX_RUNNERS] memory weight, uint256 w, uint256 live)
    {
        Market storage m = _markets[raceId];
        bytes32 packed = m.positions;
        uint8 n = m.runnerCount;
        for (uint8 r = 0; r < n; r++) {
            uint256 p = _positionOf(packed, r);
            if (p == 0) continue;
            uint256 s = _runnerStake[raceId][_key(pool, r)];
            live += s;
            if (s == 0 || p > places) continue;
            uint256 last = p + tie[p] - 1;
            uint256 covered = (last < places ? last : places) - p + 1;
            weight[r] = (covered * DEAD_HEAT_DENOM) / tie[p];
            w += weight[r];
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

    /// @dev What a finalized stake `s` on (pool, runner) `key` gets: a full refund (no pool, or a
    /// non-runner), a share of its runner's dividend, a pro-rata part of a no-winner pool, or nothing.
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

    function _blockHash(uint256 n) private view returns (bytes32) {
        if (arbSys == address(0)) return blockhash(n);
        try IArbSysBlocks(arbSys).arbBlockHash(n) returns (bytes32 h) {
            return h;
        } catch {
            return bytes32(0);
        }
    }
}
