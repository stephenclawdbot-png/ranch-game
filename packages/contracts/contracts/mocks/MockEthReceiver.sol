// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice TEST ONLY. An ETH receiver that can accept, refuse, or re-enter a target with
/// arbitrary calldata when it receives ETH (reentrancy tests for PrizePool and PremiumStore).
/// It can also call any target, so it can act as a buyer or a claimer.
contract MockEthReceiver {
    enum Mode {
        Accept,
        Reject,
        Reenter, // re-enter and bubble the nested failure
        ReenterAndRecord // re-enter, record the nested failure, accept the ETH
    }

    Mode public mode;
    address public reenterTarget;
    bytes public reenterData;
    bool public reentered;
    bytes public reenterError;

    function setMode(Mode m) external {
        mode = m;
    }

    function setReenter(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
        mode = Mode.Reenter;
    }

    function setReenterAndRecord(address target, bytes calldata data) external {
        reenterTarget = target;
        reenterData = data;
        mode = Mode.ReenterAndRecord;
    }

    function execute(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    receive() external payable {
        if (mode == Mode.Reject) revert("MockEthReceiver: rejected");
        if (mode == Mode.ReenterAndRecord && !reentered) {
            reentered = true;
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            if (ok) revert("MockEthReceiver: reentry succeeded");
            reenterError = ret;
            return;
        }
        if (mode == Mode.Reenter && !reentered) {
            reentered = true;
            (bool ok, bytes memory ret) = reenterTarget.call(reenterData);
            if (ok) revert("MockEthReceiver: reentry succeeded");
            reenterError = ret;
            // Bubble the reentrancy failure so the outer call fails visibly.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
