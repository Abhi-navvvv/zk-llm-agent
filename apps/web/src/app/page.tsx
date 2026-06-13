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

    appendLog("🚀 Initializing off-chain zk-ML Agent pipeline...", "info");
    await sleep(600);

    // 1. Tokenization
    appendLog(`Tokenizing input parameters: Trend = ${trend}, Volatility = ${volatility}`, "info");
    const prompt = ["<bos>", "MARKET", trend, "VOLATILITY", volatility, "ACTION"];
    const inputIdx = prompt.map(t => VOCAB_MAP[t]);
    while (inputIdx.length < 8) {
      inputIdx.push(VOCAB_MAP["<pad>"]);
    }
    await sleep(500);
    appendLog(`Generated input tokens: [${inputIdx.join(", ")}]`, "dim");
    await sleep(400);

    // 2. REAL Model Inference via API (loads actual trained weights)
    appendLog("Calling /api/inference — loading real model weights (weights.bin)...", "info");
    appendLog("Forward pass: Embedding → MeanPool → Linear+ReLU → Linear → Softmax", "dim");

    let predictedAction = "HOLD";
    let predToken = 16;
    let logits = { BUY_ETH: 0, BUY_USDC: 0, HOLD: 0 };

    try {
      const res = await fetch("/api/inference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trend, volatility }),
      });
      const data = await res.json();

      if (!data.success) {
        appendLog(`❌ Inference API error: ${data.error}`, "err");
        setStatus("idle");
        return;
      }

      predictedAction = data.predWord;
      predToken = data.predToken;
      logits = data.probs;

      appendLog(`  Source: ${data.source} (not hardcoded)`, "dim");
      appendLog(`  Probabilities — BUY_ETH: ${logits.BUY_ETH.toFixed(4)}, BUY_USDC: ${logits.BUY_USDC.toFixed(4)}, HOLD: ${logits.HOLD.toFixed(4)}`, "dim");
      appendLog(`  Confidence: ${(data.confidence * 100).toFixed(1)}%`, "dim");
    } catch (err) {
      appendLog(`❌ Failed to reach inference API: ${err}`, "err");
      setStatus("idle");
      return;
    }

    appendLog(`🎯 Model inference succeeded. Decision: ${predictedAction} (token ${predToken})`, "success");
    await sleep(600);

    // 3. Proving (SIMULATED — requires SP1 prover backend for real proofs)
    setStatus("proving");
    appendLog("[SIMULATED] Initiating ZK Proof Generation (Groth16 wrapper)...", "warn");
    appendLog("[SIMULATED] Run 'cargo run --bin zk-llm-script -- --prove' for real proofs", "dim");
    await sleep(1200);

    const mockProof = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const mockPublicValues = "0x" + Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

    setProofBytes(mockProof);
    setPublicValues(mockPublicValues);

    appendLog("✅ [SIMULATED] Proof generated", "success");
    appendLog(`  Program Image ID: ${PROGRAM_VKEY}`, "dim");
    await sleep(800);

    // 4. Contract Execution (SIMULATED — requires deployed contract + wallet)
    setStatus("contract");
    appendLog("[SIMULATED] Submitting to MLAgentVault.sol...", "info");
    await sleep(800);
    appendLog("[SIMULATED] ISP1Verifier.verifyProof() — proof accepted", "success");
    await sleep(600);

    // Perform swaps in local state
    if (predictedAction === "BUY_ETH") {
      const usdcToSwap = usdcBalance / 2;
      setUsdcBalance(prev => prev - usdcToSwap);
      setEthBalance(prev => prev + (usdcToSwap / 3000));
      appendLog(`Vault Action: Swap ${usdcToSwap.toFixed(2)} USDC → ${(usdcToSwap / 3000).toFixed(4)} ETH`, "success");
    } else if (predictedAction === "BUY_USDC") {
      const ethToSwap = ethBalance / 2;
      setEthBalance(prev => prev - ethToSwap);
      setUsdcBalance(prev => prev + (ethToSwap * 3000));
      appendLog(`Vault Action: Swap ${ethToSwap.toFixed(4)} ETH → ${(ethToSwap * 3000).toFixed(2)} USDC`, "success");
    } else {
      appendLog(`Vault Action: No rebalancing triggered (HOLD)`, "info");
    }

    setLastAction(predictedAction);
    await sleep(600);

    appendLog("🎉 Pipeline complete!", "success");
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
    <div className="container">
      {/* Header Banner */}
      <header>
        <div className="logo-section">
          <div className="logo-box">ZK</div>
          <span className="logo-text">ML Agent Vault</span>
        </div>
        <button className="wallet-btn">
          <div className="dot"></div>
          Connected: 0xab...f53c
        </button>
      </header>

      {/* Hero Intro */}
      <div className="hero-section">
        <div className="hero-tag">Verifiable Off-Chain Intelligence</div>
        <h1 className="hero-title">Proof-of-Honesty Agent Portal</h1>
        <p className="hero-subtitle">
          Rebalance a DeFi vault trustlessly using an ML classifier running inside the SP1 zkVM. The inference below calls a real model API — ZK proof and on-chain steps are simulated.
        </p>
      </div>

      {/* Dynamic Progress Pipeline */}
      <div className="pipeline-container">
        <div className={`pipeline-step ${getStepClass(1)}`}>
          <div className="step-indicator">1</div>
          <div className="step-label">Tokenize Inputs</div>
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

        {/* Left Control Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>

          {/* Inference Inputs Card */}
          <div className="glass-card">
            <div className="card-number">_01.</div>
            <h3 className="card-title">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                disabled={status !== "idle" && status !== "success"}
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
                disabled={status !== "idle" && status !== "success"}
              >
                <option value="LOW">LOW (Stable Market)</option>
                <option value="HIGH">HIGH (Extreme Fluctuations)</option>
              </select>
            </div>

            <button
              className="action-btn"
              onClick={handleRunInference}
              disabled={status !== "idle" && status !== "success"}
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
            <div className="card-number">_02.</div>
            <h3 className="card-title">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              MLAgentVault.sol
            </h3>

            <div className="balance-list">
              <div className="balance-item">
                <span className="balance-name">USDC Balance</span>
                <span className="balance-val">${usdcBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="balance-item">
                <span className="balance-name">ETH Balance</span>
                <span className="balance-val">{ethBalance.toFixed(4)} ETH</span>
              </div>
              <div className="balance-item" style={{ borderTop: "1px dashed rgba(255,255,255,0.08)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                <span className="balance-name" style={{ fontWeight: "bold", color: "#ffffff" }}>Total Asset Value</span>
                <span className="balance-val" style={{ color: "var(--mint)", fontSize: "1.1rem" }}>${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                <div className="terminal-line dim">&gt; zkvm-sh: ready. Inference uses real model weights via /api/inference. ZK proof is simulated.</div>
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
                  {publicValues || "Waiting for execution..."}
                </div>
              </div>

              <div className="proof-item">
                <div className="proof-header-row">
                  <div className="proof-label">ZK Proof Seal (Groth16 Wrapper)</div>
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
                  {proofBytes || "Waiting for execution..."}
                </div>
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
