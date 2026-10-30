import { keccak256, toBytes, type Address, type Hex, type TypedDataDefinition } from "viem";

// EIP-712 definitions for HorseMarket.sol (the USDG horse market, docs/usdg-market.md). MUST
// match the contract (EIP712("PostTimeHorseMarket", "1"), SALE_ORDER_TYPEHASH,
// REGISTRATION_ORDER_TYPEHASH, STUD_ORDER_TYPEHASH). test/horse-market.test.ts checks
// hashSaleOrder(), hashRegistrationOrder() and hashStudOrder() against viem's digests. apps/web/src/lib/chain/contracts.generated.ts
// carries a copy (scripts/export-web.ts; freshness tested in test/export-web.test.ts).
//
// `Bid` is never sent to the contract: the bidder's wallet signs it and the game server checks it
// (auctions settle without escrow). It shares the domain, so a bid signature is bound to this
// chain and this market and can't be replayed elsewhere.

export const MARKET_EIP712_NAME = "PostTimeHorseMarket";
export const MARKET_EIP712_VERSION = "1";

export const saleOrderTypes = {
  SaleOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "horseRef", type: "bytes32" },
    { name: "seller", type: "address" },
    { name: "buyer", type: "address" },
    { name: "token", type: "address" },
    { name: "price", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const registrationOrderTypes = {
  RegistrationOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "horseRef", type: "bytes32" },
    { name: "owner", type: "address" },
    { name: "token", type: "address" },
    { name: "fee", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

/** A registered stallion's USDG stud fee for one covering (HorseMarket.payStudFee). */
export const studOrderTypes = {
  StudOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "stallionRef", type: "bytes32" },
    { name: "mareRef", type: "bytes32" },
    { name: "stallionOwner", type: "address" },
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "price", type: "uint256" },
    { name: "fee", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const bidTypes = {
  Bid: [
    { name: "listingId", type: "string" },
    { name: "amount", type: "uint256" },
    { name: "bidder", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface SaleOrder {
  orderId: Hex;
  horseRef: Hex;
  seller: Address;
  buyer: Address;
  token: Address;
  /** Base units (USDG: 6 decimals). */
  price: bigint;
  fee: bigint;
  /** unix seconds; at most MAX_ORDER_TTL (4 days) ahead on-chain. */
  deadline: bigint;
}

export interface RegistrationOrder {
  orderId: Hex;
  horseRef: Hex;
  owner: Address;
  token: Address;
  fee: bigint;
  deadline: bigint;
}

export interface StudOrder {
  orderId: Hex;
  /** horseRef(stallion id) */
  stallionRef: Hex;
  /** horseRef(mare id) */
  mareRef: Hex;
  /** Receives price - fee. */
  stallionOwner: Address;
  /** The mare's owner: must be msg.sender. */
  payer: Address;
  token: Address;
  price: bigint;
  fee: bigint;
  deadline: bigint;
}

export interface Bid {
  /** The game's listing UUID, readable in the wallet prompt. */
  listingId: string;
  amount: bigint;
  bidder: Address;
  nonce: bigint;
}

const domain = (chainId: number, market: Address) => ({ name: MARKET_EIP712_NAME, version: MARKET_EIP712_VERSION, chainId, verifyingContract: market });

export function saleOrderTypedData(o: SaleOrder, chainId: number, market: Address): TypedDataDefinition<typeof saleOrderTypes, "SaleOrder"> {
  return { domain: domain(chainId, market), types: saleOrderTypes, primaryType: "SaleOrder", message: { ...o } };
}

export function registrationOrderTypedData(o: RegistrationOrder, chainId: number, market: Address): TypedDataDefinition<typeof registrationOrderTypes, "RegistrationOrder"> {
  return { domain: domain(chainId, market), types: registrationOrderTypes, primaryType: "RegistrationOrder", message: { ...o } };
}

export function studOrderTypedData(o: StudOrder, chainId: number, market: Address): TypedDataDefinition<typeof studOrderTypes, "StudOrder"> {
  return { domain: domain(chainId, market), types: studOrderTypes, primaryType: "StudOrder", message: { ...o } };
}

export function bidTypedData(b: Bid, chainId: number, market: Address): TypedDataDefinition<typeof bidTypes, "Bid"> {
  return { domain: domain(chainId, market), types: bidTypes, primaryType: "Bid", message: { ...b } };
}

/** On-chain horse reference: keccak256(utf8("posttime:horse:<uuid>")). Lowercase uuid. */
export function horseRef(horseId: string): Hex {
  return keccak256(toBytes(`posttime:horse:${horseId.toLowerCase()}`));
}

/** The fee HorseMarket accepts for `price` at `feeBps` (it also accepts the ceiling). */
export function horseMarketFee(price: bigint, feeBps: number): bigint {
  return (price * BigInt(feeBps)) / 10_000n;
}
