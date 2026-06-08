#![no_main]
sp1_zkvm::entrypoint!(main);

// Configuration matching Python model.py
const VOCAB_SIZE: usize = 17;
const EMBED_DIM: usize = 8;
const HIDDEN_DIM: usize = 16;
const NUM_CLASSES: usize = 3;
const MAX_LEN: usize = 8;

const CLASS_TOKENS: [usize; 3] = [14, 15, 16];

// The weights.bin file is baked directly into the guest binary!
// This binds the compiled program's Image ID mathematically to this exact model.
const WEIGHTS_BYTES: &[u8] = include_bytes!("weights.bin");

pub fn main() {
    // 1. Read input tokens from host (expected array of size MAX_LEN)
    let input_idx = sp1_zkvm::io::read::<[usize; MAX_LEN]>();
    
    // 2. Parse weights from bytes
    let mut offset = 0;
    
    // W_emb: [VOCAB_SIZE, EMBED_DIM]
    let mut w_emb = [[0.0f32; EMBED_DIM]; VOCAB_SIZE];
    for i in 0..VOCAB_SIZE {
        for j in 0..EMBED_DIM {
            let chunk: [u8; 4] = WEIGHTS_BYTES[offset..offset+4].try_into().unwrap();
            w_emb[i][j] = f32::from_le_bytes(chunk);
            offset += 4;
        }
    }
    
    // W1: [EMBED_DIM, HIDDEN_DIM]
    let mut w1 = [[0.0f32; HIDDEN_DIM]; EMBED_DIM];
    for i in 0..EMBED_DIM {
        for j in 0..HIDDEN_DIM {
            let chunk: [u8; 4] = WEIGHTS_BYTES[offset..offset+4].try_into().unwrap();
            w1[i][j] = f32::from_le_bytes(chunk);
            offset += 4;
        }
    }
    
    // b1: [HIDDEN_DIM]
    let mut b1 = [0.0f32; HIDDEN_DIM];
    for i in 0..HIDDEN_DIM {
        let chunk: [u8; 4] = WEIGHTS_BYTES[offset..offset+4].try_into().unwrap();
        b1[i] = f32::from_le_bytes(chunk);
        offset += 4;
    }
    
    // W2: [HIDDEN_DIM, NUM_CLASSES]
    let mut w2 = [[0.0f32; NUM_CLASSES]; HIDDEN_DIM];
    for i in 0..HIDDEN_DIM {
        for j in 0..NUM_CLASSES {
            let chunk: [u8; 4] = WEIGHTS_BYTES[offset..offset+4].try_into().unwrap();
            w2[i][j] = f32::from_le_bytes(chunk);
            offset += 4;
        }
    }
    
    // b2: [NUM_CLASSES]
    let mut b2 = [0.0f32; NUM_CLASSES];
    for i in 0..NUM_CLASSES {
        let chunk: [u8; 4] = WEIGHTS_BYTES[offset..offset+4].try_into().unwrap();
        b2[i] = f32::from_le_bytes(chunk);
        offset += 4;
    }
    
    // 3. Forward Pass
    
    // Embedding lookup & Mean pooling
    // h: [EMBED_DIM]
    let mut h = [0.0f32; EMBED_DIM];
    for t in 0..MAX_LEN {
        let token = input_idx[t];
        for d in 0..EMBED_DIM {
            h[d] += w_emb[token][d];
        }
    }
    for d in 0..EMBED_DIM {
        h[d] /= MAX_LEN as f32;
    }
    
    // Linear 1: z1 = h * W1 + b1
    let mut z1 = [0.0f32; HIDDEN_DIM];
    for j in 0..HIDDEN_DIM {
        let mut sum = 0.0f32;
        for i in 0..EMBED_DIM {
            sum += h[i] * w1[i][j];
        }
        z1[j] = sum + b1[j];
    }
    
    // ReLU: a1 = max(z1, 0)
    let mut a1 = [0.0f32; HIDDEN_DIM];
    for j in 0..HIDDEN_DIM {
        a1[j] = if z1[j] > 0.0 { z1[j] } else { 0.0 };
    }
    
    // Linear 2: z2 = a1 * W2 + b2
    let mut z2 = [0.0f32; NUM_CLASSES];
    for j in 0..NUM_CLASSES {
        let mut sum = 0.0f32;
        for i in 0..HIDDEN_DIM {
            sum += a1[i] * w2[i][j];
        }
        z2[j] = sum + b2[j];
    }
    
    // Softmax
    let mut max_z2 = z2[0];
    for j in 1..NUM_CLASSES {
        if z2[j] > max_z2 {
            max_z2 = z2[j];
        }
    }
    
    let mut sum_exp = 0.0f32;
    let mut exp_z2 = [0.0f32; NUM_CLASSES];
    for j in 0..NUM_CLASSES {
        // Simple exp approximation or standard float exp (since we are in guest std)
        // Guest targets support standard f32::exp
        exp_z2[j] = (z2[j] - max_z2).exp();
        sum_exp += exp_z2[j];
    }
    
    let mut probs = [0.0f32; NUM_CLASSES];
    for j in 0..NUM_CLASSES {
        probs[j] = exp_z2[j] / sum_exp;
    }
    
    // Argmax to find predicted class index (0, 1, or 2)
    let mut pred_class = 0;
    let mut max_prob = probs[0];
    for j in 1..NUM_CLASSES {
        if probs[j] > max_prob {
            max_prob = probs[j];
            pred_class = j;
        }
    }
    
    let pred_token = CLASS_TOKENS[pred_class];
    
    // 4. Commit results to public IO
    // We commit:
    // - The input tokens (so the smart contract can verify what prompt was used)
    // - The predicted output token (e.g., BUY_ETH / BUY_USDC / HOLD)
    sp1_zkvm::io::commit(&input_idx);
    sp1_zkvm::io::commit(&pred_token);
}
