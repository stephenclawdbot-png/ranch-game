// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST ONLY. A randomness beacon for TotePools' optional hook: records requests and
/// returns whatever randomness the test sets (0 = not delivered yet).
contract MockEntropyBeacon {
    mapping(bytes32 raceId => bool) public requested;
    mapping(bytes32 raceId => bytes32) public randomness;

    function requestRandomness(bytes32 raceId) external {
        requested[raceId] = true;
    }

    function deliver(bytes32 raceId, bytes32 value) external {
        randomness[raceId] = value;
    }
}
