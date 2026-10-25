// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ThoroughbredToken (OPTIONAL, not deployed by default)
/// @notice Plain capped ERC20 with EIP-2612 permit. It exists so the option is reviewable, not
/// because the game needs it. See docs/web3.md "Token: deliberately boring".
///
/// Design constraints (deliberate):
///  - Fixed genesis distribution only. MINTER_ROLE can mint up to the cap until the admin calls
///    `finalizeGenesis()`, which disables minting forever. There is no mint-on-gameplay,
///    no play-to-earn emission, no race rewards in tokens.
///  - No staking, no yield, no rebasing, no fees. Yield-bearing or "earn by holding" mechanics
///    make a token look like an investment product (securities risk) and pull the game toward
///    speculation, which contradicts the "credits are never cashed out / no prize money" rules.
///  - Not upgradeable, no blocklist, no admin transfer powers over user balances.
///  - Never use Robinhood marks in the name or symbol (Robinhood Chain terms of service).
contract ThoroughbredToken is ERC20, ERC20Permit, ERC20Capped, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    bool public genesisFinalized;

    event GenesisFinalized(uint256 totalSupply);

    error GenesisAlreadyFinalized();
    error LengthMismatch();
    error ZeroAddress();

    constructor(string memory name_, string memory symbol_, uint256 cap_, address admin, address minter)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        ERC20Capped(cap_)
    {
        if (admin == address(0) || minter == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
    }

    /// @notice Genesis distribution (treasury, team vesting contract, ecosystem fund...).
    function mintGenesis(address[] calldata recipients, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        if (genesisFinalized) revert GenesisAlreadyFinalized();
        if (recipients.length != amounts.length) revert LengthMismatch();
        for (uint256 i = 0; i < recipients.length; ++i) {
            _mint(recipients[i], amounts[i]);
        }
    }

    /// @notice Irreversibly ends minting. Supply is fixed from here on.
    function finalizeGenesis() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (genesisFinalized) revert GenesisAlreadyFinalized();
        genesisFinalized = true;
        emit GenesisFinalized(totalSupply());
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
