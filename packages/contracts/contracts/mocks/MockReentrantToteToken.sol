// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY. A 6-decimal token that, once armed, calls `target` with `payload` from
/// inside transfer and transferFrom, to prove TotePools' ReentrancyGuard holds on bets, claims
/// and treasury withdrawals even if a hostile token were ever used.
contract MockReentrantToteToken is ERC20 {
    address public target;
    bytes public payload;

    constructor() ERC20("Evil Tote", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function _hook() private {
        if (target == address(0)) return;
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        _hook();
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _hook();
        return super.transferFrom(from, to, value);
    }
}
