import numpy as np
import json
import os

# Model Configurations
VOCAB = [
    "<pad>", "<bos>", "<eos>", 
    "MARKET", "BULL", "BEAR", "CRAB",
    "VOLATILITY", "HIGH", "LOW",
    "TREND", "UP", "DOWN",
    "ACTION", "BUY_ETH", "BUY_USDC", "HOLD"
]
VOCAB_MAP = {tok: idx for idx, tok in enumerate(VOCAB)}
INV_VOCAB_MAP = {idx: tok for idx, tok in enumerate(VOCAB)}

EMBED_DIM = 8
HIDDEN_DIM = 16
MAX_LEN = 8
NUM_CLASSES = 3 # BUY_ETH (idx 14), BUY_USDC (idx 15), HOLD (idx 16)
CLASS_TOKENS = [14, 15, 16]

class NumPyMLPClassifier:
    def __init__(self, vocab_size, embed_dim, hidden_dim, num_classes):
        # Initialize weights
        self.W_emb = np.random.randn(vocab_size, embed_dim) * 0.1
        self.W1 = np.random.randn(embed_dim, hidden_dim) * 0.1
        self.b1 = np.zeros((1, hidden_dim))
        self.W2 = np.random.randn(hidden_dim, num_classes) * 0.1
        self.b2 = np.zeros((1, num_classes))

    def forward(self, idx):
        # idx: [B, T]
        B, T = idx.shape
        # Embedding lookup
        # E: [B, T, D]
        E = self.W_emb[idx]
        # Mean pooling over sequence length
        # h: [B, D]
        h = np.mean(E, axis=1)
        # Linear 1
        # z1: [B, H]
        z1 = np.dot(h, self.W1) + self.b1
        # ReLU
        # a1: [B, H]
        a1 = np.maximum(z1, 0)
        # Linear 2
        # z2: [B, C]
        z2 = np.dot(a1, self.W2) + self.b2
        # Softmax
        exp_z2 = np.exp(z2 - np.max(z2, axis=1, keepdims=True))
        probs = exp_z2 / np.sum(exp_z2, axis=1, keepdims=True)
        
        # Cache for backprop
        self.cache = (idx, E, h, z1, a1, probs)
        return probs

    def backward(self, targets, lr=0.01):
        # targets: [B] (values are index in CLASS_TOKENS: 0, 1, or 2)
        idx, E, h, z1, a1, probs = self.cache
        B, T = idx.shape
        
        # Convert targets to one-hot
        one_hot = np.zeros_like(probs)
        one_hot[np.arange(B), targets] = 1.0
        
        # dloss/dz2
        dz2 = (probs - one_hot) / B # [B, C]
        
        # Gradients for W2, b2
        dW2 = np.dot(a1.T, dz2) # [H, C]
        db2 = np.sum(dz2, axis=0, keepdims=True) # [1, C]
        
        # Backprop to a1
        da1 = np.dot(dz2, self.W2.T) # [B, H]
        
        # Backprop through ReLU
        dz1 = da1 * (z1 > 0) # [B, H]
        
        # Gradients for W1, b1
        dW1 = np.dot(h.T, dz1) # [D, H]
        db1 = np.sum(dz1, axis=0, keepdims=True) # [1, H]
        
        # Backprop to h
        dh = np.dot(dz1, self.W1.T) # [B, D]
        
        # Backprop to W_emb
        dW_emb = np.zeros_like(self.W_emb)
        # Spread the gradient dh back to each active token in idx
        for i in range(B):
            for t in range(T):
                token_idx = idx[i, t]
                dW_emb[token_idx] += dh[i] / T
                
        # Update weights
        self.W_emb -= lr * dW_emb
        self.W1 -= lr * dW1
        self.b1 -= lr * db1
        self.W2 -= lr * dW2
        self.b2 -= lr * db2

def generate_synthetic_data(num_samples=1000):
    data = []
    targets = []
    
    for _ in range(num_samples):
        market = np.random.choice(["BULL", "BEAR", "CRAB"])
        vol = np.random.choice(["HIGH", "LOW"])
        
        prompt = ["<bos>", "MARKET", market, "VOLATILITY", vol, "ACTION"]
        idx = [VOCAB_MAP[t] for t in prompt]
        
        # Padding to MAX_LEN = 8
        while len(idx) < MAX_LEN:
            idx.append(VOCAB_MAP["<pad>"])
            
        if market == "BULL" and vol == "LOW":
            target_class = 0 # BUY_ETH (token 14)
        elif market == "BEAR" and vol == "LOW":
            target_class = 1 # BUY_USDC (token 15)
        else:
            target_class = 2 # HOLD (token 16)
            
        data.append(idx)
        targets.append(target_class)
        
    return np.array(data), np.array(targets)

def train_and_export():
    os.makedirs("/Users/abhiii/.gemini/antigravity/scratch/zk-llm-agent/model", exist_ok=True)
    os.makedirs("/Users/abhiii/.gemini/antigravity/scratch/zk-llm-agent/model/weights", exist_ok=True)
    
    # Generate data
    x_train, y_train = generate_synthetic_data(1000)
    x_val, y_val = generate_synthetic_data(200)
    
    # Initialize model
    model = NumPyMLPClassifier(
        vocab_size=len(VOCAB),
        embed_dim=EMBED_DIM,
        hidden_dim=HIDDEN_DIM,
        num_classes=NUM_CLASSES
    )
    
    print("Training micro MLP model in pure NumPy...")
    for epoch in range(100):
        probs = model.forward(x_train)
        model.backward(y_train, lr=0.1)
        
        # Validate
        val_probs = model.forward(x_val)
        val_preds = np.argmax(val_probs, axis=1)
        acc = np.mean(val_preds == y_val)
        
        if (epoch + 1) % 10 == 0:
            loss = -np.mean(np.log(probs[np.arange(len(y_train)), y_train] + 1e-15))
            print(f"Epoch {epoch+1}/100 - Loss: {loss:.4f} - Val Acc: {acc:.4f}")
            
    # Save weights to binary format for Rust
    # Layout order:
    # 1. W_emb: [vocab_size, embed_dim]
    # 2. W1: [embed_dim, hidden_dim]
    # 3. b1: [hidden_dim]
    # 4. W2: [hidden_dim, num_classes]
    # 5. b2: [num_classes]
    
    weights_bin = bytearray()
    
    tensors = [
        ("W_emb", model.W_emb),
        ("W1", model.W1),
        ("b1", model.b1.flatten()), # flatten to 1D
        ("W2", model.W2),
        ("b2", model.b2.flatten())  # flatten to 1D
    ]
    
    for name, t in tensors:
        print(f"Exporting {name} with shape {t.shape}")
        # Convert to float32
        t_f32 = t.astype(np.float32)
        weights_bin.extend(t_f32.tobytes())
        
    with open("/Users/abhiii/.gemini/antigravity/scratch/zk-llm-agent/model/weights/weights.bin", "wb") as f:
        f.write(weights_bin)
        
    print("Exported weights.bin successfully!")

    # Write configs/vocab
    config = {
        "vocab": VOCAB,
        "vocab_map": VOCAB_MAP,
        "embed_dim": EMBED_DIM,
        "hidden_dim": HIDDEN_DIM,
        "num_classes": NUM_CLASSES,
        "max_len": MAX_LEN,
        "class_tokens": CLASS_TOKENS
    }
    with open("/Users/abhiii/.gemini/antigravity/scratch/zk-llm-agent/model/weights/config.json", "w") as f:
        json.dump(config, f, indent=2)
        
    # Write a sample input/output test case to verify Rust correctness
    test_market = "BULL"
    test_vol = "LOW"
    test_prompt = ["<bos>", "MARKET", test_market, "VOLATILITY", test_vol, "ACTION"]
    test_idx = [VOCAB_MAP[t] for t in test_prompt]
    while len(test_idx) < MAX_LEN:
        test_idx.append(VOCAB_MAP["<pad>"])
        
    x_test = np.array([test_idx])
    test_probs = model.forward(x_test)[0]
    test_pred_class = np.argmax(test_probs)
    test_pred_token = CLASS_TOKENS[test_pred_class]
    
    test_case = {
        "prompt": test_prompt,
        "input_idx": test_idx,
        "probs": test_probs.tolist(),
        "pred_class": int(test_pred_class),
        "pred_token": int(test_pred_token),
        "pred_word": INV_VOCAB_MAP[test_pred_token]
    }
    with open("/Users/abhiii/.gemini/antigravity/scratch/zk-llm-agent/model/weights/test_case.json", "w") as f:
        json.dump(test_case, f, indent=2)
    print("Exported test_case.json successfully!")

if __name__ == "__main__":
    train_and_export()
