// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TotePools} from "../TotePools.sol";

/// @notice TEST ONLY. TotePools deployed as if on Robinhood Chain testnet (chain id 46630), to
/// test the constructor's ArbSys requirement on the Hardhat network.
contract TotePoolsChainHarness is TotePools {
    constructor(Roles memory roles, address treasury_, address usdg, address arbSys_, Timing memory t) TotePools(roles, treasury_, usdg, arbSys_, t) {}

    function _chainId() internal pure override returns (uint256) {
        return 46630;
    }
}
