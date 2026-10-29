// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title HorseMarket
/// @notice USDG payments for the Post Time horse market (docs/usdg-market.md). Horses are NOT
/// tokens: they live in the game database. This contract only carries the payment and a public
/// receipt (`Sold`, `Registered`); the game server moves the horse after verifying the event.
///
///  - `buy(SaleOrder, sig)`: the buyer pays `price` in one transaction: `price - fee` straight to
///    the seller, `fee` straight to the treasury. The contract NEVER holds funds: there are no
///    balances, no withdrawals, no refunds, and no function that moves tokens out of it.
///  - `register(RegistrationOrder, sig)`: the owner pays the registration fee straight to the
///    treasury (a sink that makes farming free-credit horses for cash unprofitable).
///  - Every order is signed by the game server (SIGNER_ROLE, EIP-712) only after its off-chain
///    checks (listing, both accounts, linked accounts, resale lock, price bounds). `orderId` is
///    single-use across both kinds, bound to `msg.sender`, and has a deadline.
///  - Tokens are allow-listed (USDG, 6 decimals) and every transfer is checked for the exact
///    amount received (fee-on-transfer / rebasing tokens are rejected).
///  - The marketplace fee is `feeBps` of the price (admin-set, hard cap 10 %); the signed fee must
///    match it within rounding (floor or ceiling).
contract HorseMarket is AccessControl, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @notice Keys allowed to sign orders (the game server). Rotate by grant + revoke.
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    uint16 public constant BPS = 10_000;
    /// @notice Hard cap on the marketplace fee: 10 %.
    uint16 public constant MAX_FEE_BPS = 1_000;
    /// @notice No order may be valid for longer than this (auction payment windows are 24 h).
    uint64 public constant MAX_ORDER_TTL = 4 days;

    bytes32 public constant SALE_ORDER_TYPEHASH = keccak256(
        "SaleOrder(bytes32 orderId,bytes32 horseRef,address seller,address buyer,address token,uint256 price,uint256 fee,uint64 deadline)"
    );
    bytes32 public constant REGISTRATION_ORDER_TYPEHASH =
        keccak256("RegistrationOrder(bytes32 orderId,bytes32 horseRef,address owner,address token,uint256 fee,uint64 deadline)");

    struct SaleOrder {
        bytes32 orderId; // server-generated, single-use (shared with RegistrationOrder)
        bytes32 horseRef; // keccak256("posttime:horse:<uuid>"): the game's horse id, hashed
        address seller; // receives price - fee
        address buyer; // must be msg.sender
        address token; // allow-listed stablecoin (USDG)
        uint256 price; // base units (USDG: 6 decimals)
        uint256 fee; // to the treasury; must match feeBps within rounding
        uint64 deadline; // unix seconds, at most MAX_ORDER_TTL ahead
    }

    struct RegistrationOrder {
        bytes32 orderId;
        bytes32 horseRef;
        address owner; // must be msg.sender
        address token;
        uint256 fee; // registration fee, all to the treasury
        uint64 deadline;
    }

    address public treasury;
    uint16 public feeBps;
    mapping(address token => bool) public acceptedToken;
    /// @notice Who paid an order; address(0) = order id unused.
    mapping(bytes32 orderId => address) public orderPayer;

    event Sold(bytes32 indexed orderId, bytes32 indexed horseRef, address indexed seller, address buyer, uint256 price, uint256 fee);
    event Registered(bytes32 indexed orderId, bytes32 indexed horseRef, address indexed owner, uint256 fee);
    event FeeBpsSet(uint16 oldBps, uint16 newBps);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event TokenAcceptedSet(address indexed token, bool accepted);

    error ZeroAddress();
    error OrderAlreadyUsed(bytes32 orderId);
    error OrderExpired(uint64 deadline);
    error OrderTtlTooLong(uint64 deadline, uint64 maxDeadline);
    error NotOrderBuyer(address expected, address actual);
    error InvalidSignature();
    error TokenNotAccepted(address token);
    error ZeroPrice();
    error FeeAbovePrice(uint256 fee, uint256 price);
    error FeeMismatch(uint256 fee, uint256 expectedFloor);
    error SelfTrade();
    error FeeBpsTooHigh(uint16 bps);
    error UnexpectedAmountReceived(uint256 expected, uint256 received);

    constructor(address admin, address treasury_, address signer, address token, uint16 feeBps_) EIP712("PostTimeHorseMarket", "1") {
        if (admin == address(0) || treasury_ == address(0) || signer == address(0) || token == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeBpsTooHigh(feeBps_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(SIGNER_ROLE, signer);
        treasury = treasury_;
        emit TreasurySet(address(0), treasury_);
        feeBps = feeBps_;
        emit FeeBpsSet(0, feeBps_);
        acceptedToken[token] = true;
        emit TokenAcceptedSet(token, true);
    }

    // ---------------------------------------------------------------- payments

    /// @notice Pays for a horse. The buyer must have approved `order.price` of `order.token` to
    /// this contract. `price - fee` goes to the seller and `fee` to the treasury, in this tx.
    function buy(SaleOrder calldata order, bytes calldata signature) external nonReentrant whenNotPaused {
        // Checks
        if (order.buyer != msg.sender) revert NotOrderBuyer(order.buyer, msg.sender);
        _checkWindow(order.orderId, order.deadline);
        if (!acceptedToken[order.token]) revert TokenNotAccepted(order.token);
        if (order.seller == address(0)) revert ZeroAddress();
        if (order.seller == order.buyer) revert SelfTrade();
        if (order.price == 0) revert ZeroPrice();
        if (order.fee > order.price) revert FeeAbovePrice(order.fee, order.price);
        uint256 floorFee = (order.price * feeBps) / BPS;
        uint256 ceilFee = (order.price * feeBps + BPS - 1) / BPS;
        if (order.fee != floorFee && order.fee != ceilFee) revert FeeMismatch(order.fee, floorFee);
        _checkSigner(hashSaleOrder(order), signature);

        // Effects (before any external call)
        orderPayer[order.orderId] = msg.sender;

        // Interactions: straight from the buyer to the seller and the treasury.
        IERC20 token = IERC20(order.token);
        _pay(token, msg.sender, order.seller, order.price - order.fee);
        _pay(token, msg.sender, treasury, order.fee);
        emit Sold(order.orderId, order.horseRef, order.seller, msg.sender, order.price, order.fee);
    }

    /// @notice Pays the registration fee for a horse joining the USDG market, straight to the treasury.
    function register(RegistrationOrder calldata order, bytes calldata signature) external nonReentrant whenNotPaused {
        if (order.owner != msg.sender) revert NotOrderBuyer(order.owner, msg.sender);
        _checkWindow(order.orderId, order.deadline);
        if (!acceptedToken[order.token]) revert TokenNotAccepted(order.token);
        if (order.fee == 0) revert ZeroPrice();
        _checkSigner(hashRegistrationOrder(order), signature);

        orderPayer[order.orderId] = msg.sender;

        _pay(IERC20(order.token), msg.sender, treasury, order.fee);
        emit Registered(order.orderId, order.horseRef, msg.sender, order.fee);
    }

    function _checkWindow(bytes32 orderId, uint64 deadline) private view {
        if (block.timestamp > deadline) revert OrderExpired(deadline);
        if (deadline > block.timestamp + MAX_ORDER_TTL) revert OrderTtlTooLong(deadline, uint64(block.timestamp + MAX_ORDER_TTL));
        if (orderPayer[orderId] != address(0)) revert OrderAlreadyUsed(orderId);
    }

    function _checkSigner(bytes32 digest, bytes calldata signature) private view {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || !hasRole(SIGNER_ROLE, signer)) revert InvalidSignature();
    }

    /// @dev transferFrom `from` -> `to`, then checks `to` received exactly `amount`.
    function _pay(IERC20 token, address from, address to, uint256 amount) private {
        if (amount == 0) return;
        uint256 before = token.balanceOf(to);
        token.safeTransferFrom(from, to, amount);
        uint256 received = token.balanceOf(to) - before;
        if (received != amount) revert UnexpectedAmountReceived(amount, received);
    }

    // ---------------------------------------------------------------- views

    /// @notice EIP-712 digest of a SaleOrder (what the server signs).
    function hashSaleOrder(SaleOrder calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(SALE_ORDER_TYPEHASH, o.orderId, o.horseRef, o.seller, o.buyer, o.token, o.price, o.fee, o.deadline))
        );
    }

    /// @notice EIP-712 digest of a RegistrationOrder.
    function hashRegistrationOrder(RegistrationOrder calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REGISTRATION_ORDER_TYPEHASH, o.orderId, o.horseRef, o.owner, o.token, o.fee, o.deadline)));
    }

    function isUsed(bytes32 orderId) external view returns (bool) {
        return orderPayer[orderId] != address(0);
    }

    // ---------------------------------------------------------------- admin

    /// @notice Marketplace fee for future sales, capped at MAX_FEE_BPS (10 %).
    function setFeeBps(uint16 newBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newBps > MAX_FEE_BPS) revert FeeBpsTooHigh(newBps);
        emit FeeBpsSet(feeBps, newBps);
        feeBps = newBps;
    }

    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasurySet(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setAcceptedToken(address token, bool accepted) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        acceptedToken[token] = accepted;
        emit TokenAcceptedSet(token, accepted);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
