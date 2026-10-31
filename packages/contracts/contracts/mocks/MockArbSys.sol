// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST ONLY. Stands in for the ArbSys precompile's block reads on the Hardhat network:
/// the "L2" block number is the EVM block number, and arbBlockHash reverts outside the last 256
/// blocks, like ArbSys does.
contract MockArbSys {
    error InvalidBlockNumber(uint256 requested, uint256 current);

    function arbBlockNumber() external view returns (uint256) {
        return block.number;
    }

    function arbBlockHash(uint256 n) external view returns (bytes32) {
        if (n >= block.number || n + 256 < block.number) revert InvalidBlockNumber(n, block.number);
        return blockhash(n);
    }
}
