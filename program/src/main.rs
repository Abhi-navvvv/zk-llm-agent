#![no_main]
sp1_zkvm::entrypoint!(main);

use tiny_keccak::{Hasher, Keccak};

const INPUT_DIM: usize = 15;
const HIDDEN_DIM: usize = 16;
const NUM_CLASSES: usize = 3;

pub fn main() {
    // 1. Read dynamic weights from host
    let weights_bytes = sp1_zkvm::io::read_vec();
    
    // 2. Compute Keccak-256 hash of the model weights
    let mut hasher = Keccak::v256();
    hasher.update(&weights_bytes);
    let mut weights_hash = [0u8; 32];
    hasher.finalize(&mut weights_hash);
    
    // 3. Parse weights from the byte array
    let mut offset = 0;
    
    // W1: [15, 16]
    let mut w1 = [[0.0f32; HIDDEN_DIM]; INPUT_DIM];
    for i in 0..INPUT_DIM {
        for j in 0..HIDDEN_DIM {
            let chunk: [u8; 4] = weights_bytes[offset..offset+4].try_into().unwrap();
            w1[i][j] = f32::from_le_bytes(chunk);
            offset += 4;
        }
    }
    
    // b1: [16]
    let mut b1 = [0.0f32; HIDDEN_DIM];
    for j in 0..HIDDEN_DIM {
        let chunk: [u8; 4] = weights_bytes[offset..offset+4].try_into().unwrap();
        b1[j] = f32::from_le_bytes(chunk);
        offset += 4;
    }
    
    // W2: [16, 3]
    let mut w2 = [[0.0f32; NUM_CLASSES]; HIDDEN_DIM];
    for i in 0..HIDDEN_DIM {
        for j in 0..NUM_CLASSES {
            let chunk: [u8; 4] = weights_bytes[offset..offset+4].try_into().unwrap();
            w2[i][j] = f32::from_le_bytes(chunk);
            offset += 4;
        }
    }
    
    // b2: [3]
    let mut b2 = [0.0f32; NUM_CLASSES];
    for j in 0..NUM_CLASSES {
        let chunk: [u8; 4] = weights_bytes[offset..offset+4].try_into().unwrap();
        b2[j] = f32::from_le_bytes(chunk);
        offset += 4;
    }
    
    // 4. Read features from host (fixed-point i32, scaled by 1e6)
    let input_features_scaled = sp1_zkvm::io::read::<[i32; INPUT_DIM]>();
    
    // Convert to f32
    let mut features = [0.0f32; INPUT_DIM];
    for i in 0..INPUT_DIM {
        features[i] = input_features_scaled[i] as f32 / 1_000_000.0;
    }
    
    // 5. Forward Pass
    
    // Linear 1: z1 = X * W1 + b1
    let mut z1 = [0.0f32; HIDDEN_DIM];
    for j in 0..HIDDEN_DIM {
        let mut sum = 0.0f32;
        for i in 0..INPUT_DIM {
            sum += features[i] * w1[i][j];
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
        exp_z2[j] = (z2[j] - max_z2).exp();
        sum_exp += exp_z2[j];
    }
    
    let mut probs = [0.0f32; NUM_CLASSES];
    for j in 0..NUM_CLASSES {
        probs[j] = exp_z2[j] / sum_exp;
    }
    
    // Argmax
    let mut pred_class = 0;
    let mut max_prob = probs[0];
    for j in 1..NUM_CLASSES {
        if probs[j] > max_prob {
            max_prob = probs[j];
            pred_class = j;
        }
    }
    
    // Map class to action token: 0 -> 14 (BUY_ETH), 1 -> 15 (BUY_USDC), 2 -> 16 (HOLD)
    let pred_token = match pred_class {
        0 => 14,
        1 => 15,
        _ => 16,
    };
    
    // 6. EVM ABI Encode public values
    // Types: (int256[15] features, uint256 actionToken, bytes32 weightsHash)
    // Size: 17 * 32 = 544 bytes
    let abi_bytes = abi_encode(&input_features_scaled, pred_token, &weights_hash);
    
    // Commit output
    sp1_zkvm::io::commit_slice(&abi_bytes);
}

/// Helper to EVM-ABI encode (int256[15] features, uint256 actionToken, bytes32 weightsHash)
fn abi_encode(features: &[i32; INPUT_DIM], action_token: u32, weights_hash: &[u8; 32]) -> [u8; 544] {
    let mut bytes = [0u8; 544];
    
    // Encode 15 features (each takes a 32-byte slot, big-endian signed two's complement)
    for i in 0..INPUT_DIM {
        let val = features[i] as i64;
        bytes[i * 32 + 24..(i + 1) * 32].copy_from_slice(&val.to_be_bytes());
        if val < 0 {
            // Sign extension for two's complement
            for b in 0..24 {
                bytes[i * 32 + b] = 0xff;
            }
        }
    }
    
    // Encode action_token (offset 15 * 32, takes 32-byte slot)
    let action_val = action_token as u64;
    bytes[15 * 32 + 24..16 * 32].copy_from_slice(&action_val.to_be_bytes());
    
    // Encode weights_hash (offset 16 * 32, takes 32-byte slot)
    bytes[16 * 32..17 * 32].copy_from_slice(weights_hash);
    
    bytes
}
