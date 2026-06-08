use sp1_sdk::{include_elf, ProverClient, SP1Stdin, HashableKey, Elf, Prover, ProvingKey, ProveRequest};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;

// Compile and load the guest program ELF automatically at build time
const ELF: Elf = include_elf!("zk-llm-program");

#[derive(Serialize, Deserialize, Debug)]
struct TestCase {
    prompt: Vec<String>,
    input_idx: Vec<usize>,
    probs: Vec<f32>,
    pred_class: usize,
    pred_token: usize,
    pred_word: String,
}

#[tokio::main]
async fn main() {
    // 1. Initialize Prover Client
    // We use CPU prover client by default (local mock/proving).
    // In production, SP1_PROVER env variable determines if it uses network proving or local GPU.
    let client = ProverClient::from_env().await;
    let pk = client.setup(ELF).await.unwrap();
    let vk = pk.verifying_key();
    
    println!("SP1 Client Setup completed successfully.");
    println!("Model Image ID / Program VKey: {}", vk.bytes32());

    // 2. Load test case from Python export
    let test_case_path = Path::new("model/weights/test_case.json");
    if !test_case_path.exists() {
        println!("Error: model/weights/test_case.json not found. Run Python model training first.");
        return;
    }
    
    let file = File::open(test_case_path).unwrap();
    let test_case: TestCase = serde_json::from_reader(file).unwrap();
    
    println!("Loaded Test Case from Python:");
    println!("  Prompt: {:?}", test_case.prompt);
    println!("  Input Tokens: {:?}", test_case.input_idx);
    println!("  Expected Prediction: {} (token {})", test_case.pred_word, test_case.pred_token);

    // 3. Set up ZKVM inputs
    let mut stdin = SP1Stdin::new();
    let mut input_tokens = [0usize; 8];
    for i in 0..8 {
        if i < test_case.input_idx.len() {
            input_tokens[i] = test_case.input_idx[i];
        }
    }
    stdin.write(&input_tokens);

    // 4. Simulate execution in the ZKVM (cheap & fast verification of logic)
    println!("Running ZKVM simulation...");
    let (mut public_values, execution_report) = client.execute(ELF, stdin.clone()).await.unwrap();
    println!("Simulation executed successfully!");
    println!("  Cycle count: {}", execution_report.total_instruction_count());

    // Read outputs from public values
    let output_input_tokens = public_values.read::<[usize; 8]>();
    let output_pred_token = public_values.read::<usize>();

    println!("ZKVM Outputs:");
    println!("  Verified Input Tokens: {:?}", output_input_tokens);
    println!("  Verified Predicted Token: {}", output_pred_token);
    
    let vocab_words = [
        "<pad>", "<bos>", "<eos>", 
        "MARKET", "BULL", "BEAR", "CRAB",
        "VOLATILITY", "HIGH", "LOW",
        "TREND", "UP", "DOWN",
        "ACTION", "BUY_ETH", "BUY_USDC", "HOLD"
    ];
    let pred_word = if output_pred_token < vocab_words.len() {
        vocab_words[output_pred_token]
    } else {
        "UNKNOWN"
    };
    println!("  Decoded Prediction: {} (token {})", pred_word, output_pred_token);

    // Verify it matches expected output
    if output_pred_token == test_case.pred_token {
        println!("✅ Success: ZKVM output matches Python model prediction!");
    } else {
        println!("❌ Warning: ZKVM output ({}) differs from Python ({})", output_pred_token, test_case.pred_token);
    }

    // 5. Generate Proof (if requested)
    let args: Vec<String> = std::env::args().collect();
    let prove_flag = args.contains(&"--prove".to_string());
    let verifier_flag = args.contains(&"--generate-verifier".to_string());

    if prove_flag {
        println!("Generating Zero-Knowledge Proof (Groth16)... This may take a moment on CPU.");
        
        // Generate EVM-compatible proof (Groth16 wrapper)
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

    if verifier_flag {
        println!("Info: Standard Solidity Verifier contracts are pre-deployed by Succinct.");
        println!("Please use the official @sp1-contracts package or deploy using 'forge install succinctlabs/sp1-contracts'.");
    }
}
