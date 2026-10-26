// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title PrizePool
/// @notice Closed-beta Prize Pool for Project Thoroughbred. It holds ETH that comes ONLY from
/// PremiumStore sales (a fixed share of every sale) and from operator top-ups, and pays it out
/// to players in weekly epochs by skill/leaderboard rank (computed off-chain, posted as a
/// Merkle root). Players claim their allocation themselves, vested linearly.
///
/// Why it cannot be drained (docs/web3.md "Beta money flow"):
///  - NO owner withdrawal. ETH leaves this contract only through `claim`, to the wallet named
///    in a posted leaf. There is no sweep, no arbitrary transfer and no upgradeability.
///  - It can never over-promise: an epoch's `total` must fit in the FREE balance
///    (`balance - outstanding`), and at most `maxEpochBps` of it per epoch. Claims of an epoch
///    can never exceed its total, whatever the root contains.
///  - Per-account ceiling per epoch (`maxClaimPerEpoch`, snapshotted at posting).
///  - Rate limit: at most one epoch per `minEpochInterval` (default 6 days).
///  - Linear vesting (e.g. 14 days) gives the admin time to cancel a bad root (`cancelEpoch`)
///    or revoke a cheating/inactive account (`revoke`). Both only return funds TO THE POOL.
///  - Allocations not claimed by the epoch's claim deadline return to the pool (`expireEpoch`,
///    callable by anyone).
///
/// Leaf = keccak256(keccak256(abi.encode(uint8 3, chainid, pool, epoch, account, amount,
/// vestStart, vestEnd))): double-hashed (second-preimage safe), kind-tagged, and bound to this
/// chain and this contract. The TS encoder lives in apps/web/src/lib/chain/pool.ts and
/// packages/contracts/adapter/prizePool.ts (parity-tested).
contract PrizePool is AccessControl, Pausable, ReentrancyGuard {
    /// @notice Posts epoch roots (the game server key and/or the owner wallet).
    bytes32 public constant POSTER_ROLE = keccak256("POSTER_ROLE");
    /// @notice Pauses claims and posting (incident response). Unpausing needs the admin.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice May add ETH to the pool (the PremiumStore, and the admin for top-ups).
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    uint8 public constant LEAF_KIND = 3;
    uint16 public constant BPS = 10_000;
    uint32 public constant MAX_EPOCH_INTERVAL = 30 days;
    uint32 public constant MIN_CLAIM_WINDOW = 1 hours;
    uint32 public constant MAX_CLAIM_WINDOW = 365 days;

    struct Epoch {
        bytes32 root;
        uint128 total; // ETH reserved for this epoch at posting
        uint128 claimed; // paid out so far
        uint128 returned; // given back to the pool (revocations, cancel, expiry)
        uint128 maxClaim; // per-account ceiling snapshotted at posting
        uint64 postedAt;
        uint64 claimDeadline; // after this, unclaimed funds can be returned to the pool
        bool closed; // cancelled or expired: no more claims
    }

    struct AccountClaim {
        uint128 claimed;
        uint128 cap; // only meaningful when revoked: the most this account may ever claim
        bool revoked;
    }

    /// @notice Sum of every open epoch's `total - claimed - returned`: ETH promised to players.
    uint256 public outstanding;
    uint64 public lastEpochId;
    uint64 public lastPostedAt;

    uint16 public maxEpochBps;
    uint32 public minEpochInterval;
    uint32 public claimWindow;
    uint128 public maxClaimPerEpoch;

    mapping(uint64 epochId => Epoch) private _epochs;
    mapping(uint64 epochId => mapping(address account => AccountClaim)) private _claims;

    event Funded(address indexed from, uint256 amount, bytes32 indexed ref);
    event EpochPosted(
        uint64 indexed epochId,
        bytes32 root,
        uint256 total,
        uint32 leafCount,
        uint64 claimDeadline,
        uint256 maxClaim,
        string manifestURI
    );
    event Claimed(uint64 indexed epochId, address indexed account, uint256 amount, uint256 totalClaimed);
    event Revoked(uint64 indexed epochId, address indexed account, uint256 returned, bool includeVested, bytes32 reason);
    event EpochCancelled(uint64 indexed epochId, uint256 returned, bytes32 reason);
    event EpochExpired(uint64 indexed epochId, uint256 returned);
    event ParamsSet(uint16 maxEpochBps, uint32 minEpochInterval, uint32 claimWindow, uint128 maxClaimPerEpoch);

    error ZeroAddress();
    error ZeroAmount();
    error DirectTransferRejected();
    error InvalidParams();
    error EpochOutOfOrder(uint64 expected, uint64 got);
    error EpochTooSoon(uint64 nextAllowedAt);
    error EmptyRoot();
    error EmptyEpoch();
    error OverAllocation(uint256 total, uint256 allowed);
    error UnknownEpoch(uint64 epochId);
    error EpochClosed(uint64 epochId);
    error ClaimWindowOver(uint64 claimDeadline);
    error ClaimWindowOpen(uint64 claimDeadline);
    error InvalidProof();
    error InvalidVesting();
    error AboveAccountCap(uint256 amount, uint256 cap);
    error NothingToClaim();
    error EpochExhausted();
    error AlreadyRevoked();

    constructor(address admin, uint128 maxClaimPerEpoch_) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(FUNDER_ROLE, admin);
        _setParams(5_000, 6 days, 56 days, maxClaimPerEpoch_);
    }

    // ---------------------------------------------------------------- money in

    /// @notice Adds ETH to the pool. Only the store (a share of each sale) and the admin.
    function fund(bytes32 ref) external payable onlyRole(FUNDER_ROLE) {
        if (msg.value == 0) revert ZeroAmount();
        emit Funded(msg.sender, msg.value, ref);
    }

    /// @dev Plain transfers are refused so every wei in the pool has a Funded event.
    receive() external payable {
        revert DirectTransferRejected();
    }

    /// @notice ETH not promised to any open epoch.
    function available() public view returns (uint256) {
        return address(this).balance - outstanding;
    }

    // ---------------------------------------------------------------- epochs

    /// @notice Posts the next weekly epoch. `total` must equal the sum of the leaves (checked
    /// off-chain); on-chain, claims can never exceed it and it must fit in the free balance.
    function postEpoch(uint64 epochId, bytes32 root, uint128 total, uint32 leafCount, string calldata manifestURI)
        external
        onlyRole(POSTER_ROLE)
        whenNotPaused
    {
        if (epochId != lastEpochId + 1) revert EpochOutOfOrder(lastEpochId + 1, epochId);
        if (lastEpochId != 0 && block.timestamp < uint256(lastPostedAt) + minEpochInterval) {
            revert EpochTooSoon(lastPostedAt + minEpochInterval);
        }
        if (root == bytes32(0)) revert EmptyRoot();
        if (total == 0 || leafCount == 0) revert EmptyEpoch();
        uint256 allowed = (available() * maxEpochBps) / BPS;
        if (total > allowed) revert OverAllocation(total, allowed);

        uint64 deadline = uint64(block.timestamp) + claimWindow;
        _epochs[epochId] = Epoch({
            root: root,
            total: total,
            claimed: 0,
            returned: 0,
            maxClaim: maxClaimPerEpoch,
            postedAt: uint64(block.timestamp),
            claimDeadline: deadline,
            closed: false
        });
        outstanding += total;
        lastEpochId = epochId;
        lastPostedAt = uint64(block.timestamp);
        emit EpochPosted(epochId, root, total, leafCount, deadline, maxClaimPerEpoch, manifestURI);
    }

    function getEpoch(uint64 epochId) external view returns (Epoch memory) {
        return _epochs[epochId];
    }

    function claimOf(uint64 epochId, address account) external view returns (AccountClaim memory) {
        return _claims[epochId][account];
    }

    function leafHash(uint64 epochId, address account, uint256 amount, uint64 vestStart, uint64 vestEnd)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            bytes.concat(
                keccak256(abi.encode(LEAF_KIND, block.chainid, address(this), epochId, account, amount, vestStart, vestEnd))
            )
        );
    }

    /// @notice Linear vesting: 0 before vestStart, all of it from vestEnd.
    function vestedAmount(uint256 amount, uint64 vestStart, uint64 vestEnd, uint256 at) public pure returns (uint256) {
        if (at >= vestEnd) return amount;
        if (at <= vestStart) return 0;
        return (amount * (at - vestStart)) / (vestEnd - vestStart);
    }

    /// @notice What `account` could claim right now for a leaf (0 for a bad leaf is not
    /// detected here; `claim` verifies the proof).
    function claimable(uint64 epochId, address account, uint256 amount, uint64 vestStart, uint64 vestEnd)
        public
        view
        returns (uint256)
    {
        Epoch storage e = _epochs[epochId];
        if (e.root == bytes32(0) || e.closed || block.timestamp > e.claimDeadline) return 0;
        AccountClaim storage c = _claims[epochId][account];
        uint256 entitled = vestedAmount(amount, vestStart, vestEnd, block.timestamp);
        if (c.revoked && entitled > c.cap) entitled = c.cap;
        return entitled > c.claimed ? entitled - c.claimed : 0;
    }

    /// @notice Claims the vested, unclaimed part of the caller's allocation in `epochId`.
    function claim(uint64 epochId, uint128 amount, uint64 vestStart, uint64 vestEnd, bytes32[] calldata proof)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 payout)
    {
        Epoch storage e = _epochs[epochId];
        _checkLeaf(e, epochId, msg.sender, amount, vestStart, vestEnd, proof);
        if (block.timestamp > e.claimDeadline) revert ClaimWindowOver(e.claimDeadline);

        AccountClaim storage c = _claims[epochId][msg.sender];
        uint256 entitled = vestedAmount(amount, vestStart, vestEnd, block.timestamp);
        if (c.revoked && entitled > c.cap) entitled = c.cap;
        if (entitled <= c.claimed) revert NothingToClaim();
        payout = entitled - c.claimed;
        // Hard cap: an epoch never pays more than it reserved (protects against a bad root).
        if (uint256(e.claimed) + e.returned + payout > e.total) revert EpochExhausted();

        // Effects
        c.claimed = uint128(entitled);
        e.claimed += uint128(payout);
        outstanding -= payout;
        emit Claimed(epochId, msg.sender, payout, entitled);

        // Interaction (last)
        Address.sendValue(payable(msg.sender), payout);
    }

    // ---------------------------------------------------------------- returns to the pool

    /// @notice Revokes one account's allocation (cheating, linked accounts, inactivity). The
    /// unclaimed amount goes back to the POOL, never to the admin. With `includeVested` false
    /// the account keeps what has vested so far.
    function revoke(
        uint64 epochId,
        address account,
        uint128 amount,
        uint64 vestStart,
        uint64 vestEnd,
        bytes32[] calldata proof,
        bool includeVested,
        bytes32 reason
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Epoch storage e = _epochs[epochId];
        _checkLeaf(e, epochId, account, amount, vestStart, vestEnd, proof);
        AccountClaim storage c = _claims[epochId][account];
        if (c.revoked) revert AlreadyRevoked();
        uint256 keep = c.claimed;
        if (!includeVested) {
            uint256 vested = vestedAmount(amount, vestStart, vestEnd, block.timestamp);
            if (vested > keep) keep = vested;
        }
        uint256 back = amount - keep;
        // Never return more than the epoch still holds.
        uint256 left = uint256(e.total) - e.claimed - e.returned;
        if (back > left) back = left;
        c.revoked = true;
        c.cap = uint128(keep);
        e.returned += uint128(back);
        outstanding -= back;
        emit Revoked(epochId, account, back, includeVested, reason);
    }

    /// @notice Cancels a whole epoch (e.g. a wrong or malicious root). Everything not yet
    /// claimed goes back to the pool.
    function cancelEpoch(uint64 epochId, bytes32 reason) external onlyRole(DEFAULT_ADMIN_ROLE) {
        uint256 back = _close(epochId);
        emit EpochCancelled(epochId, back, reason);
    }

    /// @notice After the claim deadline, anyone can return an epoch's unclaimed funds to the pool.
    function expireEpoch(uint64 epochId) external {
        Epoch storage e = _epochs[epochId];
        if (e.root != bytes32(0) && block.timestamp <= e.claimDeadline) revert ClaimWindowOpen(e.claimDeadline);
        uint256 back = _close(epochId);
        emit EpochExpired(epochId, back);
    }

    function _close(uint64 epochId) private returns (uint256 back) {
        Epoch storage e = _epochs[epochId];
        if (e.root == bytes32(0)) revert UnknownEpoch(epochId);
        if (e.closed) revert EpochClosed(epochId);
        back = uint256(e.total) - e.claimed - e.returned;
        e.closed = true;
        e.returned += uint128(back);
        outstanding -= back;
    }

    function _checkLeaf(
        Epoch storage e,
        uint64 epochId,
        address account,
        uint128 amount,
        uint64 vestStart,
        uint64 vestEnd,
        bytes32[] calldata proof
    ) private view {
        if (e.root == bytes32(0)) revert UnknownEpoch(epochId);
        if (e.closed) revert EpochClosed(epochId);
        if (vestEnd < vestStart) revert InvalidVesting();
        if (amount > e.maxClaim) revert AboveAccountCap(amount, e.maxClaim);
        if (!MerkleProof.verifyCalldata(proof, e.root, leafHash(epochId, account, amount, vestStart, vestEnd))) {
            revert InvalidProof();
        }
    }

    // ---------------------------------------------------------------- admin

    /// @notice Tunes the safety limits within hard bounds. Never moves funds.
    function setParams(uint16 maxEpochBps_, uint32 minEpochInterval_, uint32 claimWindow_, uint128 maxClaimPerEpoch_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setParams(maxEpochBps_, minEpochInterval_, claimWindow_, maxClaimPerEpoch_);
    }

    function _setParams(uint16 maxEpochBps_, uint32 minEpochInterval_, uint32 claimWindow_, uint128 maxClaimPerEpoch_) private {
        if (
            maxEpochBps_ == 0 || maxEpochBps_ > BPS || minEpochInterval_ > MAX_EPOCH_INTERVAL
                || claimWindow_ < MIN_CLAIM_WINDOW || claimWindow_ > MAX_CLAIM_WINDOW || maxClaimPerEpoch_ == 0
        ) revert InvalidParams();
        maxEpochBps = maxEpochBps_;
        minEpochInterval = minEpochInterval_;
        claimWindow = claimWindow_;
        maxClaimPerEpoch = maxClaimPerEpoch_;
        emit ParamsSet(maxEpochBps_, minEpochInterval_, claimWindow_, maxClaimPerEpoch_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
