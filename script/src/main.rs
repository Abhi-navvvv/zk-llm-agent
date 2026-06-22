use sp1_sdk::{include_elf, ProverClient, SP1Stdin, HashableKey, Elf, Prover, ProvingKey, ProveRequest};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;

// Compile and load the guest program ELF automatically at build time
const ELF: Elf = include_elf!("zk-llm-program");

#[derive(Serialize, Deserialize, Debug)]
struct TestCase {
    features: Vec<f32>,
    scaled_features: Vec<i32>,
    probs: Vec<f32>,
    pred_class: usize,
    pred_token: usize,
    pred_word: String,
}

#[tokio::main]
async fn main() {
    // 1. Initialize Prover Client
    let client = ProverClient::from_env().await;
    let pk = client.setup(ELF).await.unwrap();
    let vk = pk.verifying_key();
    
    println!("SP1 Client Setup completed successfully.");
    println!("Model Image ID / Program VKey: {}", vk.bytes32());

    // 2. Load weights.bin dynamically
    let weights_path = Path::new("model/weights/weights.bin");
    if !weights_path.exists() {
        println!("Error: model/weights/weights.bin not found. Run Python model training first.");
        return;
    }
    let mut weights_file = File::open(weights_path).unwrap();
    let mut weights_bytes = Vec::new();
    weights_file.read_to_end(&mut weights_bytes).unwrap();
    println!("Loaded weights.bin: {} bytes", weights_bytes.len());

    // 3. Load test case from Python export
    let test_case_path = Path::new("model/weights/test_case.json");
    if !test_case_path.exists() {
        println!("Error: model/weights/test_case.json not found.");
        return;
    }
    
    let file = File::open(test_case_path).unwrap();
    let test_case: TestCase = serde_json::from_reader(file).unwrap();
    
    println!("Loaded Test Case from Python:");
    println!("  Features: {:?}", test_case.features);
    println!("  Scaled Features: {:?}", test_case.scaled_features);
    println!("  Expected Prediction: {} (token {})", test_case.pred_word, test_case.pred_token);

    // 4. Set up ZKVM inputs
    let mut stdin = SP1Stdin::new();
    stdin.write_slice(&weights_bytes);
    
    let mut input_features = [0i32; 15];
    for i in 0..15 {
        if i < test_case.scaled_features.len() {
            input_features[i] = test_case.scaled_features[i];
        }
    }
    stdin.write(&input_features);

    // 5. Simulate execution in the ZKVM
    println!("Running ZKVM simulation...");
    let (mut public_values, execution_report) = client.execute(ELF, stdin.clone()).await.unwrap();
    println!("Simulation executed successfully!");
    println!("  Cycle count: {}", execution_report.total_instruction_count());

    // Read the committed public values bytes
    let public_values_bytes = public_values.as_slice();
    println!("Committed Public Values Bytes: {} bytes", public_values_bytes.len());
    
    // Decode the committed public values manually
    // Types: (int256[15] features, uint256 actionToken, bytes32 weightsHash)
    // Size: 544 bytes
    if public_values_bytes.len() == 544 {
        let mut decoded_features = [0i32; 15];
        for i in 0..15 {
            let offset = i * 32;
            let chunk: [u8; 4] = public_values_bytes[offset + 28..offset + 32].try_into().unwrap();
            decoded_features[i] = i32::from_be_bytes(chunk);
        }
        
        let action_token_offset = 15 * 32;
        let action_token_chunk: [u8; 4] = public_values_bytes[action_token_offset + 28..action_token_offset + 32].try_into().unwrap();
        let action_token = u32::from_be_bytes(action_token_chunk);
        
        let weights_hash_offset = 16 * 32;
        let mut weights_hash = [0u8; 32];
        weights_hash.copy_from_slice(&public_values_bytes[weights_hash_offset..weights_hash_offset + 32]);
        
        println!("ZKVM Decoded Outputs:");
        println!("  Decoded Features: {:?}", decoded_features);
        println!("  Decoded Predicted Token: {}", action_token);
        println!("  Decoded Weights Hash (hex): 0x{}", hex::encode(weights_hash));
        
        let mapping = |t: u32| match t {
            14 => "BUY_ETH",
            15 => "BUY_USDC",
            16 => "HOLD",
            _ => "UNKNOWN",
        };
        
        println!("  Decoded Prediction: {}", mapping(action_token));
        
        if action_token as usize == test_case.pred_token {
            println!("✅ Success: ZKVM output matches Python model prediction!");
        } else {
            println!("❌ Warning: ZKVM output ({}) differs from Python ({})", action_token, test_case.pred_token);
        }
    } else {
        println!("❌ Error: Public values bytes length is {}, expected 544", public_values_bytes.len());
    }

    // 6. Generate Proof (if requested)
    let args: Vec<String> = std::env::args().collect();
    let prove_flag = args.contains(&"--prove".to_string());

    if prove_flag {
        println!("Generating Zero-Knowledge Proof (Groth16)... This may take a moment on CPU.");
        
        let proof = client.prove(&pk, stdin).groth16().await.unwrap();
        println!("✅ Proof generated successfully!");

        // Write proof file
        let mut proof_file = File::create("proof.json").unwrap();
        serde_json::to_writer_pretty(&mut proof_file, &proof).unwrap();
        println!("Proof saved to proof.json");

        // Print hex representation of proof for contract testing
        let proof_bytes = proof.bytes();
        println!("Proof bytes (hex): 0x{}", hex::encode(proof_bytes));
    }
}
