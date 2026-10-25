import { parseAbi } from "viem";

// Hand-written ABIs for the server adapter so it never depends on build artifacts.
// test/abi-sync.test.ts asserts these match the compiled contracts exactly (selectors/topics).

export const raceProofRegistryAbi = parseAbi([
  "struct Batch { bytes32 root; uint32 leafCount; uint64 publishedAt; }",
  "function publishBatch(uint8 kind, uint64 batchId, bytes32 root, uint32 leafCount, string manifestURI)",
  "function getBatch(uint8 kind, uint64 batchId) view returns (Batch)",
  "function commitmentLeaf(bytes32 raceKey, bytes32 seedCommitment) pure returns (bytes32)",
  "function resultLeaf(bytes32 raceKey, bytes32 resultHash, bytes32 revealedSeed) pure returns (bytes32)",
  "function verifyCommitment(uint64 batchId, bytes32 raceKey, bytes32 seedCommitment, bytes32[] proof) view returns (bool)",
  "function verifyResult(uint64 batchId, bytes32 raceKey, bytes32 resultHash, bytes32 revealedSeed, bytes32[] proof) view returns (bool)",
  "function verifyRace(uint64 commitmentBatchId, bytes32[] commitmentProof, uint64 resultBatchId, bytes32[] resultProof, bytes32 raceKey, bytes32 seedCommitment, bytes32 resultHash, bytes32 revealedSeed) view returns (bool)",
  "function paused() view returns (bool)",
  "event BatchPublished(uint8 indexed kind, uint64 indexed batchId, bytes32 root, uint32 leafCount, uint64 publishedAt, string manifestURI)",
]);

export const premiumStoreAbi = parseAbi([
  "struct Order { bytes32 orderId; address buyer; bytes32 sku; uint32 quantity; address token; uint256 maxTotal; uint64 deadline; }",
  "function purchase(Order order, bytes signature) returns (uint256 total)",
  "function hashOrder(Order order) view returns (bytes32)",
  "function isFulfilled(bytes32 orderId) view returns (bool)",
  "function orderBuyer(bytes32 orderId) view returns (address)",
  "function priceOf(bytes32 sku, address token) view returns (uint256)",
  "function skuActive(bytes32 sku) view returns (bool)",
  "function acceptedToken(address token) view returns (bool)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
  "event Purchased(bytes32 indexed orderId, address indexed buyer, bytes32 indexed sku, address token, uint32 quantity, uint256 unitPrice, uint256 total)",
  "event PriceSet(bytes32 indexed sku, address indexed token, uint256 oldPrice, uint256 newPrice)",
]);
