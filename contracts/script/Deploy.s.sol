// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockPriceFeed.sol";
import "../src/MLAgentVault.sol";

contract DeployScript is Script {
    address constant SP1_VERIFIER = 0x397A5f7f3dBd538f23DE225B51f532c34448dA9B;

    uint8 constant USDC_DECIMALS = 6;
    uint8 constant WETH_DECIMALS = 18;
    uint8 constant PRICEFEED_DECIMALS = 8;

    uint256 constant INITIAL_USDC_SUPPLY = 100_000 * 1e6;
    uint256 constant INITIAL_WETH_SUPPLY = 100 * 1e18;

    int256 constant MOCK_ETH_PRICE = 3000_00000000;

    bytes32 constant DEFAULT_PROGRAM_VKEY = bytes32(uint256(0));
    bytes32 constant DEFAULT_WEIGHTS_HASH = bytes32(uint256(0));

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        console.log("Deployer: %s", deployer);
        console.log("Balance: %s ETH", deployer.balance / 1e18);

        bytes32 programVKey = vm.envOr("PROGRAM_VKEY", DEFAULT_PROGRAM_VKEY);
        bytes32 weightsHash = vm.envOr("WEIGHTS_HASH", DEFAULT_WEIGHTS_HASH);

        if (programVKey == bytes32(0)) {
            console.log("[WARN] PROGRAM_VKEY not set. Using zero placeholder.");
            console.log("  Get the real VKey by running the SP1 host script.");
            console.log("  Then redeploy or use proposeProgramVKey/executeProgramVKey.");
        }
        if (weightsHash == bytes32(0)) {
            console.log("[WARN] WEIGHTS_HASH not set. Using zero placeholder.");
            console.log("  Compute: keccak256(weights.bin) and update via governance.");
        }

        vm.startBroadcast(deployerPrivateKey);

        MockERC20 usdc = new MockERC20("TestUSDC", "USDC", USDC_DECIMALS, INITIAL_USDC_SUPPLY);
        console.log("TestUSDC: %s", address(usdc));

        MockERC20 weth = new MockERC20("TestWETH", "WETH", WETH_DECIMALS, INITIAL_WETH_SUPPLY);
        console.log("TestWETH: %s", address(weth));

        MockPriceFeed priceFeed = new MockPriceFeed(MOCK_ETH_PRICE, PRICEFEED_DECIMALS);
        console.log("MockPriceFeed: %s", address(priceFeed));

        MLAgentVault vault = new MLAgentVault(
            SP1_VERIFIER,
            programVKey,
            weightsHash,
            address(usdc),
            address(weth),
            address(priceFeed),
            deployer
        );
        console.log("MLAgentVault: %s", address(vault));

        vm.stopBroadcast();

        console.log("--- Deployment Summary (Sepolia) ---");
        console.log("SP1VerifierGateway: %s", SP1_VERIFIER);
        console.log("TestUSDC:           %s", address(usdc));
        console.log("TestWETH:           %s", address(weth));
        console.log("MockPriceFeed:      %s", address(priceFeed));
        console.log("MLAgentVault:       %s", address(vault));
        console.log("Program VKey:");
        console.logBytes32(programVKey);
        console.log("Weights Hash:");
        console.logBytes32(weightsHash);

        console.log("--- .env snippet ---");
        console.log("NEXT_PUBLIC_USDC_ADDRESS=%s", address(usdc));
        console.log("NEXT_PUBLIC_WETH_ADDRESS=%s", address(weth));
        console.log("NEXT_PUBLIC_VAULT_ADDRESS=%s", address(vault));
        console.log("NEXT_PUBLIC_PRICEFEED_ADDRESS=%s", address(priceFeed));
        console.log("NEXT_PUBLIC_SP1_VERIFIER=%s", SP1_VERIFIER);
    }
}
