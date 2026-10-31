// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST ONLY. Stands in for the ArbSys precompile's block reads on the Hardhat network:
/// the "L2" block number is the EVM block number, and arbBlockHash reverts outside the last 256
/// blocks, like ArbSys does. `setBroken` makes arbBlockHash fail some other way (an unexpected
/// error), which TotePools must not mistake for an out-of-range block.
contract MockArbSys {
    error InvalidBlockNumber(uint256 requested, uint256 current);
    error Broken();

    bool public broken;

    function setBroken(bool b) external {
        broken = b;
    }

    function arbBlockNumber() external view returns (uint256) {
        return block.number;
    }

    function arbBlockHash(uint256 n) external view returns (bytes32) {
        if (broken) revert Broken();
        if (n >= block.number || n + 256 < block.number) revert InvalidBlockNumber(n, block.number);
        return blockhash(n);
    }
}
