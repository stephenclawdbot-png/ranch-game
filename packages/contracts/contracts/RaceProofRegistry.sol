// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title RaceProofRegistry
/// @notice Public, append-only anchor for Project Thoroughbred's race fairness proofs.
///
/// The game server runs races off-chain (deterministic engine, see packages/racing-engine).
/// For every race it publishes `seedCommitment = sha256(seed)` when entries open and reveals
/// `seed` plus `resultHash` after the race. This contract anchors those values in batches:
///
///   1. COMMITMENT batch: Merkle root over leaves (raceKey, seedCommitment), posted at entry open.
///   2. RESULT batch:     Merkle root over leaves (raceKey, resultHash, revealedSeed), posted after settlement.
///
/// Only one 32-byte root per batch is stored (no per-race storage). Roots are immutable once
/// published, so the operator cannot rewrite a commitment after seeing who entered.
/// Anyone can verify inclusion with a Merkle proof, and `verifyRace` checks the full chain:
/// commitment included, result included, sha256(revealedSeed) == seedCommitment, and the
/// commitment batch was anchored strictly before the result batch.
///
/// Leaves are double-hashed (OpenZeppelin StandardMerkleTree style) and domain-separated by a
/// kind tag so a leaf can never be confused with an inner node or with a leaf of the other kind.
/// The TypeScript encoder lives in packages/contracts/adapter/merkle.ts and is tested against
/// this contract.
contract RaceProofRegistry is AccessControl, Pausable {
    /// @notice Role allowed to publish batch roots (the game server's hot key).
    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");
    /// @notice Role allowed to pause publishing (incident response). Unpausing needs the admin.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @dev Leaf kind tags (first ABI word of every leaf preimage).
    uint8 public constant KIND_COMMITMENT = 1;
    uint8 public constant KIND_RESULT = 2;

    struct Batch {
        bytes32 root;
        uint32 leafCount;
        uint64 publishedAt; // block.timestamp (L2 timestamp on Arbitrum chains)
    }

    /// @dev kind => batchId => batch. batchIds are chosen by the server (e.g. a monotonically
    /// increasing counter per kind) and can never be reused.
    mapping(uint8 kind => mapping(uint64 batchId => Batch)) private _batches;

    event BatchPublished(
        uint8 indexed kind,
        uint64 indexed batchId,
        bytes32 root,
        uint32 leafCount,
        uint64 publishedAt,
        string manifestURI
    );

    error InvalidKind(uint8 kind);
    error EmptyRoot();
    error EmptyBatch();
    error BatchAlreadyPublished(uint8 kind, uint64 batchId);
    error ZeroAddress();

    constructor(address admin, address publisher) {
        if (admin == address(0) || publisher == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(PUBLISHER_ROLE, publisher);
    }

    // ---------------------------------------------------------------- publishing

    /// @notice Anchor a batch root. Roots are write-once per (kind, batchId).
    /// @param manifestURI Optional off-chain location of the full leaf list (emitted only, not stored).
    function publishBatch(uint8 kind, uint64 batchId, bytes32 root, uint32 leafCount, string calldata manifestURI)
        external
        onlyRole(PUBLISHER_ROLE)
        whenNotPaused
    {
        if (kind != KIND_COMMITMENT && kind != KIND_RESULT) revert InvalidKind(kind);
        if (root == bytes32(0)) revert EmptyRoot();
        if (leafCount == 0) revert EmptyBatch();
        Batch storage b = _batches[kind][batchId];
        if (b.root != bytes32(0)) revert BatchAlreadyPublished(kind, batchId);

        uint64 nowTs = uint64(block.timestamp);
        b.root = root;
        b.leafCount = leafCount;
        b.publishedAt = nowTs;
        emit BatchPublished(kind, batchId, root, leafCount, nowTs, manifestURI);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------- reads

    function getBatch(uint8 kind, uint64 batchId) external view returns (Batch memory) {
        return _batches[kind][batchId];
    }

    /// @notice Leaf for a seed commitment. raceKey = keccak256(utf8(raceId)).
    function commitmentLeaf(bytes32 raceKey, bytes32 seedCommitment) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(KIND_COMMITMENT, raceKey, seedCommitment))));
    }

    /// @notice Leaf for a settled race. revealedSeed is the 32-byte seed whose sha256 is the commitment.
    function resultLeaf(bytes32 raceKey, bytes32 resultHash, bytes32 revealedSeed) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(KIND_RESULT, raceKey, resultHash, revealedSeed))));
    }

    function verifyCommitment(uint64 batchId, bytes32 raceKey, bytes32 seedCommitment, bytes32[] calldata proof)
        public
        view
        returns (bool)
    {
        bytes32 root = _batches[KIND_COMMITMENT][batchId].root;
        if (root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, root, commitmentLeaf(raceKey, seedCommitment));
    }

    function verifyResult(
        uint64 batchId,
        bytes32 raceKey,
        bytes32 resultHash,
        bytes32 revealedSeed,
        bytes32[] calldata proof
    ) public view returns (bool) {
        bytes32 root = _batches[KIND_RESULT][batchId].root;
        if (root == bytes32(0)) return false;
        return MerkleProof.verifyCalldata(proof, root, resultLeaf(raceKey, resultHash, revealedSeed));
    }

    /// @notice Full fairness check for one race. Never reverts on bad input; returns false instead.
    function verifyRace(
        uint64 commitmentBatchId,
        bytes32[] calldata commitmentProof,
        uint64 resultBatchId,
        bytes32[] calldata resultProof,
        bytes32 raceKey,
        bytes32 seedCommitment,
        bytes32 resultHash,
        bytes32 revealedSeed
    ) external view returns (bool) {
        if (sha256(abi.encodePacked(revealedSeed)) != seedCommitment) return false;
        Batch storage c = _batches[KIND_COMMITMENT][commitmentBatchId];
        Batch storage r = _batches[KIND_RESULT][resultBatchId];
        if (c.root == bytes32(0) || r.root == bytes32(0)) return false;
        // The commitment must have been anchored strictly before the result.
        if (c.publishedAt >= r.publishedAt) return false;
        return verifyCommitment(commitmentBatchId, raceKey, seedCommitment, commitmentProof)
            && verifyResult(resultBatchId, raceKey, resultHash, revealedSeed, resultProof);
    }
}
