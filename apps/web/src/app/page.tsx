"use client";

import React, { useState } from "react";

// Definitions matching Python config.json
const VOCAB_MAP: Record<string, number> = {
  "<pad>": 0, "<bos>": 1, "<eos>": 2, 
  "MARKET": 3, "BULL": 4, "BEAR": 5, "CRAB": 6,
  "VOLATILITY": 7, "HIGH": 8, "LOW": 9,
  "TREND": 10, "UP": 11, "DOWN": 12,
  "ACTION": 13, "BUY_ETH": 14, "BUY_USDC": 15, "HOLD": 16
};

const PROGRAM_VKEY = "0x00fa32d18408f62f32194b150ce10b9a8a926127bc0f7ea80238c92aef10e74f";

interface LogLine {
  text: string;
  type: "info" | "success" | "warn" | "err" | "dim";
  time: string;
}

export default function Home() {
  const [trend, setTrend] = useState("BULL");
  const [volatility, setVolatility] = useState("LOW");
  const [status, setStatus] = useState<"idle" | "running" | "proving" | "contract" | "success">("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  
  // Vault state
  const [usdcBalance, setUsdcBalance] = useState(10000.0);
  const [ethBalance, setEthBalance] = useState(0.0);
  const [lastAction, setLastAction] = useState("NONE");
  
  // ZK Proof State
  const [proofBytes, setProofBytes] = useState("");
  const [publicValues, setPublicValues] = useState("");

  const appendLog = (text: string, type: "info" | "success" | "warn" | "err" | "dim" = "info") => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prev) => [...prev, { text, type, time }]);
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const handleRunInference = async () => {
    setStatus("running");
    setLogs([]);
    setProofBytes("");
    setPublicValues("");
    
    appendLog("🚀 Initializing off-chain zk-LLM Agent pipeline...", "info");
    await sleep(800);
    
    // 1. Tokenization
    appendLog(`Tokenizing input parameters: Trend = ${trend}, Volatility = ${volatility}`, "info");
    const prompt = ["<bos>", "MARKET", trend, "VOLATILITY", volatility, "ACTION"];
    const inputIdx = prompt.map(t => VOCAB_MAP[t]);
    while (inputIdx.length < 8) {
      inputIdx.push(VOCAB_MAP["<pad>"]);
    }
    await sleep(800);
    appendLog(`Generated input tokens: [${inputIdx.join(", ")}]`, "dim");
    await sleep(600);

    // 2. Guest Execution
    appendLog("Booting guest program inside SP1 zkVM executor (RV32IM)...", "info");
    await sleep(1000);
    appendLog("Loading model weight constraints... W_emb=[17,8], W1=[8,16], W2=[16,3]", "dim");
    await sleep(600);
    appendLog("Executing Model Forward Pass:", "info");
    
    // Evaluate model logic
    let predictedAction = "HOLD";
    let predToken = 16;
    let logits = [0.1, 0.1, 0.8]; // Defaults for HOLD
    
    if (trend === "BULL" && volatility === "LOW") {
      predictedAction = "BUY_ETH";
      predToken = 14;
      logits = [0.92, 0.03, 0.05];
    } else if (trend === "BEAR" && volatility === "LOW") {
      predictedAction = "BUY_USDC";
      predToken = 15;
      logits = [0.04, 0.89, 0.07];
    } else {
      predictedAction = "HOLD";
      predToken = 16;
      logits = [0.12, 0.08, 0.80];
    }
    
    await sleep(800);
    appendLog(`  Embedding mean pooling resolved shape: [8]`, "dim");
    await sleep(500);
    appendLog(`  Layer 1 MLP activation (ReLU) completed. Cycles: 142`, "dim");
    await sleep(700);
    appendLog(`  Layer 2 Logits: BUY_ETH: ${logits[0].toFixed(4)}, BUY_USDC: ${logits[1].toFixed(4)}, HOLD: ${logits[2].toFixed(4)}`, "dim");
    await sleep(600);
    appendLog(`🎯 Model inference succeeded. Decision: ${predictedAction} (token ${predToken})`, "success");
    await sleep(800);

    // 3. Proving
    setStatus("proving");
    appendLog("Initiating ZK Proof Generation (Groth16 wrapper)...", "warn");
    appendLog("Generating witness data from instruction trace...", "dim");
    await sleep(1200);
    appendLog("Fusing arithmetic constraints... Proving 3,142 instructions", "dim");
    await sleep(1500);
    
    // Mock proof hex values
    const mockProof = "0x" + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join("");
    const mockPublicValues = "0x" + Array.from({length: 32}, () => Math.floor(Math.random()*16).toString(16)).join("");
    
    setProofBytes(mockProof);
    setPublicValues(mockPublicValues);
    
    appendLog("✅ Zero-Knowledge Proof generated successfully!", "success");
    appendLog(`  Proof Size: 256 bytes`, "dim");
    appendLog(`  Program Image ID: ${PROGRAM_VKEY}`, "dim");
    await sleep(1000);

    // 4. Contract Execution
    setStatus("contract");
    appendLog("Submitting verified payload to LLMAgentVault.sol...", "info");
    appendLog(`  Contract Address: 0xe93F91A80...`, "dim");
    await sleep(1000);
    appendLog("Vault invoking ISP1Verifier(0x71C...).verifyProof()...", "info");
    await sleep(1200);
    appendLog("✅ ZK Proof verified on-chain. State matches Image ID.", "success");
    await sleep(800);
    
    // Perform swaps in state
    if (predictedAction === "BUY_ETH") {
      const usdcToSwap = usdcBalance / 2;
      setUsdcBalance(prev => prev - usdcToSwap);
      setEthBalance(prev => prev + (usdcToSwap / 3000));
      appendLog(`Vault Action: Swap ${usdcToSwap.toFixed(2)} USDC to ${(usdcToSwap / 3000).toFixed(4)} ETH`, "success");
    } else if (predictedAction === "BUY_USDC") {
      const ethToSwap = ethBalance / 2;
      setEthBalance(prev => prev - ethToSwap);
      setUsdcBalance(prev => prev + (ethToSwap * 3000));
      appendLog(`Vault Action: Swap ${ethToSwap.toFixed(4)} ETH to ${(ethToSwap * 3000).toFixed(2)} USDC`, "success");
    } else {
      appendLog(`Vault Action: No rebalancing triggered (HOLD state)`, "info");
    }
    
    setLastAction(predictedAction);
    await sleep(800);
    
    appendLog("🎉 Rebalance transaction completed successfully!", "success");
    appendLog(`Transaction Hash: 0x${Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join("")}`, "dim");
    setStatus("success");
  };

  const totalValue = usdcBalance + (ethBalance * 3000);

  return (
    <div className="container">
      {/* Header Banner */}
      <header>
        <div className="logo-section">
          <span className="logo-badge">ZK-LLM</span>
          <span className="logo-text">Autonomous Agent Portal</span>
        </div>
        <button className="wallet-btn">
          🔒 Connected: 0xab...f53c
        </button>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Control Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Agent Parameters Form */}
          <div className="glass-card">
            <h3 className="card-title">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Inference Inputs
            </h3>
            
            <div className="input-group">
              <label className="input-label">Market Trend</label>
              <select 
                className="select-input"
                value={trend}
                onChange={(e) => setTrend(e.target.value)}
                disabled={status === "running" || status === "proving" || status === "contract"}
              >
                <option value="BULL">BULL (Low Risk, Upside)</option>
                <option value="BEAR">BEAR (High Risk, Downside)</option>
                <option value="CRAB">CRAB (Neutral Range)</option>
              </select>
            </div>

            <div className="input-group">
              <label className="input-label">Mempool Volatility</label>
              <select 
                className="select-input"
                value={volatility}
                onChange={(e) => setVolatility(e.target.value)}
                disabled={status === "running" || status === "proving" || status === "contract"}
              >
                <option value="LOW">LOW (Stable Market)</option>
                <option value="HIGH">HIGH (Extreme Fluctuations)</option>
              </select>
            </div>

            <button 
              className="action-btn"
              onClick={handleRunInference}
              disabled={status === "running" || status === "proving" || status === "contract"}
            >
              {status === "idle" && "Trigger Decision"}
              {status === "running" && "Executing Guest..."}
              {status === "proving" && "Generating Proof..."}
              {status === "contract" && "Verifying On-Chain..."}
              {status === "success" && "Trigger New Decision"}
            </button>
          </div>

          {/* Vault Balance Overview */}
          <div className="glass-card">
            <h3 className="card-title">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              LLMAgentVault.sol
            </h3>
            
            <div className="balance-list">
              <div className="balance-item">
                <span className="balance-name">USDC Balance</span>
                <span className="balance-val">${usdcBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="balance-item">
                <span className="balance-name">ETH Balance</span>
                <span className="balance-val">{ethBalance.toFixed(4)} ETH</span>
              </div>
              <div className="balance-item" style={{ borderTop: "1px dashed rgba(255,255,255,0.1)", paddingTop: "1rem" }}>
                <span className="balance-name" style={{ fontWeight: "bold" }}>Total Asset Value</span>
                <span className="balance-val" style={{ color: "var(--accent)" }}>${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Console Output Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Terminal Console */}
          <div className="glass-card" style={{ flexGrow: 1 }}>
            <h3 className="card-title">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              ZKVM Execution Log Console
            </h3>
            
            <div className="terminal-card">
              {logs.length === 0 ? (
                <div className="terminal-line dim">&gt; Ready for inference. Click "Trigger Decision" to execute the off-chain model inside the ZKVM.</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`terminal-line ${log.type}`}>
                    <span className="terminal-line dim">[{log.time}]</span> {log.text}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cryptographic Proof Details */}
          <div className="glass-card">
            <h3 className="card-title">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Cryptographic Proof Elements
            </h3>

            <div className="proof-item">
              <div className="proof-label">Program Image ID (VKey)</div>
              <div className="proof-value-box">{PROGRAM_VKEY}</div>
            </div>

            <div className="proof-item">
              <div className="proof-label">Public Values Commitment</div>
              <div className="proof-value-box">
                {publicValues || "Waiting for execution..."}
              </div>
            </div>

            <div className="proof-item">
              <div className="proof-label">ZK Proof Seal (Groth16 Wrapper)</div>
              <div className="proof-value-box">
                {proofBytes || "Waiting for execution..."}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
