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

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
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
    bytes32 internal defaultWeightsHash = bytes32(uint256(0x5678));

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
            defaultWeightsHash,
            address(usdc),
            address(weth),
            address(feed),
            operator
        );
        vm.stopPrank();

        // Prepare mock proof data (15 features, actionToken, weightsHash)
        int256[15] memory features;
        features[0] = 100000;
        uint256 actionToken = 14; // BUY_ETH
        validPublicValues = abi.encode(features, actionToken, defaultWeightsHash);
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
        assert(vault.activeWeightsHash() == defaultWeightsHash);
    }

    function test_constructor_reverts_zero_address() public {
        vm.expectRevert(MLAgentVault.ZeroAddress.selector);
        new MLAgentVault(address(0), bytes32(0), bytes32(0), address(usdc), address(weth), address(feed), operator);
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

    // ── Proof Verification Tests ──

    function test_rebalance_reverts_invalid_proof() public {
        verifier.setShouldPass(false);
        vm.prank(operator);
        vm.expectRevert(MLAgentVault.InvalidProof.selector);
        vault.rebalance(validPublicValues, validProof, 0);
    }

    function test_rebalance_reverts_invalid_action_token() public {
        int256[15] memory features;
        bytes memory badPub = abi.encode(features, uint256(99), defaultWeightsHash);
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(MLAgentVault.InvalidActionToken.selector, 99));
        vault.rebalance(badPub, validProof, 0);
    }

    function test_rebalance_reverts_weights_hash_mismatch() public {
        int256[15] memory features;
        bytes32 badHash = bytes32(uint256(0x9999));
        bytes memory badPub = abi.encode(features, uint256(14), badHash);
        vm.prank(operator);
        vm.expectRevert(MLAgentVault.InvalidWeightsHash.selector);
        vault.rebalance(badPub, validProof, 0);
    }

    // ── Deposit Tests ──

    function test_deposit_usdc() public {
        usdc.mint(user, 5000 * 1e6);

        vm.startPrank(user);
        usdc.approve(address(vault), 5000 * 1e6);
        vault.depositUsdc(5000 * 1e6);
        vm.stopPrank();

        assert(vault.userUsdcDeposits(user) == 5000 * 1e6);
        assert(vault.lastDepositTimestamp(user) == block.timestamp);
    }

    // ── User Withdrawal & Cooldown Tests ──

    function test_user_withdrawal_reverts_immediate() public {
        usdc.mint(user, 5000 * 1e6);

        vm.startPrank(user);
        usdc.approve(address(vault), 5000 * 1e6);
        vault.depositUsdc(5000 * 1e6);
        
        vm.expectRevert(MLAgentVault.TransferFailed.selector); // fails cooldown
        vault.userWithdrawUsdc(1000 * 1e6);
        vm.stopPrank();
    }

    function test_user_withdrawal_succeeds_after_cooldown() public {
        usdc.mint(user, 5000 * 1e6);

        vm.startPrank(user);
        usdc.approve(address(vault), 5000 * 1e6);
        vault.depositUsdc(5000 * 1e6);
        vm.stopPrank();

        // Warp 24 hours past cooldown
        vm.warp(block.timestamp + 24 hours);

        vm.startPrank(user);
        vault.userWithdrawUsdc(1000 * 1e6);
        vm.stopPrank();

        assert(vault.userUsdcDeposits(user) == 4000 * 1e6);
    }

    // ── Epoch Limit Tests ──

    function test_user_withdrawal_fails_above_epoch_limit() public {
        usdc.mint(user, 15_000 * 1e6);
        
        vm.startPrank(user);
        usdc.approve(address(vault), 15_000 * 1e6);
        vault.depositUsdc(15_000 * 1e6);
        vm.stopPrank();
        
        vm.warp(block.timestamp + 24 hours);

        vm.startPrank(user);
        // Epoch cap is 20% of vault balance. 
        // Vault has 10,000 + 15,000 = 25,000 USDC. 20% of 25,000 = 5,000 USDC.
        // Trying to withdraw 6,000 USDC should fail the epoch limit check.
        vm.expectRevert("Epoch USDC withdrawal limit exceeded");
        vault.userWithdrawUsdc(6000 * 1e6);
        vm.stopPrank();
    }

    // ── Timelock Governance Tests ──

    function test_update_vkey_timelock() public {
        bytes32 newKey = bytes32(uint256(0xABCD));
        vm.startPrank(owner);
        
        // 1. Propose VKey
        vault.proposeProgramVKey(newKey);
        
        // 2. Try executing immediately (should revert)
        vm.expectRevert(abi.encodeWithSelector(
            MLAgentVault.TimelockNotExpired.selector,
            block.timestamp,
            block.timestamp + 24 hours
        ));
        vault.executeProgramVKey(newKey);
        
        // 3. Warp time past 24 hours
        vm.warp(block.timestamp + 24 hours);
        
        // 4. Execute VKey succeeds
        vault.executeProgramVKey(newKey);
        assert(vault.programVKey() == newKey);
        
        vm.stopPrank();
    }

    function test_model_upgrade_registry_timelock() public {
        bytes32 newVKey = bytes32(uint256(0xABCD));
        bytes32 newHash = bytes32(uint256(0xDEFF));
        vm.startPrank(owner);

        // 1. Propose Upgrade
        vault.proposeModelUpgrade(2, newVKey, newHash);

        // 2. Warp
        vm.warp(block.timestamp + 24 hours);

        // 3. Execute Upgrade
        vault.executeModelUpgrade(2, newVKey, newHash);
        
        assert(vault.programVKey() == newVKey);
        assert(vault.activeWeightsHash() == newHash);
        assert(vault.activeModelVersion() == 2);
        
        vm.stopPrank();
    }

    function test_rebalance_ratio_timelock() public {
        vm.startPrank(owner);
        
        vault.proposeRebalanceRatio(8000); // 80%
        
        vm.warp(block.timestamp + 24 hours);
        vault.executeRebalanceRatio(8000);
        
        assert(vault.rebalanceRatio() == 8000);
        vm.stopPrank();
    }

    // ── HOLD Action Test ──

    function test_hold_action_no_swap() public {
        int256[15] memory features;
        bytes memory holdPub = abi.encode(features, uint256(16), defaultWeightsHash); // HOLD

        uint256 usdcBefore = usdc.balanceOf(address(vault));
        uint256 wethBefore = weth.balanceOf(address(vault));

        vm.prank(operator);
        vault.rebalance(holdPub, validProof, 0);

        assert(usdc.balanceOf(address(vault)) == usdcBefore);
        assert(weth.balanceOf(address(vault)) == wethBefore);
    }
}
