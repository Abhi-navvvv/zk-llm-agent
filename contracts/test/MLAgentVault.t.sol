// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/MLAgentVault.sol";
import "../src/ISP1Verifier.sol";
import "../src/interfaces/IERC20.sol";
import "../src/interfaces/IPriceFeed.sol";

// ══════════════════════════════════════════════
// Mock Contracts
// ══════════════════════════════════════════════

contract MockSP1Verifier is ISP1Verifier {
    bool public shouldPass;

    constructor(bool _shouldPass) { shouldPass = _shouldPass; }

    function setShouldPass(bool _val) external { shouldPass = _val; }

    function verifyProof(bytes32, bytes calldata, bytes calldata) external view override {
        if (!shouldPass) revert("Mock: invalid proof");
    }
}

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals_;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _dec) {
        name = _name;
        symbol = _symbol;
        decimals_ = _dec;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

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

// ══════════════════════════════════════════════
// Forge Shim (minimal Test base)
// ══════════════════════════════════════════════

// NOTE: This file is designed for Foundry's `forge test`.
// It uses forge-std's Test contract. Install with: forge install foundry-rs/forge-std

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes memory) external;
    function expectEmit(bool, bool, bool, bool) external;
    function warp(uint256) external;
}

contract MLAgentVaultTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Test actors
    address internal owner = address(0xA);
    address internal operator = address(0xB);
    address internal user = address(0xC);
    address internal attacker = address(0xD);

    // Contracts
    MockSP1Verifier internal verifier;
    MockERC20 internal usdc;
    MockERC20 internal weth;
    MockPriceFeed internal feed;
    MLAgentVault internal vault;

    // Encoded test data
    bytes internal validPublicValues;
    bytes internal validProof;

    function setUp() public {
        // Deploy mocks
        verifier = new MockSP1Verifier(true);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        feed = new MockPriceFeed(300_000_000_000, 8); // $3,000 with 8 decimals

        // Deploy vault as owner
        vm.startPrank(owner);
        vault = new MLAgentVault(
            address(verifier),
            bytes32(uint256(0x1234)),
            address(usdc),
            address(weth),
            address(feed),
            operator
        );
        vm.stopPrank();

        // Prepare mock proof data
        uint256[8] memory prompt = [uint256(1), 3, 4, 7, 9, 13, 0, 0];
        uint256 actionToken = 14; // BUY_ETH
        validPublicValues = abi.encode(prompt, actionToken);
        validProof = hex"deadbeef";

        // Fund vault with tokens
        usdc.mint(address(vault), 10_000 * 1e6);
        weth.mint(address(vault), 5 * 1e18);
    }

    // ── Constructor Tests ──

    function test_constructor_sets_state() public view {
        assert(vault.owner() == owner);
        assert(vault.operator() == operator);
        assert(address(vault.verifier()) != address(0));
        assert(vault.maxSlippageBps() == 100);
        assert(!vault.paused());
    }

    function test_constructor_reverts_zero_address() public {
        vm.expectRevert(MLAgentVault.ZeroAddress.selector);
        new MLAgentVault(address(0), bytes32(0), address(usdc), address(weth), address(feed), operator);
    }

    // ── Access Control Tests ──

    function test_rebalance_reverts_for_non_operator() public {
        vm.prank(attacker);
        vm.expectRevert(MLAgentVault.Unauthorized.selector);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_rebalance_succeeds_for_operator() public {
        vm.prank(operator);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_rebalance_succeeds_for_owner() public {
        vm.prank(owner);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_only_owner_can_update_operator() public {
        vm.prank(attacker);
        vm.expectRevert(MLAgentVault.Unauthorized.selector);
        vault.updateOperator(attacker);
    }

    function test_only_owner_can_pause() public {
        vm.prank(attacker);
        vm.expectRevert(MLAgentVault.Unauthorized.selector);
        vault.pause();
    }

    // ── Proof Verification Tests ──

    function test_rebalance_reverts_invalid_proof() public {
        verifier.setShouldPass(false);
        vm.prank(operator);
        vm.expectRevert(MLAgentVault.InvalidProof.selector);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_rebalance_reverts_invalid_action_token() public {
        uint256[8] memory prompt = [uint256(1), 3, 4, 7, 9, 13, 0, 0];
        bytes memory badPub = abi.encode(prompt, uint256(99));
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MLAgentVault.InvalidActionToken.selector, 99));
        vault.rebalance(badPub, validProof, 0);
    }

    // ── Pause Tests ──

    function test_rebalance_reverts_when_paused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(operator);
        vm.expectRevert(MLAgentVault.VaultPaused.selector);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_deposit_reverts_when_paused() public {
        vm.prank(owner);
        vault.pause();

        vm.prank(user);
        vm.expectRevert(MLAgentVault.VaultPaused.selector);
        vault.depositUsdc(1000);
    }

    // ── Deposit Tests ──

    function test_deposit_usdc() public {
        usdc.mint(user, 5000 * 1e6);

        vm.startPrank(user);
        usdc.approve(address(vault), 5000 * 1e6);
        vault.depositUsdc(5000 * 1e6);
        vm.stopPrank();

        assert(vault.userUsdcDeposits(user) == 5000 * 1e6);
    }

    function test_deposit_zero_reverts() public {
        vm.prank(user);
        vm.expectRevert(MLAgentVault.ZeroAmount.selector);
        vault.depositUsdc(0);
    }

    // ── Withdrawal Tests ──

    function test_withdraw_usdc_only_owner() public {
        vm.prank(attacker);
        vm.expectRevert(MLAgentVault.Unauthorized.selector);
        vault.withdrawUsdc(100, attacker);
    }

    function test_withdraw_to_zero_address_reverts() public {
        vm.prank(owner);
        vm.expectRevert(MLAgentVault.ZeroAddress.selector);
        vault.withdrawUsdc(100, address(0));
    }

    // ── Oracle Staleness Tests ──

    function test_rebalance_reverts_stale_price() public {
        // Warp time forward past staleness threshold
        vm.warp(block.timestamp + 2 hours);

        vm.prank(operator);
        // Should revert because price feed hasn't been updated
        vm.expectRevert(
            abi.encodeWithSelector(MLAgentVault.StalePriceData.selector, feed.updatedAt(), block.timestamp + 2 hours)
        );
        vault.rebalance(validPublicValues, validProof, 0);
    }

    // ── Slippage Tests ──

    function test_update_slippage_too_high_reverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MLAgentVault.InvalidSlippage.selector, 1500));
        vault.updateMaxSlippage(1500);
    }

    function test_update_slippage_success() public {
        vm.prank(owner);
        vault.updateMaxSlippage(200); // 2%
        assert(vault.maxSlippageBps() == 200);
    }

    // ── HOLD Action Test ──

    function test_hold_action_no_swap() public {
        uint256[8] memory prompt = [uint256(1), 3, 6, 7, 8, 13, 0, 0]; // CRAB + HIGH
        bytes memory holdPub = abi.encode(prompt, uint256(16)); // HOLD

        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 wethBefore = weth.balanceOf(address(vault));

        vm.prank(operator);
        vault.rebalance(holdPub, validProof, 0);

        assert(usdc.balanceOf(address(vault)) == usdcBefore);
        assert(weth.balanceOf(address(vault)) == wethBefore);
    }

    // ── View Function Tests ──

    function test_view_balances() public view {
        assert(vault.vaultUsdcBalance() == 10_000 * 1e6);
        assert(vault.vaultWethBalance() == 5 * 1e18);
    }

    function test_get_eth_price() public view {
        assert(vault.getEthPrice() == 300_000_000_000);
    }

    // ── VKey Update Tests ──

    function test_update_vkey() public {
        bytes32 newKey = bytes32(uint256(0xABCD));
        vm.prank(owner);
        vault.updateProgramVKey(newKey);
        assert(vault.programVKey() == newKey);
    }
}
