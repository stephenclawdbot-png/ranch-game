/** JSON shapes of the USDG market APIs (client-safe). Amounts are micro-USDG (1 USDG = 1_000_000). */
import type { Silks } from "@thoroughbred/shared";
import type { UsdgOrderJson } from "./chain/usdg";
import type { EcoHorse } from "./economyTypes";

/** practice: beta test money ("T-USDG") from the game ledger, wallet sign-in but no chain (USDG_MODE=practice). */
export type UsdgMode = "live" | "mock" | "practice" | "off";

/** Practice mode: my T-USDG balance (micro units) and the one-off grant. */
export interface UsdgPracticeView {
  balance: number;
  grant: number;
}

export interface UsdgPolicyView {
  feeBps: number;
  registrationFee: number;
  minPrice: number;
  maxPrice: number;
  minLiveStarts: number;
  auctionHours: number[];
  fixedListingDays: number[];
  paymentWindowHours: number;
  /** How long a fixed-price buy, a registration or a stud booking holds its signed order. */
  quoteMinutes: number;
  nonPayerBarDays: number;
  /** USDG stud fee bounds for registered stallions (micro-USDG). */
  studFeeMin: number;
  studFeeMax: number;
  bidIncrementBps: number;
  bidIncrementMin: number;
}

export interface UsdgNetworkView {
  mode: UsdgMode;
  chainId: number;
  networkName: string;
  testnet: boolean;
  explorer: string | null;
  market: string;
  token: string;
  /** Testnet faucets (null on mainnet). */
  faucets: { usdg: string; eth: string } | null;
}

export interface UsdgLotView extends EcoHorse {
  listingId: string;
  lot: number;
  kind: "fixed" | "auction";
  /** active, or closed = an auction that ended and is being offered to its bidders in turn. */
  status: "active" | "closed";
  /** Fixed price, or the auction reserve. */
  price: number;
  fee: number;
  sellerReceives: number;
  endsAtMs: number;
  sellerStableName: string;
  sellerSilks: Silks;
  mine: boolean;
  bestBid: number | null;
  bidCount: number;
  /** The lowest bid that would be accepted now (auctions that are still open). */
  minNextBid: number | null;
  myBestBid: number | null;
  /** A fixed-price lot someone is paying for right now. */
  reserved: boolean;
  /** This auction was won by me and is waiting for my payment. */
  offeredToMe: boolean;
  offerDeadlineMs: number | null;
  sireName: string | null;
  damName: string | null;
}

export interface UsdgSellable extends EcoHorse {
  /** null = can be listed now. */
  block: string | null;
  listingId: string | null;
}

export interface UsdgMarketView {
  network: UsdgNetworkView;
  policy: UsdgPolicyView;
  /** Practice mode only (null otherwise). */
  practice: UsdgPracticeView | null;
  wallet: string | null;
  barredUntilMs: number | null;
  lots: UsdgLotView[];
  mine: UsdgLotView[];
  orders: UsdgOrderJson[];
  /** My registered horses (list them from here or from the horse page). */
  registered: UsdgSellable[];
  stalls: { used: number; slots: number; free: number };
  serverNowMs: number;
}

export interface UsdgCheckView {
  key: string;
  ok: boolean;
  label: string;
}

export interface UsdgHorseView {
  network: UsdgNetworkView;
  policy: UsdgPolicyView;
  practice: UsdgPracticeView | null;
  horseId: string;
  name: string;
  mine: boolean;
  registered: { atMs: number } | null;
  checks: UsdgCheckView[];
  liveStarts: number;
  openOrder: UsdgOrderJson | null;
  listing: { listingId: string; kind: "fixed" | "auction"; status: string; price: number; endsAtMs: number; bestBid: number | null; bidCount: number } | null;
  /** Why it can't be listed right now (null = it can). */
  listBlock: string | null;
  wallet: string | null;
  serverNowMs: number;
}
