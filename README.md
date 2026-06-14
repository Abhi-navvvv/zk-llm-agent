# zk-ML Agent Vault

> A verifiable DeFi portfolio agent that runs ML model inference inside the [SP1 zero-knowledge virtual machine](https://docs.succinct.xyz/), generating cryptographic proofs that the trading decision was computed honestly before executing it on-chain.

## Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌────────────────┐      ┌──────────────────┐
│  Python      │      │  SP1 zkVM Guest  │      │  SP1 Host      │      │  Solidity         │
│  NumPy MLP   │─────▶│  Rust Program    │─────▶│  Prover Script │─────▶│  MLAgentVault.sol │
│  (Training)  │      │  (Inference)     │      │  (Groth16)     │      │  (Verification)  │
└─────────────┘      └──────────────────┘      └────────────────┘      └──────────────────┘
  model.py             program/src/main.rs       script/src/main.rs      contracts/src/
  ↓ exports                                       ↓ generates
  weights.bin ──────────────────────────────▶    proof.json + publicValues
                                                   ↓ submitted to
                                              MLAgentVault.rebalance()
```

### Data Flow

1. **Train** — A 2-layer MLP classifier is trained in NumPy on synthetic market data
2. **Export** — Model weights are serialized to `weights.bin` (float32, little-endian)
3. **Embed** — The Rust guest program bakes `weights.bin` via `include_bytes!`, binding the model to the program's Image ID
4. **Infer** — The guest runs a forward pass inside the SP1 zkVM, committing input tokens and the predicted action to public IO
5. **Prove** — The host generates a Groth16 proof of correct execution
6. **Verify** — The Solidity contract verifies the proof on-chain and executes the trading action

## Honesty Note

> **This is NOT a Large Language Model.** The model is a 331-parameter, 2-layer MLP classifier that maps 2 categorical market indicators (trend + volatility) to 3 trading actions (BUY_ETH, BUY_USDC, HOLD). It uses a 17-token vocabulary of hardcoded trading keywords. The name "zk-ML Agent" reflects this — it is a verifiable *machine learning* model, not a generative language model.

## What the ZK Proof Guarantees

| Guaranteed | NOT Guaranteed |
|-----------|---------------|
| Model inference was executed exactly as specified | That the model is profitable |
| The exact model weights (bound to Image ID) were used | Real-time price data accuracy |
| Input tokens and output prediction are cryptographically committed | Optimal model architecture |
| No tampering occurred during inference | Protection against adversarial inputs |

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| ML Model | Python 3 + NumPy | 2-layer MLP classifier training + weight export |
| ZK Guest | Rust + SP1 zkVM (v6.2.3) | Deterministic model inference in provable environment |
| ZK Host | Rust + SP1 SDK + Tokio | Proof generation (Groth16 wrapper) |
| Smart Contract | Solidity 0.8.20 | On-chain proof verification + vault management |
| Frontend | Next.js 16 + TypeScript | Dashboard with live inference API |
| Contract Testing | Foundry (forge) | Unit + fuzz tests for Solidity |

## Project Structure

```
zk-ml-agent/
├── model/
│   ├── model.py              # NumPy MLP: training + weight export
│   ├── test_model.py          # Model unit tests
│   └── weights/
│       ├── weights.bin        # Serialized float32 weights
│       ├── config.json        # Model hyperparameters
│       └── test_case.json     # Reference I/O for cross-validation
├── program/
│   └── src/
│       ├── main.rs            # SP1 guest: forward pass inside zkVM
│       └── weights.bin        # Baked model weights (copy from model/weights/)
├── script/
│   └── src/
│       └── main.rs            # SP1 host: prover + verifier script
├── contracts/
│   ├── foundry.toml           # Foundry configuration
│   ├── src/
│   │   ├── MLAgentVault.sol   # Production vault with ERC-20 + oracle
│   │   ├── ISP1Verifier.sol   # SP1 verifier interface
│   │   └── interfaces/        # IERC20, IPriceFeed
│   └── test/
│       └── MLAgentVault.t.sol # Foundry test suite with mocks
├── apps/
│   └── web/                   # Next.js frontend dashboard
│       └── src/app/
│           ├── page.tsx       # Main UI
│           ├── api/inference/
│           │   └── route.ts   # Real model inference API endpoint
│           └── globals.css    # Design system
├── Cargo.toml                 # Rust workspace
├── package.json               # pnpm workspace root
└── README.md                  # This file
```

## Getting Started

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | 1.75+ | [rustup.rs](https://rustup.rs) |
| SP1 CLI | latest | `curl -L https://sp1.succinct.xyz \| bash && sp1up` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| pnpm | 8+ | `npm install -g pnpm` |
| Python | 3.9+ | [python.org](https://python.org) |
| NumPy | latest | `pip install numpy` |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |

### 1. Train the Model

```bash
cd model
python model.py
# Outputs: weights/weights.bin, weights/config.json, weights/test_case.json
```

### 2. Copy Weights to ZK Guest

```bash
cp model/weights/weights.bin program/src/weights.bin
```

### 3. Build & Run ZK Program

```bash
# Simulation only (fast, no proof)
cargo run --release --bin zk-llm-script

# Generate real Groth16 proof (requires SP1 network or local GPU)
cargo run --release --bin zk-llm-script -- --prove
```

### 4. Test Smart Contracts

```bash
cd contracts
forge install
forge test -vvv
```

### 5. Run Frontend

```bash
pnpm install
pnpm dev:web
# Open http://localhost:3000
```

## API Endpoints

### `POST /api/inference`

Runs real model inference using the trained weights.

**Request:**
```json
{ "trend": "BULL", "volatility": "LOW" }
```

**Response:**
```json
{
  "success": true,
  "inputTokens": [1, 3, 4, 7, 9, 13, 0, 0],
  "prompt": ["<bos>", "MARKET", "BULL", "VOLATILITY", "LOW", "ACTION"],
  "probs": { "BUY_ETH": 0.92, "BUY_USDC": 0.03, "HOLD": 0.05 },
  "predClass": 0,
  "predToken": 14,
  "predWord": "BUY_ETH"
}
```

## License

MIT
