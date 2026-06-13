import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Real ML Model Inference API
 *
 * This endpoint loads the actual trained model weights (weights.bin)
 * and runs a genuine forward pass — embedding lookup, mean pooling,
 * linear layers, ReLU, softmax — returning the real prediction.
 *
 * No hardcoded if/else. The prediction comes from the model weights.
 */

// Model constants (must match model.py and program/src/main.rs)
const VOCAB_SIZE = 17;
const EMBED_DIM = 8;
const HIDDEN_DIM = 16;
const NUM_CLASSES = 3;
const MAX_LEN = 8;
const CLASS_TOKENS = [14, 15, 16];

const VOCAB = [
  "<pad>", "<bos>", "<eos>",
  "MARKET", "BULL", "BEAR", "CRAB",
  "VOLATILITY", "HIGH", "LOW",
  "TREND", "UP", "DOWN",
  "ACTION", "BUY_ETH", "BUY_USDC", "HOLD",
];

const VOCAB_MAP: Record<string, number> = {};
VOCAB.forEach((tok, idx) => { VOCAB_MAP[tok] = idx; });

// Weight cache (loaded once, reused across requests)
let cachedWeights: {
  w_emb: number[][];
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
} | null = null;

function loadWeights() {
  if (cachedWeights) return cachedWeights;

  // Resolve path relative to the web app's working directory
  // Next.js CWD is apps/web, weights are at ../../model/weights/weights.bin
  const weightsPath = path.resolve(process.cwd(), "../../model/weights/weights.bin");

  if (!fs.existsSync(weightsPath)) {
    throw new Error(`Model weights not found at ${weightsPath}. Run 'cd model && python model.py' first.`);
  }

  const buffer = fs.readFileSync(weightsPath);
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

  let offset = 0;

  // W_emb: [VOCAB_SIZE, EMBED_DIM]
  const w_emb: number[][] = [];
  for (let i = 0; i < VOCAB_SIZE; i++) {
    w_emb[i] = [];
    for (let j = 0; j < EMBED_DIM; j++) {
      w_emb[i][j] = floats[offset++];
    }
  }

  // W1: [EMBED_DIM, HIDDEN_DIM]
  const w1: number[][] = [];
  for (let i = 0; i < EMBED_DIM; i++) {
    w1[i] = [];
    for (let j = 0; j < HIDDEN_DIM; j++) {
      w1[i][j] = floats[offset++];
    }
  }

  // b1: [HIDDEN_DIM]
  const b1: number[] = [];
  for (let i = 0; i < HIDDEN_DIM; i++) {
    b1[i] = floats[offset++];
  }

  // W2: [HIDDEN_DIM, NUM_CLASSES]
  const w2: number[][] = [];
  for (let i = 0; i < HIDDEN_DIM; i++) {
    w2[i] = [];
    for (let j = 0; j < NUM_CLASSES; j++) {
      w2[i][j] = floats[offset++];
    }
  }

  // b2: [NUM_CLASSES]
  const b2: number[] = [];
  for (let i = 0; i < NUM_CLASSES; i++) {
    b2[i] = floats[offset++];
  }

  cachedWeights = { w_emb, w1, b1, w2, b2 };
  return cachedWeights;
}

/**
 * Forward pass: identical to Python model and Rust guest program.
 * Embedding → Mean Pool → Linear+ReLU → Linear → Softmax → Argmax
 */
function forward(inputIdx: number[], weights: NonNullable<typeof cachedWeights>) {
  const { w_emb, w1, b1, w2, b2 } = weights;

  // 1. Embedding lookup + mean pooling
  const h = new Array(EMBED_DIM).fill(0);
  for (let t = 0; t < MAX_LEN; t++) {
    const token = inputIdx[t];
    for (let d = 0; d < EMBED_DIM; d++) {
      h[d] += w_emb[token][d];
    }
  }
  for (let d = 0; d < EMBED_DIM; d++) {
    h[d] /= MAX_LEN;
  }

  // 2. Linear 1: z1 = h @ W1 + b1
  const z1 = new Array(HIDDEN_DIM).fill(0);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = 0;
    for (let i = 0; i < EMBED_DIM; i++) {
      sum += h[i] * w1[i][j];
    }
    z1[j] = sum + b1[j];
  }

  // 3. ReLU
  const a1 = z1.map((v: number) => Math.max(v, 0));

  // 4. Linear 2: z2 = a1 @ W2 + b2
  const z2 = new Array(NUM_CLASSES).fill(0);
  for (let j = 0; j < NUM_CLASSES; j++) {
    let sum = 0;
    for (let i = 0; i < HIDDEN_DIM; i++) {
      sum += a1[i] * w2[i][j];
    }
    z2[j] = sum + b2[j];
  }

  // 5. Softmax
  const maxZ2 = Math.max(...z2);
  const expZ2 = z2.map((v: number) => Math.exp(v - maxZ2));
  const sumExp = expZ2.reduce((a: number, b: number) => a + b, 0);
  const probs = expZ2.map((v: number) => v / sumExp);

  // 6. Argmax
  let predClass = 0;
  let maxProb = probs[0];
  for (let j = 1; j < NUM_CLASSES; j++) {
    if (probs[j] > maxProb) {
      maxProb = probs[j];
      predClass = j;
    }
  }

  return {
    probs: {
      BUY_ETH: Number(probs[0].toFixed(6)),
      BUY_USDC: Number(probs[1].toFixed(6)),
      HOLD: Number(probs[2].toFixed(6)),
    },
    predClass,
    predToken: CLASS_TOKENS[predClass],
    predWord: VOCAB[CLASS_TOKENS[predClass]],
    confidence: Number(maxProb.toFixed(6)),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { trend, volatility } = body;

    // Validate inputs
    if (!["BULL", "BEAR", "CRAB"].includes(trend)) {
      return NextResponse.json({ success: false, error: `Invalid trend: ${trend}` }, { status: 400 });
    }
    if (!["HIGH", "LOW"].includes(volatility)) {
      return NextResponse.json({ success: false, error: `Invalid volatility: ${volatility}` }, { status: 400 });
    }

    // Tokenize (same logic as Python and Rust)
    const prompt = ["<bos>", "MARKET", trend, "VOLATILITY", volatility, "ACTION"];
    const inputIdx = prompt.map((t) => VOCAB_MAP[t]);
    while (inputIdx.length < MAX_LEN) {
      inputIdx.push(VOCAB_MAP["<pad>"]);
    }

    // Load weights and run real forward pass
    const weights = loadWeights();
    const result = forward(inputIdx, weights);

    return NextResponse.json({
      success: true,
      source: "real_model_weights",
      inputTokens: inputIdx,
      prompt,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
