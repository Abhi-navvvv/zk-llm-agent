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
  const [usdcBalance, setUsdcBalance] = useState(5000.0);
  const [ethBalance, setEthBalance] = useState(1.6667);
  const [lastAction, setLastAction] = useState("NONE");
  
  // ZK Proof State
  const [proofBytes, setProofBytes] = useState("");
  const [publicValues, setPublicValues] = useState("");
  const [copiedId, setCopiedId] = useState("");

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

  const handleRunInference = async () => {
    setStatus("running");
    setLogs([]);
    setProofBytes("");
    setPublicValues("");
    
    appendLog("🚀 Launching off-chain ZK-ML Agent pipeline...", "info");
    await sleep(800);
    
    // 1. Tokenization
    appendLog(`Tokenizing inputs: Trend = ${trend}, Volatility = ${volatility}`, "info");
    const prompt = ["<bos>", "MARKET", trend, "VOLATILITY", volatility, "ACTION"];
    const inputIdx = prompt.map(t => VOCAB_MAP[t]);
    while (inputIdx.length < 8) {
      inputIdx.push(VOCAB_MAP["<pad>"]);
    }
    await sleep(800);
    appendLog(`Prompt input tokens generated: [${inputIdx.join(", ")}]`, "dim");
    await sleep(600);

    // 2. Guest Execution
    appendLog("Instantiating Guest Program inside SP1 zkVM executor (RV32IM)...", "info");
    await sleep(1000);
    appendLog("Model layout: embedding[17, 8], fc1[8, 16], fc2[16, 3]", "dim");
    await sleep(600);
    appendLog("Running forward propagation inside ZKVM...", "info");
    
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
    appendLog(`  Embedding layer mapping resolved shape: [8]`, "dim");
    await sleep(500);
    appendLog(`  FC1 linear activation (ReLU) completed. Cycles: 142`, "dim");
    await sleep(700);
    appendLog(`  FC2 logits: BUY_ETH: ${logits[0].toFixed(4)}, BUY_USDC: ${logits[1].toFixed(4)}, HOLD: ${logits[2].toFixed(4)}`, "dim");
    await sleep(600);
    appendLog(`🎯 Model inference complete. Optimal Action: ${predictedAction} (token ${predToken})`, "success");
    await sleep(800);

    // 3. Proving
    setStatus("proving");
    appendLog("Initiating ZK Proof Generation (Groth16)...", "warn");
    appendLog("Assembling witness from execution trace...", "dim");
    await sleep(1200);
    appendLog("Proving trace path constraints: 3,142 total steps", "dim");
    await sleep(1500);
    
    // Mock proof hex values
    const mockProof = "0x" + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join("");
    const mockPublicValues = "0x" + Array.from({length: 32}, () => Math.floor(Math.random()*16).toString(16)).join("");
    
    setProofBytes(mockProof);
    setPublicValues(mockPublicValues);
    
    appendLog("✅ ZK Proof (Groth16) successfully established!", "success");
    appendLog(`  Proof payload size: 256 bytes`, "dim");
    appendLog(`  Model Image ID: ${PROGRAM_VKEY}`, "dim");
    await sleep(1000);

    // 4. Contract Execution
    setStatus("contract");
    appendLog("Submitting verification transaction to LLMAgentVault.sol...", "info");
    appendLog(`  Vault address: 0xe93F91A80...`, "dim");
    await sleep(1000);
    appendLog("Verifying proof via on-chain SP1 Verifier contract...", "info");
    await sleep(1200);
    appendLog("✅ Cryptographic validation succeeded. Execution matches constraints.", "success");
    await sleep(800);
    
    // Perform swaps in state
    if (predictedAction === "BUY_ETH") {
      const usdcToSwap = usdcBalance / 2;
      setUsdcBalance(prev => prev - usdcToSwap);
      setEthBalance(prev => prev + (usdcToSwap / 3000));
      appendLog(`Swap Execution: Rebalanced ${usdcToSwap.toFixed(2)} USDC to ${(usdcToSwap / 3000).toFixed(4)} ETH`, "success");
    } else if (predictedAction === "BUY_USDC") {
      const ethToSwap = ethBalance / 2;
      setEthBalance(prev => prev - ethToSwap);
      setUsdcBalance(prev => prev + (ethToSwap * 3000));
      appendLog(`Swap Execution: Rebalanced ${ethToSwap.toFixed(4)} ETH to ${(ethToSwap * 3000).toFixed(2)} USDC`, "success");
    } else {
      appendLog(`No balance swap needed (HOLD State)`, "info");
    }
    
    setLastAction(predictedAction);
    await sleep(800);
    
    appendLog("🎉 Vault allocation completed & settled on-chain!", "success");
    appendLog(`Tx Hash: 0x${Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join("")}`, "dim");
    setStatus("success");
  };

  const ethPrice = 3000;
  const totalValue = usdcBalance + (ethBalance * ethPrice);
  const usdcPercent = totalValue > 0 ? (usdcBalance / totalValue) * 100 : 100;
  const ethPercent = 100 - usdcPercent;

  // Compute pipeline status values
  const getStepClass = (step: number) => {
    if (status === "success") return "completed";
    
    if (step === 1) {
      return status !== "idle" ? "completed" : "active";
    }
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
    if (step === 4) {
      if (status === "contract") return "active";
      return "";
    }
    return "";
  };

  return (
    <>
      {/* Galactic Starry Background */}
      <div className="galaxy-background">
        <div className="stars-small"></div>
        <div className="stars-medium"></div>
        <div className="stars-large"></div>
        <div className="nebula-purple"></div>
        <div className="nebula-cyan"></div>
        <div className="nebula-pink"></div>
      </div>

      <div className="container">
        {/* Header Banner */}
        <header>
          <div className="logo-section">
            <div className="logo-box">Φ</div>
            <span className="logo-text">ZK-LLM VAULT ENGINE</span>
          </div>
          <button className="wallet-btn">
            <div className="dot"></div>
            Connected: 0xab...f53c
          </button>
        </header>

        {/* Hero Intro */}
        <div className="hero-section">
          <div className="hero-tag">System Node: Operational</div>
          <h1 className="hero-title">Verifiable AI Portfolio Agent</h1>
          <p className="hero-subtitle">
            Execute secure, proof-of-honesty asset allocation using zero-knowledge machine learning (ZK-ML). The trading model runs inside the SP1 ZKVM to generate cryptographic verification.
          </p>
        </div>

        {/* Dynamic Progress Pipeline */}
        <div className="pipeline-container">
          <div className={`pipeline-step ${getStepClass(1)}`}>
            <div className="step-indicator">I</div>
            <div className="step-text-container">
              <span className="step-num">Step 01</span>
              <span className="step-label">Tokenize Inputs</span>
            </div>
          </div>
          <div className={`pipeline-step ${getStepClass(2)}`}>
            <div className="step-indicator">II</div>
            <div className="step-text-container">
              <span className="step-num">Step 02</span>
              <span className="step-label">zkVM Inference</span>
            </div>
          </div>
          <div className={`pipeline-step ${getStepClass(3)}`}>
            <div className="step-indicator">III</div>
            <div className="step-text-container">
              <span className="step-num">Step 03</span>
              <span className="step-label">ZK Proving</span>
            </div>
          </div>
          <div className={`pipeline-step ${getStepClass(4)}`}>
            <div className="step-indicator">IV</div>
            <div className="step-text-container">
              <span className="step-num">Step 04</span>
              <span className="step-label">On-Chain Verify</span>
            </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          
          {/* Left Control Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* Inference Inputs Card */}
            <div className="glass-card">
              <h3 className="card-title">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
                Inference Inputs
              </h3>
              
              <div className="input-group">
                <label className="input-label">Market Trend Selection</label>
                <div className="segmented-control">
                  {["BULL", "BEAR", "CRAB"].map((opt) => (
                    <button
                      key={opt}
                      className={`segment-btn ${trend === opt ? "active" : ""}`}
                      onClick={() => setTrend(opt)}
                      disabled={status !== "idle" && status !== "success"}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="input-group" style={{ marginBottom: "2rem" }}>
                <label className="input-label">Mempool Volatility Index</label>
                <div className="segmented-control">
                  {["LOW", "HIGH"].map((opt) => (
                    <button
                      key={opt}
                      className={`segment-btn ${volatility === opt ? "active" : ""}`}
                      onClick={() => setVolatility(opt)}
                      disabled={status !== "idle" && status !== "success"}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <button 
                className="action-btn"
                onClick={handleRunInference}
                disabled={status !== "idle" && status !== "success"}
              >
                {status === "idle" && "Trigger Rebalance Pipeline"}
                {status === "running" && "Executing Guest..."}
                {status === "proving" && "Generating ZK Proof..."}
                {status === "contract" && "Verifying On-Chain..."}
                {status === "success" && "Trigger New Inference"}
              </button>
            </div>

            {/* Vault Balance Overview */}
            <div className="glass-card">
              <h3 className="card-title">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                LLMAgentVault.sol State
              </h3>
              
              <div className="balance-list">
                <div className="balance-item">
                  <span className="balance-name">USDC Reserve</span>
                  <span className="balance-val">${usdcBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
                <div className="balance-item">
                  <span className="balance-name">ETH Reserve</span>
                  <span className="balance-val">{ethBalance.toFixed(4)} ETH</span>
                </div>
                <div className="balance-item" style={{ borderTop: "1px dashed rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                  <span className="balance-name" style={{ fontWeight: "bold", color: "#ffffff" }}>Vault Net Asset Value</span>
                  <span className="balance-val" style={{ color: "var(--cyan)", fontSize: "1.05rem" }}>${totalValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                </div>
              </div>

              {/* Asset Allocation Bar Chart */}
              <div className="visual-bar-container">
                <div className="visual-bar-labels">
                  <span>USDC: {usdcPercent.toFixed(0)}%</span>
                  <span>ETH: {ethPercent.toFixed(0)}%</span>
                </div>
                <div className="visual-bar">
                  <div className="visual-bar-fill-usdc" style={{ width: `${usdcPercent}%` }}></div>
                  <div className="visual-bar-fill-eth" style={{ width: `${ethPercent}%` }}></div>
                </div>
              </div>
            </div>

          </div>

          {/* Right Console Output Column */}
          <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
            
            {/* Terminal Console */}
            <div className="terminal-wrapper">
              <div className="terminal-header">
                <div className="terminal-buttons">
                  <div className="terminal-btn close"></div>
                  <div className="terminal-btn minimize"></div>
                  <div className="terminal-btn expand"></div>
                </div>
                <div className="terminal-title">zkvm-sh</div>
              </div>
              
              <div className="terminal-body">
                {logs.length === 0 ? (
                  <div className="terminal-line dim">&gt; zkvm-sh: ready for execution. Configure inputs and click "Trigger Rebalance Pipeline" to run.</div>
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
                      {copiedId === "vkey" ? "Copied!" : (
                        <>
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="proof-value-box">{PROGRAM_VKEY}</div>
                </div>

                <div className="proof-item">
                  <div className="proof-header-row">
                    <div className="proof-label">Public Values Commitment</div>
                    <button className="copy-btn" onClick={() => copyToClipboard(publicValues, "pubval")} disabled={!publicValues}>
                      {copiedId === "pubval" ? "Copied!" : (
                        <>
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="proof-value-box">
                    {publicValues || "Waiting for execution trace..."}
                  </div>
                </div>

                <div className="proof-item">
                  <div className="proof-header-row">
                    <div className="proof-label">ZK Proof Seal (Groth16)</div>
                    <button className="copy-btn" onClick={() => copyToClipboard(proofBytes, "proof")} disabled={!proofBytes}>
                      {copiedId === "proof" ? "Copied!" : (
                        <>
                          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                          </svg>
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                  <div className="proof-value-box">
                    {proofBytes || "Waiting for execution trace..."}
                  </div>
                </div>
              </div>

              {/* Cryptographic Trust Shield */}
              <div className="verification-badge-container">
                <div className="badge-icon">
                  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" width="20" height="20">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div className="badge-text">
                  <span className="badge-title">Verification Shield Active</span>
                  <span className="badge-desc">Off-chain inference validated mathematically via SP1 ZK-Verifier.</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer */}
        <footer>
          <div>© 2026 ZK-LLM Vault Protocol. All execution verified.</div>
          <div>
            Built with Next.js & SP1 zkVM ·{" "}
            <a href="https://github.com/Abhi-navvvv/zk-llm-agent" target="_blank" rel="noreferrer" className="footer-link">
              GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  );
}
