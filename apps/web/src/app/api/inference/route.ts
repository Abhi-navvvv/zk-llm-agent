import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Continuous 15-Feature ML Model Inference API
 */

const INPUT_DIM = 15;
const HIDDEN_DIM = 16;
const NUM_CLASSES = 3;
const CLASS_TOKENS = [14, 15, 16];
const FEATURES = [
  "price_momentum_1h",
  "price_momentum_24h",
  "volatility_index",
  "volume_change_24h",
  "tvl_change_24h",
  "funding_rate",
  "gas_price_gwei",
  "eth_dominance",
  "stablecoin_ratio",
  "dex_volume_ratio",
  "slippage_impact",
  "net_inflows_million",
  "mvrv_ratio",
  "network_growth",
  "active_addresses_change"
];

// Weight cache (loaded once, reused across requests)
let cachedWeights: {
  W1: number[][];
  b1: number[];
  W2: number[][];
  b2: number[];
} | null = null;

function loadWeights() {
  if (cachedWeights) return cachedWeights;

  // Resolve path relative to the web app's public directory
  const publicPath = path.join(process.cwd(), "public/weights/weights.bin");
  const fallbackPath = path.resolve(process.cwd(), "../../model/weights/weights.bin");
  
  let weightsPath = publicPath;
  if (!fs.existsSync(publicPath)) {
    if (fs.existsSync(fallbackPath)) {
      weightsPath = fallbackPath;
    } else {
      throw new Error(`Model weights not found at either ${publicPath} or ${fallbackPath}. Run 'make train' or 'node scripts/copy-weights.js' first.`);
    }
  }

  const buffer = fs.readFileSync(weightsPath);
  const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

  let offset = 0;

  // W1: [15, 16]
  const W1: number[][] = [];
  for (let i = 0; i < INPUT_DIM; i++) {
    W1[i] = [];
    for (let j = 0; j < HIDDEN_DIM; j++) {
      W1[i][j] = floats[offset++];
    }
  }

  // b1: [16]
  const b1: number[] = [];
  for (let i = 0; i < HIDDEN_DIM; i++) {
    b1[i] = floats[offset++];
  }

  // W2: [16, 3]
  const W2: number[][] = [];
  for (let i = 0; i < HIDDEN_DIM; i++) {
    W2[i] = [];
    for (let j = 0; j < NUM_CLASSES; j++) {
      W2[i][j] = floats[offset++];
    }
  }

  // b2: [3]
  const b2: number[] = [];
  for (let i = 0; i < NUM_CLASSES; i++) {
    b2[i] = floats[offset++];
  }

  cachedWeights = { W1, b1, W2, b2 };
  return cachedWeights;
}

function forward(features: number[], weights: NonNullable<typeof cachedWeights>) {
  const { W1, b1, W2, b2 } = weights;

  // 1. Linear 1: z1 = features @ W1 + b1
  const z1 = new Array(HIDDEN_DIM).fill(0);
  for (let j = 0; j < HIDDEN_DIM; j++) {
    let sum = 0;
    for (let i = 0; i < INPUT_DIM; i++) {
      sum += features[i] * W1[i][j];
    }
    z1[j] = sum + b1[j];
  }

  // 2. ReLU
  const a1 = z1.map((v) => Math.max(v, 0));

  // 3. Linear 2: z2 = a1 @ W2 + b2
  const z2 = new Array(NUM_CLASSES).fill(0);
  for (let j = 0; j < NUM_CLASSES; j++) {
    let sum = 0;
    for (let i = 0; i < HIDDEN_DIM; i++) {
      sum += a1[i] * W2[i][j];
    }
    z2[j] = sum + b2[j];
  }

  // 4. Softmax
  const maxZ2 = Math.max(...z2);
  const expZ2 = z2.map((v) => Math.exp(v - maxZ2));
  const sumExp = expZ2.reduce((a, b) => a + b, 0);
  const probs = expZ2.map((v) => v / sumExp);

  // 5. Argmax
  let predClass = 0;
  let maxProb = probs[0];
  for (let j = 1; j < NUM_CLASSES; j++) {
    if (probs[j] > maxProb) {
      maxProb = probs[j];
      predClass = j;
    }
  }

  const mapping = ["BUY_ETH", "BUY_USDC", "HOLD"];

  return {
    probs: {
      BUY_ETH: Number(probs[0].toFixed(6)),
      BUY_USDC: Number(probs[1].toFixed(6)),
      HOLD: Number(probs[2].toFixed(6)),
    },
    predClass,
    predToken: CLASS_TOKENS[predClass],
    predWord: mapping[predClass],
    confidence: Number(maxProb.toFixed(6)),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { features } = body;

    // Validate inputs
    if (!features || !Array.isArray(features) || features.length !== INPUT_DIM) {
      return NextResponse.json(
        { success: false, error: `Invalid features: expected array of ${INPUT_DIM} float features` },
        { status: 400 }
      );
    }

    // Load weights and run real forward pass
    const weights = loadWeights();
    const result = forward(features, weights);

    // Generate scaled features for contract simulation
    const scaledFeatures = features.map((f) => Math.round(f * 1_000_000));

    return NextResponse.json({
      success: true,
      source: "real_model_weights",
      features,
      scaledFeatures,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
