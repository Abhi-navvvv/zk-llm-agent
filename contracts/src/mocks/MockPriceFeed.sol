// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
    int256 public price;
    uint256 public updatedAt;
    uint8 public decimals;

    constructor(int256 _price, uint8 _dec) {
        price = _price;
        decimals = _dec;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 _price) external {
        price = _price;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 _ts) external { updatedAt = _ts; }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}
