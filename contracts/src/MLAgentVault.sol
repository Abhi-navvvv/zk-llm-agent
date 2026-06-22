// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ISP1Verifier.sol";
import "./interfaces/IERC20.sol";
import "./interfaces/IPriceFeed.sol";

/**
 * @title MLAgentVault
 * @notice DeFi vault managed by a ZK-verified ML model running in SP1 zkVM.
 * @dev Secure registry, timelocks, withdrawal limits, cooldowns, and dynamic weights validation.
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
    event Rebalanced(int256[15] inputFeatures, uint256 actionToken, string actionName, uint256 swapped, uint256 received);
    event OperatorUpdated(address indexed oldOp, address indexed newOp);
    event ProgramVKeyUpdated(bytes32 indexed oldKey, bytes32 indexed newKey);
    event ProgramWeightsHashUpdated(bytes32 indexed newWeightsHash);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    
    // Timelock Events
    event ActionQueued(bytes32 indexed actionId, uint256 executeAfter);
    event ActionExecuted(bytes32 indexed actionId);

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
    error InvalidWeightsHash();
    
    // Timelock Errors
    error TimelockNotExpired(uint256 current, uint256 executeAfter);
    error ActionNotQueued();

    // Constants
    uint256 public constant MAX_BPS = 10_000;
    uint256 public constant STALENESS_THRESHOLD = 1 hours;
    uint256 public constant ACTION_BUY_ETH = 14;
    uint256 public constant ACTION_BUY_USDC = 15;
    uint256 public constant ACTION_HOLD = 16;
    uint256 public constant TIMELOCK_DELAY = 24 hours;

    // Immutables
    address public immutable verifier;
    IERC20 public immutable usdc;
    IERC20 public immutable weth;
    IPriceFeed public immutable priceFeed;

    // Model Registry State
    mapping(uint256 => bytes32) public modelVKeys;
    mapping(uint256 => bytes32) public modelWeightsHashes;
    uint256 public activeModelVersion;
    bytes32 public activeWeightsHash;
    bytes32 public programVKey;

    // Governance & Security State
    address public owner;
    address public operator;
    uint256 public maxSlippageBps = 100; // 1%
    uint256 public rebalanceRatio = 5000; // 50%
    bool public paused;

    // Timelock queue (hash of action data => execution timestamp)
    mapping(bytes32 => uint256) public timelockedActions;

    // User deposit & withdrawal limits state
    mapping(address => uint256) public userUsdcDeposits;
    mapping(address => uint256) public userWethDeposits;
    mapping(address => uint256) public lastDepositTimestamp;

    // Epoch withdrawal limits
    uint256 public epochLength = 1 days;
    uint256 public currentEpochStart;
    uint256 public usdcWithdrawnThisEpoch;
    uint256 public wethWithdrawnThisEpoch;
    uint256 public maxUsdcWithdrawalPerEpoch;
    uint256 public maxWethWithdrawalPerEpoch;

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier onlyOperator() { if (msg.sender != operator && msg.sender != owner) revert Unauthorized(); _; }
    modifier whenNotPaused() { if (paused) revert VaultPaused(); _; }

    constructor(
        address _verifier,
        bytes32 _programVKey,
        bytes32 _initialWeightsHash,
        address _usdc,
        address _weth,
        address _priceFeed,
        address _operator
    ) {
        if (_verifier == address(0) || _usdc == address(0) || _weth == address(0)) revert ZeroAddress();
        if (_priceFeed == address(0) || _operator == address(0)) revert ZeroAddress();
        
        verifier = _verifier;
        programVKey = _programVKey;
        activeWeightsHash = _initialWeightsHash;
        
        modelVKeys[1] = _programVKey;
        modelWeightsHashes[1] = _initialWeightsHash;
        activeModelVersion = 1;

        usdc = IERC20(_usdc);
        weth = IERC20(_weth);
        priceFeed = IPriceFeed(_priceFeed);
        operator = _operator;
        owner = msg.sender;
        
        currentEpochStart = block.timestamp;
    }

    /// @notice Rebalance vault using a ZK-verified ML model decision.
    /// @param publicValues ABI-encoded [int256[15] features, uint256 actionToken, bytes32 weightsHash]
    /// @param proofBytes Groth16 proof seal from SP1
    /// @param minAmountOut Minimum acceptable output (slippage protection)
    function rebalance(bytes calldata publicValues, bytes calldata proofBytes, uint256 minAmountOut)
        external onlyOperator whenNotPaused nonReentrant
    {
        // 1. Verify ZK proof
        try ISP1Verifier(verifier).verifyProof(programVKey, publicValues, proofBytes) {}
        catch { revert InvalidProof(); }

        // 2. Decode verified public values
        (int256[15] memory inputFeatures, uint256 actionToken, bytes32 weightsHash) = 
            abi.decode(publicValues, (int256[15], uint256, bytes32));

        // 3. Verify that the proof was generated using the currently active model weights
        if (weightsHash != activeWeightsHash) revert InvalidWeightsHash();

        // 4. Get live ETH price from oracle
        uint256 ethPrice = _getEthPrice();

        // 5. Execute action
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

        emit Rebalanced(inputFeatures, actionToken, actionName, amountSwapped, amountReceived);
    }

    // ── Deposits ──

    function depositUsdc(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        
        userUsdcDeposits[msg.sender] += amount;
        lastDepositTimestamp[msg.sender] = block.timestamp;
        
        emit Deposited(msg.sender, address(usdc), amount);
    }

    function depositWeth(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!weth.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        
        userWethDeposits[msg.sender] += amount;
        lastDepositTimestamp[msg.sender] = block.timestamp;
        
        emit Deposited(msg.sender, address(weth), amount);
    }

    // ── User Withdrawals (with cooldown + epoch limits) ──

    function userWithdrawUsdc(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (userUsdcDeposits[msg.sender] < amount) revert TransferFailed();
        if (block.timestamp < lastDepositTimestamp[msg.sender] + 1 days) revert TransferFailed();

        _checkAndUpdateEpochLimits(amount, true);
        
        userUsdcDeposits[msg.sender] -= amount;
        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
        
        emit Withdrawn(msg.sender, address(usdc), amount);
    }

    function userWithdrawWeth(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (userWethDeposits[msg.sender] < amount) revert TransferFailed();
        if (block.timestamp < lastDepositTimestamp[msg.sender] + 1 days) revert TransferFailed();

        _checkAndUpdateEpochLimits(amount, false);
        
        userWethDeposits[msg.sender] -= amount;
        if (!weth.transfer(msg.sender, amount)) revert TransferFailed();
        
        emit Withdrawn(msg.sender, address(weth), amount);
    }

    // ── Owner Withdrawals (emergency reserve withdrawal, subject to epoch limits) ──

    function withdrawUsdc(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        
        _checkAndUpdateEpochLimits(amount, true);
        
        if (!usdc.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, address(usdc), amount);
    }

    function withdrawWeth(uint256 amount, address to) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        
        _checkAndUpdateEpochLimits(amount, false);
        
        if (!weth.transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(to, address(weth), amount);
    }

    // ── Timelocked Governance Functions ──

    function queueAction(bytes32 actionId) internal {
        timelockedActions[actionId] = block.timestamp + TIMELOCK_DELAY;
        emit ActionQueued(actionId, block.timestamp + TIMELOCK_DELAY);
    }

    function checkTimelock(bytes32 actionId) internal {
        uint256 executeAfter = timelockedActions[actionId];
        if (executeAfter == 0) revert ActionNotQueued();
        if (block.timestamp < executeAfter) revert TimelockNotExpired(block.timestamp, executeAfter);
        
        delete timelockedActions[actionId];
        emit ActionExecuted(actionId);
    }

    // Propose / Execute VKey
    function proposeProgramVKey(bytes32 _newVKey) external onlyOwner {
        queueAction(keccak256(abi.encode("UPDATE_VKEY", _newVKey)));
    }

    function executeProgramVKey(bytes32 _newVKey) external onlyOwner {
        checkTimelock(keccak256(abi.encode("UPDATE_VKEY", _newVKey)));
        emit ProgramVKeyUpdated(programVKey, _newVKey);
        programVKey = _newVKey;
    }

    // Propose / Execute Model Registry Upgrades
    function proposeModelUpgrade(uint256 version, bytes32 newVKey, bytes32 newWeightsHash) external onlyOwner {
        queueAction(keccak256(abi.encode("UPGRADE_MODEL", version, newVKey, newWeightsHash)));
    }

    function executeModelUpgrade(uint256 version, bytes32 newVKey, bytes32 newWeightsHash) external onlyOwner {
        checkTimelock(keccak256(abi.encode("UPGRADE_MODEL", version, newVKey, newWeightsHash)));
        
        modelVKeys[version] = newVKey;
        modelWeightsHashes[version] = newWeightsHash;
        activeModelVersion = version;
        
        emit ProgramVKeyUpdated(programVKey, newVKey);
        emit ProgramWeightsHashUpdated(newWeightsHash);
        
        programVKey = newVKey;
        activeWeightsHash = newWeightsHash;
    }

    // Propose / Execute Rebalance Ratio
    function proposeRebalanceRatio(uint256 _newRatio) external onlyOwner {
        if (_newRatio < 1000 || _newRatio > 10000) revert InvalidSlippage(_newRatio);
        queueAction(keccak256(abi.encode("UPDATE_REBALANCE_RATIO", _newRatio)));
    }

    function executeRebalanceRatio(uint256 _newRatio) external onlyOwner {
        checkTimelock(keccak256(abi.encode("UPDATE_REBALANCE_RATIO", _newRatio)));
        rebalanceRatio = _newRatio;
    }

    // Propose / Execute Pause
    function proposePause() external onlyOwner {
        queueAction(keccak256(abi.encode("PAUSE")));
    }

    function executePause() external onlyOwner {
        checkTimelock(keccak256(abi.encode("PAUSE")));
        paused = true;
        emit Paused(msg.sender);
    }

    // Propose / Execute Unpause
    function proposeUnpause() external onlyOwner {
        queueAction(keccak256(abi.encode("UNPAUSE")));
    }

    function executeUnpause() external onlyOwner {
        checkTimelock(keccak256(abi.encode("UNPAUSE")));
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ── Non-timelocked Admin ──

    function updateOperator(address _newOp) external onlyOwner {
        if (_newOp == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, _newOp);
        operator = _newOp;
    }

    function updateMaxSlippage(uint256 _newBps) external onlyOwner {
        if (_newBps > 1000) revert InvalidSlippage(_newBps); // max 10%
        maxSlippageBps = _newBps;
    }

    // ── Views ──

    function vaultUsdcBalance() external view returns (uint256) { return usdc.balanceOf(address(this)); }
    function vaultWethBalance() external view returns (uint256) { return weth.balanceOf(address(this)); }
    function getEthPrice() external view returns (uint256) { return _getEthPrice(); }

    // ── Internal Helpers ──

    function _checkAndUpdateEpochLimits(uint256 amount, bool isUsdc) internal {
        if (block.timestamp >= currentEpochStart + epochLength) {
            currentEpochStart = block.timestamp;
            usdcWithdrawnThisEpoch = 0;
            wethWithdrawnThisEpoch = 0;
            
            // Set cap to 20% of current contract balances
            maxUsdcWithdrawalPerEpoch = (usdc.balanceOf(address(this)) * 2000) / MAX_BPS;
            maxWethWithdrawalPerEpoch = (weth.balanceOf(address(this)) * 2000) / MAX_BPS;
            
            // Minimum limits to prevent bricking when balances are low
            if (maxUsdcWithdrawalPerEpoch < 1000 * 1e6) maxUsdcWithdrawalPerEpoch = 1000 * 1e6;
            if (maxWethWithdrawalPerEpoch < 1e17) maxWethWithdrawalPerEpoch = 1e17;
        }

        if (isUsdc) {
            require(usdcWithdrawnThisEpoch + amount <= maxUsdcWithdrawalPerEpoch, "Epoch USDC withdrawal limit exceeded");
            usdcWithdrawnThisEpoch += amount;
        } else {
            require(wethWithdrawnThisEpoch + amount <= maxWethWithdrawalPerEpoch, "Epoch WETH withdrawal limit exceeded");
            wethWithdrawnThisEpoch += amount;
        }
    }

    function _swapUsdcToWeth(uint256 ethPrice, uint256 minOut) internal view returns (uint256, uint256) {
        uint256 usdcBal = usdc.balanceOf(address(this));
        uint256 toSwap = (usdcBal * rebalanceRatio) / MAX_BPS;
        if (toSwap == 0) return (0, 0);
        uint256 wethOut = (toSwap * 1e20) / (ethPrice * 1e6);
        uint256 wethMin = (wethOut * (MAX_BPS - maxSlippageBps)) / MAX_BPS;
        uint256 effectiveMin = minOut > wethMin ? minOut : wethMin;
        if (wethOut < effectiveMin) revert SlippageExceeded(effectiveMin, wethOut);
        return (toSwap, wethOut);
    }

    function _swapWethToUsdc(uint256 ethPrice, uint256 minOut) internal view returns (uint256, uint256) {
        uint256 wethBal = weth.balanceOf(address(this));
        uint256 toSwap = (wethBal * rebalanceRatio) / MAX_BPS;
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
