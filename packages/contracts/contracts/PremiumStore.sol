// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @dev Chainlink AggregatorV3Interface (the subset we read). Robinhood Chain documents
/// Chainlink as its price oracle (docs.robinhood.com/chain/oracles-and-price-feeds).
interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @dev The part of PrizePool the store uses.
interface IPrizePool {
    function fund(bytes32 ref) external payable;
}

/// @title PremiumStore
/// @notice One-way checkout for Project Thoroughbred premium SKUs (premium pack, season pass,
/// cosmetics, entry refill), paid in an allow-listed ERC20 (a 6-decimal stablecoin such as
/// USDG/USDC; optionally the game token later).
///
/// Economy rules this contract enforces by construction (docs/game-design.md section 8, docs/web3.md):
///  - Money only flows IN from buyers and OUT to the studio treasury. There is no user balance,
///    no refund-to-user path and no payout of any kind: Stable Credits are never cashed out.
///  - Each purchase is authorised by a server-signed EIP-712 Order voucher bound to the buyer,
///    the SKU, the quantity, the token, a max total and a deadline. The server enforces off-chain
///    rules before signing (weekly Premium Pack cap, geo-blocking of paid packs, account checks).
///  - `orderId` is single-use: a replayed or front-run order reverts, so it can be fulfilled
///    at most once. The server fulfils off-chain only after verifying the Purchased event.
///  - Tokens with transfer fees or rebasing are rejected (received amount must equal the price).
///
/// Native ETH path (closed beta, docs/web3.md "Beta money flow"): the server signs an EthQuote
/// with the exact price in wei, computed off-chain from a USD price (median of public spot
/// prices) and valid for at most MAX_QUOTE_TTL. The buyer pays exactly `priceWei`; `poolBps`
/// of it goes to the PrizePool (immutable address) in the same transaction, the rest to the
/// treasury. If the treasury refuses ETH, the share is kept here and `withdrawEth` sends it
/// to the treasury later; no ETH is ever stuck and none can go anywhere else.
///
/// Affiliates (2 levels): a quote may name the buyer's inviter (level 1) and the inviter's
/// inviter (level 2) with commission bps, bounded on-chain by `maxRef1Bps` / `maxRef2Bps`
/// (hard caps 15% / 5%). Commissions come out of the TREASURY's share; the pool's share is
/// never touched. Each referrer is paid in the same tx with a gas-limited call; if that fails
/// the amount is credited to `referralOwed` and the referrer pulls it with `withdrawReferral`.
/// The server decides eligibility (verified wallet, 3-month window, weekly cap, linked
/// accounts) when signing; an ineligible referrer is simply left out (share stays with the
/// treasury).
contract PremiumStore is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant PRICE_MANAGER_ROLE = keccak256("PRICE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    /// @notice Keys allowed to sign Order vouchers (the game server). Rotate by grant + revoke.
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint32 public constant MAX_QUANTITY = 100;
    uint16 public constant BPS = 10_000;
    /// @notice Bounds for the Prize Pool share of each ETH sale.
    uint16 public constant MIN_POOL_BPS = 1_000;
    uint16 public constant MAX_POOL_BPS = 5_000;
    /// @notice A quote may not be valid for longer than this (the server uses 5 minutes).
    uint64 public constant MAX_QUOTE_TTL = 10 minutes;
    /// @notice Hard caps for affiliate commissions (bps of the sale).
    uint16 public constant REF1_BPS_CAP = 1_500;
    uint16 public constant REF2_BPS_CAP = 500;
    /// @notice Gas forwarded to a referrer on the instant payment (EOAs and smart wallets).
    uint256 public constant REFERRAL_CALL_GAS = 60_000;

    bytes32 public constant ETH_QUOTE_TYPEHASH = keccak256(
        "EthQuote(bytes32 orderId,address buyer,bytes32 sku,uint32 quantity,uint256 priceWei,uint64 usdCents,address ref1,uint16 ref1Bps,address ref2,uint16 ref2Bps,uint64 deadline)"
    );

    struct EthQuote {
        bytes32 orderId; // server-generated, single-use (shared namespace with Order)
        address buyer; // must be msg.sender
        bytes32 sku;
        uint32 quantity;
        uint256 priceWei; // exact total; msg.value must equal it
        uint64 usdCents; // the USD price the quote was computed from (checked only if a feed is set)
        address ref1; // level-1 referrer (the buyer's inviter) or address(0)
        uint16 ref1Bps;
        address ref2; // level-2 referrer (the inviter's inviter) or address(0)
        uint16 ref2Bps;
        uint64 deadline; // unix seconds, at most MAX_QUOTE_TTL ahead
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(bytes32 orderId,address buyer,bytes32 sku,uint32 quantity,address token,uint256 maxTotal,uint64 deadline)"
    );

    struct Order {
        bytes32 orderId; // server-generated, unique per checkout (idempotency key)
        address buyer; // must be msg.sender
        bytes32 sku; // keccak256(utf8(skuName)), e.g. keccak256("premium_pack")
        uint32 quantity;
        address token; // payment token
        uint256 maxTotal; // buyer protection against a concurrent price change
        uint64 deadline; // unix seconds
    }

    address public treasury;
    /// @notice Receives `poolBps` of every ETH sale. Immutable: the operator cannot redirect it.
    IPrizePool public immutable prizePool;
    uint16 public poolBps;
    /// @notice Treasury share kept here because the treasury refused a direct transfer.
    uint256 public pendingTreasuryWei;
    /// @notice OPTIONAL hardening (off by default): an ETH/USD Chainlink feed. When set, the
    /// quote's implied price must be within `maxPriceDeviationBps` of the feed and the feed
    /// must have updated within `maxFeedAge`.
    IPriceFeed public priceFeed;
    uint16 public maxPriceDeviationBps;
    uint32 public maxFeedAge;
    /// @notice Current commission ceilings (admin, within REF1_BPS_CAP / REF2_BPS_CAP).
    uint16 public maxRef1Bps;
    uint16 public maxRef2Bps;
    /// @notice Commissions whose instant payment failed, claimable by the referrer.
    mapping(address referrer => uint256) public referralOwed;
    mapping(address token => bool) public acceptedToken;
    mapping(bytes32 sku => bool) public skuActive;
    /// @notice Unit price in the token's smallest unit. 0 = SKU not sold in that token.
    mapping(bytes32 sku => mapping(address token => uint256)) public priceOf;
    /// @notice Buyer of a fulfilled order; address(0) = order id unused.
    mapping(bytes32 orderId => address) public orderBuyer;

    event Purchased(
        bytes32 indexed orderId,
        address indexed buyer,
        bytes32 indexed sku,
        address token,
        uint32 quantity,
        uint256 unitPrice,
        uint256 total
    );
    event PriceSet(bytes32 indexed sku, address indexed token, uint256 oldPrice, uint256 newPrice);
    event SkuStatusSet(bytes32 indexed sku, bool active);
    event TokenAcceptedSet(address indexed token, bool accepted);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event PurchasedWithEth(
        bytes32 indexed orderId,
        address indexed buyer,
        bytes32 indexed sku,
        uint32 quantity,
        uint256 priceWei,
        uint256 poolShare,
        uint256 treasuryShare
    );
    event PoolBpsSet(uint16 oldBps, uint16 newBps);
    event TreasuryTransferDeferred(address indexed treasury, uint256 amount);
    event EthWithdrawn(address indexed to, uint256 amount);
    event ReferralCommission(bytes32 indexed orderId, address indexed referrer, uint8 level, uint256 amount, bool deferred);
    event ReferralWithdrawn(address indexed referrer, uint256 amount);
    event ReferralBpsSet(uint16 maxRef1Bps, uint16 maxRef2Bps);
    event PriceFeedSet(address indexed feed, uint16 maxDeviationBps, uint32 maxAge);

    error ZeroAddress();
    error OrderAlreadyFulfilled(bytes32 orderId);
    error OrderExpired(uint64 deadline);
    error NotOrderBuyer(address expected, address actual);
    error InvalidSignature();
    error InvalidQuantity(uint32 quantity);
    error SkuInactive(bytes32 sku);
    error TokenNotAccepted(address token);
    error NotForSaleInToken(bytes32 sku, address token);
    error PriceAboveMax(uint256 total, uint256 maxTotal);
    error UnexpectedAmountReceived(uint256 expected, uint256 received);
    error QuoteTtlTooLong(uint64 deadline, uint64 maxDeadline);
    error WrongPayment(uint256 expected, uint256 sent);
    error ZeroPrice();
    error PoolBpsOutOfRange(uint16 bps);
    error TreasuryRefused(address treasury, uint256 amount);
    error PriceOffFeed(uint256 priceWei, uint256 feedWei);
    error StaleFeed(uint256 updatedAt);
    error InvalidFeedConfig();
    error InvalidReferral();
    error ReferralBpsOutOfRange(uint16 ref1Bps, uint16 ref2Bps);
    error NothingOwed();

    constructor(address admin, address treasury_, address signer, address prizePool_, uint16 poolBps_)
        EIP712("ThoroughbredPremiumStore", "1")
    {
        if (admin == address(0) || treasury_ == address(0) || signer == address(0) || prizePool_ == address(0)) {
            revert ZeroAddress();
        }
        if (poolBps_ < MIN_POOL_BPS || poolBps_ > MAX_POOL_BPS) revert PoolBpsOutOfRange(poolBps_);
        prizePool = IPrizePool(prizePool_);
        poolBps = poolBps_;
        emit PoolBpsSet(0, poolBps_);
        maxRef1Bps = 1_000;
        maxRef2Bps = 300;
        emit ReferralBpsSet(1_000, 300);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PRICE_MANAGER_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(TREASURER_ROLE, admin);
        _grantRole(SIGNER_ROLE, signer);
        treasury = treasury_;
        emit TreasurySet(address(0), treasury_);
    }

    // ---------------------------------------------------------------- checkout

    /// @notice Pay for a server-authorised order. The buyer must have approved `total` (or more)
    /// of `order.token` to this contract beforehand.
    function purchase(Order calldata order, bytes calldata signature)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 total)
    {
        // Checks
        if (order.buyer != msg.sender) revert NotOrderBuyer(order.buyer, msg.sender);
        if (block.timestamp > order.deadline) revert OrderExpired(order.deadline);
        if (orderBuyer[order.orderId] != address(0)) revert OrderAlreadyFulfilled(order.orderId);
        if (order.quantity == 0 || order.quantity > MAX_QUANTITY) revert InvalidQuantity(order.quantity);
        if (!skuActive[order.sku]) revert SkuInactive(order.sku);
        if (!acceptedToken[order.token]) revert TokenNotAccepted(order.token);
        uint256 unitPrice = priceOf[order.sku][order.token];
        if (unitPrice == 0) revert NotForSaleInToken(order.sku, order.token);
        total = unitPrice * order.quantity;
        if (total > order.maxTotal) revert PriceAboveMax(total, order.maxTotal);

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashOrder(order), signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(SIGNER_ROLE, signer)) revert InvalidSignature();

        // Effects (before the external call)
        orderBuyer[order.orderId] = msg.sender;

        // Interactions
        IERC20 token = IERC20(order.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received != total) revert UnexpectedAmountReceived(total, received);

        emit Purchased(order.orderId, msg.sender, order.sku, order.token, order.quantity, unitPrice, total);
    }

    /// @notice Pay for a server-quoted order in native ETH. `msg.value` must equal
    /// `quote.priceWei` exactly; `poolBps` of it is forwarded to the PrizePool in this tx.
    function purchaseWithEth(EthQuote calldata quote, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 poolShare)
    {
        // Checks
        if (quote.buyer != msg.sender) revert NotOrderBuyer(quote.buyer, msg.sender);
        if (block.timestamp > quote.deadline) revert OrderExpired(quote.deadline);
        if (quote.deadline > block.timestamp + MAX_QUOTE_TTL) {
            revert QuoteTtlTooLong(quote.deadline, uint64(block.timestamp + MAX_QUOTE_TTL));
        }
        if (orderBuyer[quote.orderId] != address(0)) revert OrderAlreadyFulfilled(quote.orderId);
        if (quote.quantity == 0 || quote.quantity > MAX_QUANTITY) revert InvalidQuantity(quote.quantity);
        if (!skuActive[quote.sku]) revert SkuInactive(quote.sku);
        if (quote.priceWei == 0) revert ZeroPrice();
        if (msg.value != quote.priceWei) revert WrongPayment(quote.priceWei, msg.value);
        if (address(priceFeed) != address(0)) _checkAgainstFeed(quote.priceWei, quote.usdCents);
        _checkReferrals(quote);

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashEthQuote(quote), signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(SIGNER_ROLE, signer)) revert InvalidSignature();

        // Effects
        orderBuyer[quote.orderId] = msg.sender;
        poolShare = (msg.value * poolBps) / BPS;
        uint256 ref1Share = (msg.value * quote.ref1Bps) / BPS;
        uint256 ref2Share = (msg.value * quote.ref2Bps) / BPS;
        uint256 treasuryShare = msg.value - poolShare - ref1Share - ref2Share;
        emit PurchasedWithEth(quote.orderId, msg.sender, quote.sku, quote.quantity, msg.value, poolShare, treasuryShare);

        // Interactions: the pool is our own contract (reverts bubble up and undo the sale).
        if (poolShare > 0) prizePool.fund{value: poolShare}(quote.orderId);
        if (ref1Share > 0) _payReferral(quote.orderId, quote.ref1, 1, ref1Share);
        if (ref2Share > 0) _payReferral(quote.orderId, quote.ref2, 2, ref2Share);
        if (treasuryShare > 0) {
            address to = treasury;
            (bool ok,) = to.call{value: treasuryShare}("");
            if (!ok) {
                pendingTreasuryWei += treasuryShare;
                emit TreasuryTransferDeferred(to, treasuryShare);
            }
        }
    }

    function _checkReferrals(EthQuote calldata q) private view {
        if (q.ref1Bps > maxRef1Bps || q.ref2Bps > maxRef2Bps) revert ReferralBpsOutOfRange(q.ref1Bps, q.ref2Bps);
        if (q.ref1 == address(0)) {
            if (q.ref1Bps != 0 || q.ref2 != address(0) || q.ref2Bps != 0) revert InvalidReferral();
            return;
        }
        if (q.ref1 == q.buyer || q.ref1 == q.ref2) revert InvalidReferral();
        if (q.ref2 == address(0)) {
            if (q.ref2Bps != 0) revert InvalidReferral();
        } else if (q.ref2 == q.buyer) {
            revert InvalidReferral();
        }
    }

    /// @dev Instant payment with bounded gas; on failure the referrer pulls it later.
    function _payReferral(bytes32 orderId, address to, uint8 level, uint256 amount) private {
        (bool ok,) = to.call{value: amount, gas: REFERRAL_CALL_GAS}("");
        if (!ok) referralOwed[to] += amount;
        emit ReferralCommission(orderId, to, level, amount, !ok);
    }

    /// @notice A referrer collects commissions whose instant payment failed.
    function withdrawReferral() external nonReentrant {
        uint256 amount = referralOwed[msg.sender];
        if (amount == 0) revert NothingOwed();
        referralOwed[msg.sender] = 0;
        emit ReferralWithdrawn(msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    /// @notice Commission ceilings, bounded by REF1_BPS_CAP (15%) and REF2_BPS_CAP (5%).
    function setReferralBps(uint16 ref1Bps, uint16 ref2Bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (ref1Bps > REF1_BPS_CAP || ref2Bps > REF2_BPS_CAP) revert ReferralBpsOutOfRange(ref1Bps, ref2Bps);
        maxRef1Bps = ref1Bps;
        maxRef2Bps = ref2Bps;
        emit ReferralBpsSet(ref1Bps, ref2Bps);
    }

    /// @notice EIP-712 digest of an EthQuote (what the server signs).
    function hashEthQuote(EthQuote calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ETH_QUOTE_TYPEHASH,
                    quote.orderId,
                    quote.buyer,
                    quote.sku,
                    quote.quantity,
                    quote.priceWei,
                    quote.usdCents,
                    quote.ref1,
                    quote.ref1Bps,
                    quote.ref2,
                    quote.ref2Bps,
                    quote.deadline
                )
            )
        );
    }

    /// @notice EIP-712 digest the server signs. Exposed so off-chain code can cross-check.
    function hashOrder(Order calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.orderId,
                    order.buyer,
                    order.sku,
                    order.quantity,
                    order.token,
                    order.maxTotal,
                    order.deadline
                )
            )
        );
    }

    function isFulfilled(bytes32 orderId) external view returns (bool) {
        return orderBuyer[orderId] != address(0);
    }

    // ---------------------------------------------------------------- catalogue admin

    function setPrice(bytes32 sku, address token, uint256 newPrice) external onlyRole(PRICE_MANAGER_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        uint256 old = priceOf[sku][token];
        priceOf[sku][token] = newPrice;
        emit PriceSet(sku, token, old, newPrice);
    }

    function setSkuActive(bytes32 sku, bool active) external onlyRole(PRICE_MANAGER_ROLE) {
        skuActive[sku] = active;
        emit SkuStatusSet(sku, active);
    }

    function setAcceptedToken(address token, bool accepted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        acceptedToken[token] = accepted;
        emit TokenAcceptedSet(token, accepted);
    }

    /// @notice Wei a feed implies for `usdCents` (answer has `decimals` decimals, USD per ETH).
    function _checkAgainstFeed(uint256 priceWei, uint64 usdCents) private view {
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (answer <= 0 || block.timestamp > updatedAt + maxFeedAge) revert StaleFeed(updatedAt);
        uint256 feedWei = (uint256(usdCents) * 10 ** (16 + uint256(priceFeed.decimals()))) / uint256(answer);
        uint256 diff = priceWei > feedWei ? priceWei - feedWei : feedWei - priceWei;
        if (diff * BPS > feedWei * maxPriceDeviationBps) revert PriceOffFeed(priceWei, feedWei);
    }

    /// @notice Enables (feed != 0) or disables (feed == 0) the optional on-chain price check.
    function setPriceFeed(address feed, uint16 maxDeviationBps, uint32 maxAge) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feed != address(0) && (maxDeviationBps == 0 || maxDeviationBps > 2_000 || maxAge == 0)) revert InvalidFeedConfig();
        priceFeed = IPriceFeed(feed);
        maxPriceDeviationBps = maxDeviationBps;
        maxFeedAge = maxAge;
        emit PriceFeedSet(feed, maxDeviationBps, maxAge);
    }

    /// @notice Prize Pool share of future ETH sales, bounded to [MIN_POOL_BPS, MAX_POOL_BPS].
    function setPoolBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps < MIN_POOL_BPS || newBps > MAX_POOL_BPS) revert PoolBpsOutOfRange(newBps);
        emit PoolBpsSet(poolBps, newBps);
        poolBps = newBps;
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    // ---------------------------------------------------------------- treasury & safety

    /// @notice Move proceeds to the configured treasury. Works while paused (fund rescue).
    /// The destination is fixed to `treasury`: there is no way to pay out to arbitrary users.
    function withdraw(address token, uint256 amount) external onlyRole(TREASURER_ROLE) nonReentrant {
        address to = treasury;
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    /// @notice Sends treasury shares that a refused direct transfer left here to the treasury.
    /// Anyone may call it: the destination is fixed. Works while paused.
    function withdrawEth() external nonReentrant {
        uint256 amount = pendingTreasuryWei;
        if (amount == 0) return;
        pendingTreasuryWei = 0;
        address to = treasury;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TreasuryRefused(to, amount); // the whole tx reverts: it stays pending
        emit EthWithdrawn(to, amount);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
