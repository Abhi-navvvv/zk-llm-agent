// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISP1Verifier.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IPriceFeed.sol";

/**
 * @title MLAgentVault
 * @notice DeFi vault managed by a ZK-verified ML model running in SP1 zkVM.
 * @dev Improvements: ERC-20 tokens, Chainlink oracle, reentrancy guard,
 *      operator ACL, slippage protection, emergency pause.
 */
contract MLAgentVault {
    // Reentrancy Guard
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _reentrancyStatus = _NOT_ENTERED;

    modifier nonReentrant() {
        if (_reentrancyStatus == _ENTERED) revert ReentrantCall();
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    // Events
    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event Rebalanced(uint256[8] inputPrompt, uint256 actionToken, string actionName, uint256 swapped, uint256 received);
    event OperatorUpdated(address indexed oldOp, address indexed newOp);
    event ProgramVKeyUpdated(bytes32 oldKey, bytes32 newKey);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // Custom Errors
    error InvalidProof();
    error Unauthorized();
    error TransferFailed();
    error InvalidActionToken(uint256 token);
    error ReentrantCall();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error StalePriceData(uint256 updatedAt, uint256 currentTime);
    error ZeroAmount();
    error VaultPaused();
    error InvalidSlippage(uint256 bps);
    error ZeroAddress();

    // Constants
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant STALENESS_THRESHOLD = 1 hours;
    uint256 public constant REBALANCE_RATIO = 5000; // 50%
    uint256 public constant ACTION_BUY_ETH = 14;
    uint256 public constant ACTION_BUY_USDC = 15;
    uint256 public constant ACTION_HOLD = 16;

    // Immutables
    address public immutable verifier;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IPriceFeed public immutable priceFeed;

    // State
    bytes32 public programVKey;
    address public owner;
    address public operator;
    uint256 public maxSlippageBps = 100; // 1%
    bool public paused;
    mapping(address => uint256) public userUsdcDeposits;
    mapping(address => uint256) public userWethDeposits;

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyOperator() { if (msg.sender != operator && msg.sender != owner) revert Unauthorized(); _; }
    modifier whenNotPaused() { if (paused) revert VaultPaused(); _; }

    constructor(address _verifier, bytes32 _programVKey, address _usdc, address _weth, address _priceFeed, address _operator) {
        if (_verifier == address(0) || _usdc == address(0) || _weth == address(0)) revert ZeroAddress();
        if (_priceFeed == address(0) || _operator == address(0)) revert ZeroAddress();
        verifier = _verifier;
        programVKey = _programVKey;
        usdc = IERC20(_usdc);
        weth = IERC20(_weth);
        priceFeed = IPriceFeed(_priceFeed);
        operator = _operator;
        owner = msg.sender;
    }

    /// @notice Rebalance vault using a ZK-verified ML model decision.
    /// @param publicValues ABI-encoded [uint256[8] inputPrompt, uint256 actionToken]
    /// @param proofBytes Groth16 proof seal from SP1
    /// @param minAmountOut Minimum acceptable output (slippage protection)
    function rebalance(bytes calldata publicValues, bytes calldata proofBytes, uint256 minAmountOut)
        external onlyOperator whenNotPaused nonReentrant
    {
        // 1. Verify ZK proof
        try ISP1Verifier(verifier).verifyProof(programVKey, publicValues, proofBytes) {}
        catch { revert InvalidProof(); }

        // 2. Decode verified public values
        (uint256[8] memory inputPrompt, uint256 actionToken) = abi.decode(publicValues, (uint256[8], uint256));

        // 3. Get live ETH price from oracle
        uint256 ethPrice = _getEthPrice();

        // 4. Execute action
        string memory actionName;
        uint256 amountSwapped;
        uint256 amountReceived;

        if (actionToken == ACTION_BUY_ETH) {
            actionName = "BUY_ETH";
            (amountSwapped, amountReceived) = _swapUsdcToWeth(ethPrice, minAmountOut);
        } else if (actionToken == ACTION_BUY_USDC) {
            actionName = "BUY_USDC";
            (amountSwapped, amountReceived) = _swapWethToUsdc(ethPrice, minAmountOut);
        } else if (actionToken == ACTION_HOLD) {
            actionName = "HOLD";
        } else {
            revert InvalidActionToken(actionToken);
        }

        emit Rebalanced(inputPrompt, actionToken, actionName, amountSwapped, amountReceived);
    }

    // ── Deposits ──

    function depositUsdc(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        userUsdcDeposits[msg.sender] += amount;
        emit Deposited(msg.sender, address(usdc), amount);
    }

    function depositWeth(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!weth.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        userWethDeposits[msg.sender] += amount;
        emit Deposited(msg.sender, address(weth), amount);
    }

    // ── Withdrawals (owner only) ──

    function withdrawUsdc(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, address(usdc), amount);
    }

    function withdrawWeth(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (!weth.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, address(weth), amount);
    }

    // ── Admin ──

    function updateProgramVKey(bytes32 _newVKey) external onlyOwner {
        emit ProgramVKeyUpdated(programVKey, _newVKey);
        programVKey = _newVKey;
    }

    function updateOperator(address _newOp) external onlyOwner {
        if (_newOp == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, _newOp);
        operator = _newOp;
    }

    function updateMaxSlippage(uint256 _newBps) external onlyOwner {
        if (_newBps > 1000) revert InvalidSlippage(_newBps); // max 10%
        maxSlippageBps = _newBps;
    }

    function pause() external onlyOwner { paused = true; emit Paused(msg.sender); }
    function unpause() external onlyOwner { paused = false; emit Unpaused(msg.sender); }

    // ── Views ──

    function vaultUsdcBalance() external view returns (uint256) { return usdc.balanceOf(address(this)); }
    function vaultWethBalance() external view returns (uint256) { return weth.balanceOf(address(this)); }
    function getEthPrice() external view returns (uint256) { return _getEthPrice(); }

    // ── Internal Swap Logic ──
    // NOTE: In production, replace with real DEX router calls (Uniswap/Curve).

    function _swapUsdcToWeth(uint256 ethPrice, uint256 minOut) internal view returns (uint256, uint256) {
        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 toSwap = (usdcBal * REBALANCE_RATIO) / MAX_BPS;
        if (toSwap == 0) return (0, 0);
        uint256 wethOut = (toSwap * 1e20) / (ethPrice * 1e6);
        uint256 wethMin = (wethOut * (MAX_BPS - maxSlippageBps)) / MAX_BPS;
        uint256 effectiveMin = minOut > wethMin ? minOut : wethMin;
        if (wethOut < effectiveMin) revert SlippageExceeded(effectiveMin, wethOut);
        return (toSwap, wethOut);
    }

    function _swapWethToUsdc(uint256 ethPrice, uint256 minOut) internal view returns (uint256, uint256) {
        uint256 wethBal = weth.balanceOf(address(this));
        uint256 toSwap = (wethBal * REBALANCE_RATIO) / MAX_BPS;
        if (toSwap == 0) return (0, 0);
        uint256 usdcOut = (toSwap * ethPrice * 1e6) / 1e20;
        uint256 usdcMin = (usdcOut * (MAX_BPS - maxSlippageBps)) / MAX_BPS;
        uint256 effectiveMin = minOut > usdcMin ? minOut : usdcMin;
        if (usdcOut < effectiveMin) revert SlippageExceeded(effectiveMin, usdcOut);
        return (toSwap, usdcOut);
    }

    function _getEthPrice() internal view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = priceFeed.latestRoundData();
        if (block.timestamp - updatedAt > STALENESS_THRESHOLD) {
            revert StalePriceData(updatedAt, block.timestamp);
        }
        return uint256(answer);
    }
}
