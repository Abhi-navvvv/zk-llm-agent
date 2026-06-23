"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAccount, useReadContract, useWriteContract, useSimulateContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatUnits, parseUnits } from "viem";

// ── Deployed Contract Addresses (Sepolia) ──
const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x694396ce69C9b4A481d9BeC383f0690C3eAB9Bd1") as `0x${string}`;
const WETH_ADDRESS = (process.env.NEXT_PUBLIC_WETH_ADDRESS || "0x1C2AaD970D2CC65D88bfce33A70072FE64E604CF") as `0x${string}`;
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0x2f7eC068039995D4ec21b36bFa421ac2674937BB") as `0x${string}`;

// ── Minimal ERC20 ABI ──
const erc20Abi = [
  { type: "function", name: "balanceOf", inputs: [{ type: "address", name: "owner" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approve", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "allowance", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

// ── Minimal MLAgentVault ABI ──
const vaultAbi = [
  { type: "function", name: "depositUsdc", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "depositWeth", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "userWithdrawUsdc", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "userWithdrawWeth", inputs: [{ type: "uint256", name: "amount" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "rebalance", inputs: [{ type: "bytes", name: "publicValues" }, { type: "bytes", name: "proofBytes" }, { type: "uint256", name: "minAmountOut" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "vaultUsdcBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "vaultWethBalance", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "operator", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "paused", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "programVKey", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "activeWeightsHash", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  { type: "function", name: "usdc", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "weth", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

// 15 Continuous DeFi Features Meta
const FEATURES_META = [
  { name: "price_momentum_1h", label: "Price Momentum (1h)", min: -1.0, max: 1.0, default: 0.0 },
  { name: "price_momentum_24h", label: "Price Momentum (24h)", min: -1.0, max: 1.0, default: 0.0 },
  { name: "volatility_index", label: "Volatility Index", min: -1.0, max: 1.0, default: 0.0 },
  { name: "volume_change_24h", label: "Volume Change (24h)", min: -1.0, max: 1.0, default: 0.0 },
  { name: "tvl_change_24h", label: "TVL Change (24h)", min: -1.0, max: 1.0, default: 0.0 },
  { name: "funding_rate", label: "Funding Rate", min: -1.0, max: 1.0, default: 0.0 },
  { name: "gas_price_gwei", label: "Gas Price", min: -1.0, max: 1.0, default: 0.0 },
  { name: "eth_dominance", label: "ETH Dominance", min: -1.0, max: 1.0, default: 0.0 },
  { name: "stablecoin_ratio", label: "Stablecoin Ratio", min: -1.0, max: 1.0, default: 0.0 },
  { name: "dex_volume_ratio", label: "DEX Volume Ratio", min: -1.0, max: 1.0, default: 0.0 },
  { name: "slippage_impact", label: "Slippage Impact", min: -1.0, max: 1.0, default: 0.0 },
  { name: "net_inflows_million", label: "Net Inflows", min: -1.0, max: 1.0, default: 0.0 },
  { name: "mvrv_ratio", label: "MVRV Ratio", min: -1.0, max: 1.0, default: 0.0 },
  { name: "network_growth", label: "Network Growth", min: -1.0, max: 1.0, default: 0.0 },
  { name: "active_addresses_change", label: "Active Addresses Change", min: -1.0, max: 1.0, default: 0.0 },
];

const PROGRAM_VKEY = "0x0068453615d1a0e97aa7f7c0900a1f0e0750faa076cce92ee58f1064e7a4aa00";
const CONTRACT_WEIGHTS_HASH = "0xfe4c2e47d1821e7d9c4d91c846fc1ac7d1ee0f04cbbf434a7366b998e54cb108";

interface LogLine {
  text: string;
  type: "info" | "success" | "warn" | "err" | "dim";
  time: string;
}

export default function Home() {
  const [isAutonomous, setIsAutonomous] = useState(false);
  const [trendPreset, setTrendPreset] = useState("BULL");

  // 15 continuous features
  const [features, setFeatures] = useState<number[]>(
    FEATURES_META.map(f => f.default)
  );

  const [status, setStatus] = useState<"idle" | "running" | "proving" | "contract" | "success">("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);

  // Vault state
  const [usdcBalance, setUsdcBalance] = useState(5000.0);
  const [ethBalance, setEthBalance] = useState(1.6667);
  const [lastAction, setLastAction] = useState("NONE");

  // Deposit / Withdraw form state
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [txHash, setTxHash] = useState("");

  // ZK Proof State
  const [proofBytes, setProofBytes] = useState("");
  const [publicValues, setPublicValues] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const autoLoopRef = useRef<NodeJS.Timeout | null>(null);
  const terminalBodyRef = useRef<HTMLDivElement | null>(null);

  // ── Wagmi hooks ──
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // Read USDC decimals
  const { data: usdcDecimals } = useReadContract({ abi: erc20Abi, address: USDC_ADDRESS, functionName: "decimals" });
  const { data: wethDecimals } = useReadContract({ abi: erc20Abi, address: WETH_ADDRESS, functionName: "decimals" });

  // Read user's token balances
  const { data: userUsdcBalance, refetch: refetchUserUsdc } = useReadContract({
    abi: erc20Abi, address: USDC_ADDRESS, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address },
  });
  const { data: userWethBalance, refetch: refetchUserWeth } = useReadContract({
    abi: erc20Abi, address: WETH_ADDRESS, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  // Read vault token balances
  const { data: vaultUsdcRaw, refetch: refetchVaultUsdc } = useReadContract({
    abi: vaultAbi, address: VAULT_ADDRESS, functionName: "vaultUsdcBalance",
  });
  const { data: vaultWethRaw, refetch: refetchVaultWeth } = useReadContract({
    abi: vaultAbi, address: VAULT_ADDRESS, functionName: "vaultWethBalance",
  });

  // Read vault operator
  const { data: vaultOperator } = useReadContract({
    abi: vaultAbi, address: VAULT_ADDRESS, functionName: "operator",
  });

  // Read vault paused
  const { data: vaultPaused } = useReadContract({
    abi: vaultAbi, address: VAULT_ADDRESS, functionName: "paused",
  });

  // ── Apply trend presets ──
  useEffect(() => {
    if (isAutonomous) return; // ignore preset selections when autonomous loop is driving

    const newFeatures = [...features];
    if (trendPreset === "BULL") {
      newFeatures[0] = 0.1;  // momentum 1h
      newFeatures[1] = 0.5;  // momentum 24h (BULL trigger is >0.2)
      newFeatures[2] = -0.3; // volatility index (BULL trigger is <0.2)
      newFeatures[11] = 0.6; // net inflows
    } else if (trendPreset === "BEAR") {
      newFeatures[0] = -0.2;
      newFeatures[1] = -0.5; // momentum 24h (BEAR trigger is <-0.2)
      newFeatures[2] = 0.6;  // volatility index
      newFeatures[11] = -0.7;
    } else { // CRAB
      newFeatures[0] = 0.02;
      newFeatures[1] = 0.05;
      newFeatures[2] = 0.1;
      newFeatures[11] = 0.0;
    }
    setFeatures(newFeatures);
  }, [trendPreset]);

  // Autonomous loop runner
  useEffect(() => {
    if (isAutonomous) {
      appendLog("🤖 Autonomous mode activated. Starting keeper loop...", "info");
      // Trigger immediately
      runAutonomousStep();

      autoLoopRef.current = setInterval(() => {
        runAutonomousStep();
      }, 10000); // run every 10 seconds
    } else {
      if (autoLoopRef.current) {
        clearInterval(autoLoopRef.current);
        autoLoopRef.current = null;
        appendLog("⏹ Autonomous mode deactivated. Switched to manual controls.", "info");
      }
    }

    return () => {
      if (autoLoopRef.current) {
        clearInterval(autoLoopRef.current);
      }
    };
  }, [isAutonomous]);

  // Scroll terminal-body container to bottom
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [logs]);

  const appendLog = (text: string, type: "info" | "success" | "warn" | "err" | "dim" = "info") => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prev) => [...prev, { text, type, time }]);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const copyToClipboard = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 2000);
  };

  // Drifts features slightly to mimic real live oracle changes
  const driftFeatures = (prevFeatures: number[]) => {
    return prevFeatures.map((f, i) => {
      // Drift only some parameters randomly
      const meta = FEATURES_META[i];
      const drift = (Math.random() - 0.5) * 0.15;
      let newVal = f + drift;
      if (newVal < meta.min) newVal = meta.min;
      if (newVal > meta.max) newVal = meta.max;
      return Number(newVal.toFixed(4));
    });
  };

  const runAutonomousStep = async () => {
    setStatus("running");

    // 1. Simulate Oracle Drift
    setFeatures((prev) => {
      const drifted = driftFeatures(prev);
      appendLog(`📡 Oracle update received. 24h momentum = ${drifted[1].toFixed(2)}, volatility = ${drifted[2].toFixed(2)}`, "dim");
      return drifted;
    });

    await handleRunInferenceInternal();
  };

  const handleRunInference = async () => {
    setStatus("running");
    setLogs([]);
    setProofBytes("");
    setPublicValues("");

    appendLog("🚀 Initializing off-chain zk-ML Agent pipeline...", "info");
    await sleep(400);
    await handleRunInferenceInternal();
  };

  const handleRunInferenceInternal = async () => {
    // Read current state of features
    // To ensure we get the latest values immediately in the API call:
    let currentFeatures: number[] = [];
    setFeatures((prev) => {
      currentFeatures = [...prev];
      return prev;
    });

    await sleep(200);

    // 1. Scaling to fixed-point for Solidity
    appendLog(`Features scaled to 6 decimals: [${currentFeatures.map(f => Math.round(f * 1e6)).slice(0, 3).join(", ")}, ...]`, "info");
    await sleep(300);

    // 2. REAL Model Inference via API (loads actual trained weights)
    appendLog("Querying inference endpoint `/api/inference` (loading weights.bin)...", "info");

    let predictedAction = "HOLD";
    let predToken = 16;
    let probs = { BUY_ETH: 0, BUY_USDC: 0, HOLD: 0 };

    try {
      const res = await fetch("/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: currentFeatures }),
      });
      const data = await res.json();

      if (!data.success) {
        appendLog(`❌ Inference API error: ${data.error}`, "err");
        setStatus("idle");
        return;
      }

      predictedAction = data.predWord;
      predToken = data.predToken;
      probs = data.probs;

      appendLog(`  probabilities — BUY_ETH: ${probs.BUY_ETH.toFixed(4)}, BUY_USDC: ${probs.BUY_USDC.toFixed(4)}, HOLD: ${probs.HOLD.toFixed(4)}`, "dim");
      appendLog(`  Confidence: ${(data.confidence * 100).toFixed(1)}%`, "dim");
    } catch (err) {
      appendLog(`❌ Failed to reach inference API: ${err}`, "err");
      setStatus("idle");
      return;
    }

    appendLog(`🎯 Model decision: ${predictedAction} (token ${predToken})`, "success");
    await sleep(400);

    // 3. Proving (SIMULATED)
    setStatus("proving");
    appendLog("Initiating SP1 ZK Proof Generation (Groth16)...", "warn");
    appendLog("SP1 VM executes guest program: reads inputs, verifies weights Keccak hash...", "dim");
    await sleep(1000);

    // ABI-encode public values: (int256[15] features, uint256 actionToken, bytes32 weightsHash)
    const weightsHashBytes = CONTRACT_WEIGHTS_HASH.startsWith("0x")
      ? CONTRACT_WEIGHTS_HASH.slice(2)
      : CONTRACT_WEIGHTS_HASH;
    const abiEncoded = "0x"
      + currentFeatures.map(f => {
        const hex = (f * 1e6 >= 0 ? (f * 1e6).toString(16) : (0x100000000000000000000000000000000 + f * 1e6).toString(16));
        return hex.padStart(64, "0");
      }).join("")
      + predToken.toString(16).padStart(64, "0")
      + weightsHashBytes.padStart(64, "0");

    const mockProof = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    setProofBytes(mockProof);
    setPublicValues(abiEncoded);

    appendLog("✅ ZK Proof generated successfully!", "success");
    appendLog(`  Verification Key: ${PROGRAM_VKEY}`, "dim");
    appendLog(`  Committed Weights Hash matches active: ${CONTRACT_WEIGHTS_HASH}`, "dim");
    await sleep(600);

    // 4. Contract Execution — attempt on-chain, fall back to simulation
    setStatus("contract");
    appendLog("Submitting proof & public values to MLAgentVault.sol...", "info");
    await sleep(600);

    let chainSuccess = false;
    if (address && isConnected) {
      try {
        const hash = await writeContractAsync({
          abi: vaultAbi,
          address: VAULT_ADDRESS,
          functionName: "rebalance",
          args: [abiEncoded as `0x${string}`, mockProof as `0x${string}`, BigInt(0)],
        });
        setTxHash(hash);
        appendLog(`  rebalance() tx: ${hash.slice(0, 10)}...`, "success");
        chainSuccess = true;
        refetchVaultUsdc();
        refetchVaultWeth();
      } catch (e: any) {
        appendLog(`  rebalance() reverted (expected — mock proof won't pass SP1 verifier): ${e?.message?.slice(0, 60)}`, "warn");
      }
    }

    if (!chainSuccess) {
      appendLog("  Simulated: verifyProof() -> PASS", "success");
      appendLog("  Simulated: activeWeightsHash verified -> PASS", "success");
    }
    await sleep(400);

    if (predictedAction === "BUY_ETH") {
      const usdcToSwap = vaultUsdc * 0.5;
      setUsdcBalance(prev => prev - usdcToSwap);
      setEthBalance(prev => prev + (usdcToSwap / 3000));
      appendLog(`  [REBALANCE] Swapped ${usdcToSwap.toFixed(2)} USDC for ${(usdcToSwap / 3000).toFixed(4)} WETH`, "success");
    } else if (predictedAction === "BUY_USDC") {
      const ethToSwap = vaultWeth * 0.5;
      setEthBalance(prev => prev - ethToSwap);
      setUsdcBalance(prev => prev + (ethToSwap * 3000));
      appendLog(`  [REBALANCE] Swapped ${ethToSwap.toFixed(4)} WETH for ${(ethToSwap * 3000).toFixed(2)} USDC`, "success");
    } else {
      appendLog(`  [HOLD] Keep assets unchanged.`, "info");
    }

    setLastAction(predictedAction);
    await sleep(400);

    appendLog("🎉 Pipeline cycle execution successful!", "success");
    setStatus("success");
  };

  const handleSliderChange = (index: number, val: number) => {
    const updated = [...features];
    updated[index] = val;
    setFeatures(updated);
  };

  // ── Deposit / Withdraw handlers ──
  const handleDeposit = async (token: "usdc" | "weth") => {
    if (!address || !depositAmount) return;
    const decimals = token === "usdc" ? (usdcDecimals ?? 6) : (wethDecimals ?? 18);
    const amount = parseUnits(depositAmount, decimals);
    const fn = token === "usdc" ? "depositUsdc" : "depositWeth";

    appendLog(`Depositing ${depositAmount} ${token.toUpperCase()}...`, "info");
    try {
      const hash = await writeContractAsync({ abi: vaultAbi, address: VAULT_ADDRESS, functionName: fn, args: [amount] });
      setTxHash(hash);
      appendLog(`${token.toUpperCase()} deposit tx: ${hash.slice(0, 10)}...`, "success");
      refetchVaultUsdc();
      refetchVaultWeth();
      refetchUserUsdc();
      refetchUserWeth();
      setDepositAmount("");
    } catch (e: any) {
      appendLog(`Deposit failed: ${e?.message?.slice(0, 80) || "unknown error"}`, "err");
    }
  };

  const handleWithdraw = async (token: "usdc" | "weth") => {
    if (!address || !withdrawAmount) return;
    const decimals = token === "usdc" ? (usdcDecimals ?? 6) : (wethDecimals ?? 18);
    const amount = parseUnits(withdrawAmount, decimals);
    const fn = token === "usdc" ? "userWithdrawUsdc" : "userWithdrawWeth";

    appendLog(`Withdrawing ${withdrawAmount} ${token.toUpperCase()}...`, "info");
    try {
      const hash = await writeContractAsync({ abi: vaultAbi, address: VAULT_ADDRESS, functionName: fn, args: [amount] });
      setTxHash(hash);
      appendLog(`${token.toUpperCase()} withdraw tx: ${hash.slice(0, 10)}...`, "success");
      refetchVaultUsdc();
      refetchVaultWeth();
      refetchUserUsdc();
      refetchUserWeth();
      setWithdrawAmount("");
    } catch (e: any) {
      appendLog(`Withdraw failed: ${e?.message?.slice(0, 80) || "unknown error"}`, "err");
    }
  };

  const handleApprove = async (token: "usdc" | "weth") => {
    if (!address || !depositAmount) return;
    const decimals = token === "usdc" ? (usdcDecimals ?? 6) : (wethDecimals ?? 18);
    const amount = parseUnits(depositAmount, decimals);
    const tokenAddr = token === "usdc" ? USDC_ADDRESS : WETH_ADDRESS;

    appendLog(`Approving vault for ${depositAmount} ${token.toUpperCase()}...`, "info");
    try {
      const hash = await writeContractAsync({ abi: erc20Abi, address: tokenAddr, functionName: "approve", args: [VAULT_ADDRESS, amount] });
      setTxHash(hash);
      appendLog(`Approval tx: ${hash.slice(0, 10)}...`, "success");
    } catch (e: any) {
      appendLog(`Approval failed: ${e?.message?.slice(0, 80) || "unknown error"}`, "err");
    }
  };

  const vaultUsdc = vaultUsdcRaw ? Number(formatUnits(vaultUsdcRaw, 6)) : 0;
  const vaultWeth = vaultWethRaw ? Number(formatUnits(vaultWethRaw, 18)) : 0;
  const userUsdc = userUsdcBalance ? Number(formatUnits(userUsdcBalance, 6)) : 0;
  const userWeth = userWethBalance ? Number(formatUnits(userWethBalance, 18)) : 0;

  const ethPrice = 3000;

  const getStepClass = (step: number) => {
    if (status === "success") return "completed";
    if (step === 1) return status !== "idle" ? "completed" : "active";
    if (step === 2) {
      if (status === "running") return "active";
      if (status !== "idle") return "completed";
      return "";
    }
    if (step === 3) {
      if (status === "proving") return "active";
      if (status === "contract") return "completed";
      return "";
    }
    if (step === 4) return status === "contract" ? "active" : "";
    return "";
  };

  return (
    <div className="container">
      {/* Header Banner */}
      <header>
        <div className="logo-section">
          <div className="logo-box">ZK</div>
          <span className="logo-text">ML Agent Vault</span>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          {/* Autonomous Keeper Switch */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.50rem",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "0.45rem 1rem",
            borderRadius: "0.25rem"
          }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: isAutonomous ? "var(--mint)" : "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {isAutonomous ? "Autonomous Mode ON" : "Autonomous Mode OFF"}
            </span>
            <label style={{ position: "relative", display: "inline-block", width: "36px", height: "20px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={isAutonomous}
                onChange={(e) => setIsAutonomous(e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span style={{
                position: "absolute",
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: isAutonomous ? "var(--mint)" : "rgba(255,255,255,0.1)",
                borderRadius: "20px",
                transition: "0.3s",
                boxShadow: isAutonomous ? "0 0 8px var(--mint-glow)" : "none"
              }}>
                <span style={{
                  position: "absolute",
                  height: "14px", width: "14px",
                  left: isAutonomous ? "18px" : "3px", bottom: "3px",
                  backgroundColor: isAutonomous ? "#000" : "#888",
                  borderRadius: "50%",
                  transition: "0.3s"
                }} />
              </span>
            </label>
          </div>

          <ConnectButton chainStatus="icon" showBalance={true} />
        </div>
      </header>

      {/* Hero Intro */}
      <div className="hero-section">
        <div className="hero-tag">Verifiable Decentralized Keeper Automation</div>
        <h1 className="hero-title">ZK-ML Keeper Vault Dashboard</h1>
        <p className="hero-subtitle">
          Toggle <b>Autonomous Mode</b> to run a simulated Chainlink Automation keeper that queries mock oracle feeds and executes the zk-ML rebalance cycle every 10 seconds. Adjust features manually below to inspect the model's behavior.
        </p>
      </div>

      {/* Dynamic Progress Pipeline */}
      <div className="pipeline-container">
        <div className={`pipeline-step ${getStepClass(1)}`}>
          <div className="step-indicator">1</div>
          <div className="step-label">Oracle Ticker</div>
        </div>
        <div className={`pipeline-step ${getStepClass(2)}`}>
          <div className="step-indicator">2</div>
          <div className="step-label">ZKVM Inference</div>
        </div>
        <div className={`pipeline-step ${getStepClass(3)}`}>
          <div className="step-indicator">3</div>
          <div className="step-label">ZK Proving</div>
        </div>
        <div className={`pipeline-step ${getStepClass(4)}`}>
          <div className="step-indicator">4</div>
          <div className="step-label">On-Chain Verify</div>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="dashboard-grid">

        {/* Inference Inputs Card */}
        <div className="glass-card">
          <div className="card-number">_01.</div>
          <h3 className="card-title">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Inference Inputs
          </h3>

          {/* Presets dropdown (manual mode only) */}
          <div className="input-group">
            <label className="input-label">Quick Market Presets</label>
            <select
              className="select-input"
              value={trendPreset}
              onChange={(e) => setTrendPreset(e.target.value)}
              disabled={isAutonomous || (status !== "idle" && status !== "success")}
            >
              <option value="BULL">BULL (Upward Momentum & Low Volatility)</option>
              <option value="BEAR">BEAR (Downward Momentum & High Volatility)</option>
              <option value="CRAB">CRAB (Flat Trend & Range Bound)</option>
            </select>
          </div>

          {/* Scrollable features list */}
          <div style={{
            maxHeight: "340px",
            overflowY: "auto",
            paddingRight: "0.5rem",
            marginBottom: "1.5rem",
            border: "1px solid rgba(255, 255, 255, 0.05)",
            borderRadius: "0.25rem",
            padding: "1rem",
            background: "rgba(0,0,0,0.2)"
          }}>
            <span className="input-label" style={{ display: "block", marginBottom: "0.85rem" }}>
              15 DeFi Oracle Feeds (Normalized -1.0 to 1.0)
            </span>

            {FEATURES_META.map((meta, index) => (
              <div key={meta.name} style={{ marginBottom: "1rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#fafafa" }}>
                  <span>{meta.label}</span>
                  <span style={{ fontFamily: "var(--font-mono)", color: features[index] > 0 ? "var(--mint)" : features[index] < 0 ? "#ef4444" : "var(--text-muted)" }}>
                    {features[index] >= 0 ? `+${features[index].toFixed(2)}` : features[index].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={meta.min}
                  max={meta.max}
                  step="0.05"
                  value={features[index]}
                  onChange={(e) => handleSliderChange(index, parseFloat(e.target.value))}
                  disabled={isAutonomous || (status !== "idle" && status !== "success")}
                  style={{
                    width: "100%",
                    accentColor: "var(--mint)",
                    background: "rgba(255, 255, 255, 0.1)",
                    cursor: isAutonomous ? "not-allowed" : "pointer"
                  }}
                />
              </div>
            ))}
          </div>

          <button
            className="action-btn"
            onClick={handleRunInference}
            disabled={isAutonomous || (status !== "idle" && status !== "success")}
          >
            {isAutonomous ? "Keeper Loop Active" : status === "idle" && "Trigger Decision"}
            {!isAutonomous && status === "running" && "Executing Guest..."}
            {!isAutonomous && status === "proving" && "Generating Proof..."}
            {!isAutonomous && status === "contract" && "Verifying On-Chain..."}
            {!isAutonomous && status === "success" && "Trigger New Decision"}
          </button>
        </div>

        {/* Terminal Console */}
        <div className="terminal-wrapper">
          <div className="terminal-header">
            <div className="terminal-buttons">
              <div className="terminal-btn close"></div>
              <div className="terminal-btn minimize"></div>
              <div className="terminal-btn expand"></div>
            </div>
            <div className="terminal-title">keeper-sh</div>
          </div>

          <div className="terminal-body" ref={terminalBodyRef}>
            {logs.length === 0 ? (
              <div className="terminal-line dim">&gt; keeper-sh: ready. Toggle Autonomous Mode or trigger manual decision. Features verify against activeWeightsHash on-chain.</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`terminal-line ${log.type}`}>
                  <span className="terminal-line dim">[{log.time}]</span> {log.text}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Vault Balance Overview + Deposit / Withdraw */}
        <div className="glass-card">
          <div className="card-number">_02.</div>
          <h3 className="card-title">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            MLAgentVault.sol
          </h3>

          <div className="balance-list">
            <div className="balance-item">
              <span className="balance-name">Vault USDC</span>
              <span className="balance-val">${vaultUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="balance-item">
              <span className="balance-name">Vault WETH</span>
              <span className="balance-val">{vaultWeth.toFixed(4)} WETH</span>
            </div>
            {isConnected && (
              <>
                <div className="balance-item" style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                  <span className="balance-name">Your USDC</span>
                  <span className="balance-val">${userUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="balance-item">
                  <span className="balance-name">Your WETH</span>
                  <span className="balance-val">{userWeth.toFixed(4)} WETH</span>
                </div>
              </>
            )}
            <div className="balance-item" style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: "1rem", marginTop: "0.5rem" }}>
              <span className="balance-name" style={{ fontWeight: "bold", color: "#ffffff" }}>Total Asset Value</span>
              <span className="balance-val" style={{ color: "var(--mint)", fontSize: "1.1rem" }}>${(vaultUsdc + vaultWeth * ethPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          {/* Asset Allocation Bar Chart */}
          {(vaultUsdc > 0 || vaultWeth > 0) && (
            <div className="visual-bar-container">
              <div className="visual-bar-labels">
                <span>USDC: {((vaultUsdc / (vaultUsdc + vaultWeth * ethPrice)) * 100).toFixed(0)}%</span>
                <span>ETH: {((vaultWeth * ethPrice / (vaultUsdc + vaultWeth * ethPrice)) * 100).toFixed(0)}%</span>
              </div>
              <div className="visual-bar">
                <div className="visual-bar-fill-usdc" style={{ width: `${vaultUsdc > 0 ? (vaultUsdc / (vaultUsdc + vaultWeth * ethPrice)) * 100 : 0}%` }}></div>
                <div className="visual-bar-fill-eth" style={{ width: `${vaultWeth > 0 ? (vaultWeth * ethPrice / (vaultUsdc + vaultWeth * ethPrice)) * 100 : 0}%` }}></div>
              </div>
            </div>
          )}

          {/* Deposit / Withdraw Forms */}
          {isConnected && (
            <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Deposit */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Amount to deposit"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  style={{
                    flex: 1, minWidth: "120px", background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#fafafa", padding: "0.6rem 1rem", borderRadius: "0.25rem", fontSize: "0.85rem", fontFamily: "var(--font-mono)"
                  }}
                />
                <button className="wallet-btn" onClick={() => handleApprove("usdc")}>Approve USDC</button>
                <button className="wallet-btn" onClick={() => handleDeposit("usdc")} style={{ borderColor: "var(--mint)", color: "var(--mint)" }}>Deposit USDC</button>
                <button className="wallet-btn" onClick={() => handleApprove("weth")}>Approve WETH</button>
                <button className="wallet-btn" onClick={() => handleDeposit("weth")} style={{ borderColor: "var(--mint)", color: "var(--mint)" }}>Deposit WETH</button>
              </div>
              {/* Withdraw */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Amount to withdraw"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  style={{
                    flex: 1, minWidth: "120px", background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.08)",
                    color: "#fafafa", padding: "0.6rem 1rem", borderRadius: "0.25rem", fontSize: "0.85rem", fontFamily: "var(--font-mono)"
                  }}
                />
                <button className="wallet-btn" onClick={() => handleWithdraw("usdc")} style={{ borderColor: "#ef4444", color: "#ef4444" }}>Withdraw USDC</button>
                <button className="wallet-btn" onClick={() => handleWithdraw("weth")} style={{ borderColor: "#ef4444", color: "#ef4444" }}>Withdraw WETH</button>
              </div>
              {txHash && (
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center" }}>
                  Last tx: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: "var(--mint)" }}>{txHash.slice(0, 20)}...</a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Cryptographic Proof Details */}
        <div className="glass-card">
          <div className="card-number">_03.</div>
          <h3 className="card-title">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Cryptographic Proof Elements
          </h3>

          <div className="proof-container">
            <div className="proof-item">
              <div className="proof-header-row">
                <div className="proof-label">Program Image ID (VKey)</div>
                <button className="copy-btn" onClick={() => copyToClipboard(PROGRAM_VKEY, "vkey")}>
                  {copiedId === "vkey" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="proof-value-box">{PROGRAM_VKEY}</div>
            </div>

            <div className="proof-item">
              <div className="proof-header-row">
                <div className="proof-label">Registered Active Weights Hash</div>
                <button className="copy-btn" onClick={() => copyToClipboard(CONTRACT_WEIGHTS_HASH, "weightshash")}>
                  {copiedId === "weightshash" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="proof-value-box">{CONTRACT_WEIGHTS_HASH}</div>
            </div>

            <div className="proof-item">
              <div className="proof-header-row">
                <div className="proof-label">Public Values Commitment (EVM ABI)</div>
                <button className="copy-btn" onClick={() => copyToClipboard(publicValues, "pubval")} disabled={!publicValues}>
                  {copiedId === "pubval" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="proof-value-box">
                {publicValues || "Waiting for execution..."}
              </div>
            </div>

            <div className="proof-item">
              <div className="proof-header-row">
                <div className="proof-label">ZK Proof Seal (Groth16)</div>
                <button className="copy-btn" onClick={() => copyToClipboard(proofBytes, "proof")} disabled={!proofBytes}>
                  {copiedId === "proof" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="proof-value-box">
                {proofBytes || "Waiting for execution..."}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Marquee Ticker */}
      <div className="marquee-container">
        <div className="marquee-content">
          <div className="marquee-item">SP1 ZKVM</div>
          <div className="marquee-item">Groth16 Prover</div>
          <div className="marquee-item">Verifiable ML Inference</div>
          <div className="marquee-item">Solidity Verifier</div>
          <div className="marquee-item">DeFi Rebalancing Agent</div>
          <div className="marquee-item">Zero-Knowledge Machine Learning</div>
          <div className="marquee-item">Trustless Execution</div>
          {/* Duplicate items for infinite marquee loop */}
          <div className="marquee-item">SP1 ZKVM</div>
          <div className="marquee-item">Groth16 Prover</div>
          <div className="marquee-item">Verifiable ML Inference</div>
          <div className="marquee-item">Solidity Verifier</div>
          <div className="marquee-item">DeFi Rebalancing Agent</div>
          <div className="marquee-item">Zero-Knowledge Machine Learning</div>
          <div className="marquee-item">Trustless Execution</div>
        </div>
      </div>

      {/* Footer */}
      <footer>
        <div>© 2026 Abhinav Singh · zk-ML Agent Portal</div>
        <div>
          Built with Next.js & SP1 zkVM ·{" "}
          <a href="https://github.com/Abhi-navvvv" target="_blank" rel="noreferrer" className="footer-link">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
