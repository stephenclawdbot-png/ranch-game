// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

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
contract PremiumStore is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant PRICE_MANAGER_ROLE = keccak256("PRICE_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");
    /// @notice Keys allowed to sign Order vouchers (the game server). Rotate by grant + revoke.
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint32 public constant MAX_QUANTITY = 100;

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

    constructor(address admin, address treasury_, address signer) EIP712("ThoroughbredPremiumStore", "1") {
        if (admin == address(0) || treasury_ == address(0) || signer == address(0)) revert ZeroAddress();
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

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
