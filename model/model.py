import numpy as np
import json
import os

# 15 continuous DeFi features (normalized to [-1.0, 1.0])
FEATURES = [
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
]

INPUT_DIM = len(FEATURES)
HIDDEN_DIM = 16
NUM_CLASSES = 3  # 0: BUY_ETH (token 14), 1: BUY_USDC (token 15), 2: HOLD (token 16)
CLASS_TOKENS = [14, 15, 16]

class NumPyMLPClassifier:
    def __init__(self, input_dim=INPUT_DIM, hidden_dim=HIDDEN_DIM, num_classes=NUM_CLASSES):
        # Initialize weights with standard normal scaled by Xavier/He style init
        self.W1 = np.random.randn(input_dim, hidden_dim) * np.sqrt(2.0 / input_dim)
        self.b1 = np.zeros((1, hidden_dim))
        self.W2 = np.random.randn(hidden_dim, num_classes) * np.sqrt(2.0 / hidden_dim)
        self.b2 = np.zeros((1, num_classes))

    def forward(self, X):
        # X: [B, INPUT_DIM]
        # Linear 1
        z1 = np.dot(X, self.W1) + self.b1  # [B, HIDDEN_DIM]
        # ReLU
        a1 = np.maximum(z1, 0)  # [B, HIDDEN_DIM]
        # Linear 2
        z2 = np.dot(a1, self.W2) + self.b2  # [B, NUM_CLASSES]
        # Softmax
        exp_z2 = np.exp(z2 - np.max(z2, axis=1, keepdims=True))
        probs = exp_z2 / np.sum(exp_z2, axis=1, keepdims=True)
        
        self.cache = (X, z1, a1, probs)
        return probs

    def backward(self, targets, lr=0.01):
        # targets: [B] (values are 0, 1, or 2)
        X, z1, a1, probs = self.cache
        B = X.shape[0]
        
        # Convert targets to one-hot
        one_hot = np.zeros_like(probs)
        one_hot[np.arange(B), targets] = 1.0
        
        # Loss derivative w.r.t z2
        dz2 = (probs - one_hot) / B  # [B, C]
        
        # Gradients for layer 2
        dW2 = np.dot(a1.T, dz2)  # [H, C]
        db2 = np.sum(dz2, axis=0, keepdims=True)  # [1, C]
        
        # Backprop to a1
        da1 = np.dot(dz2, self.W2.T)  # [B, H]
        # Backprop through ReLU
        dz1 = da1 * (z1 > 0)  # [B, H]
        
        # Gradients for layer 1
        dW1 = np.dot(X.T, dz1)  # [D, H]
        db1 = np.sum(dz1, axis=0, keepdims=True)  # [1, H]
        
        # Update weights
        self.W1 -= lr * dW1
        self.b1 -= lr * db1
        self.W2 -= lr * dW2
        self.b2 -= lr * db2

def generate_synthetic_data(num_samples=1000):
    np.random.seed(42)
    # Generate random continuous features in normalized range [-1.0, 1.0]
    X = np.random.uniform(-1.0, 1.0, (num_samples, INPUT_DIM))

    targets = []
    for i in range(num_samples):
        mom_24h = X[i, 1]
        vol = X[i, 2]
        
        # Balanced, clean decision boundary using normalized inputs
        if mom_24h > 0.2 and vol < 0.2:
            target = 0  # BUY_ETH
        elif mom_24h < -0.2:
            target = 1  # BUY_USDC
        else:
            target = 2  # HOLD
        targets.append(target)
        
    return X, np.array(targets)

def train_and_export():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    weights_dir = os.path.join(script_dir, "weights")
    os.makedirs(weights_dir, exist_ok=True)
    
    # Generate data
    x_train, y_train = generate_synthetic_data(2000)
    x_val, y_val = generate_synthetic_data(500)
    
    # Initialize model
    model = NumPyMLPClassifier(
        input_dim=INPUT_DIM,
        hidden_dim=HIDDEN_DIM,
        num_classes=NUM_CLASSES
    )
    
    print("Training continuous MLP model in pure NumPy...")
    for epoch in range(1000):
        probs = model.forward(x_train)
        model.backward(y_train, lr=1.0)
        
        # Validate
        val_probs = model.forward(x_val)
        val_preds = np.argmax(val_probs, axis=1)
        acc = np.mean(val_preds == y_val)
        
        if (epoch + 1) % 100 == 0:
            loss = -np.mean(np.log(probs[np.arange(len(y_train)), y_train] + 1e-15))
            print(f"Epoch {epoch+1}/1000 - Loss: {loss:.4f} - Val Acc: {acc:.4f}")
            
    # Save weights to binary format for Rust
    weights_bin = bytearray()
    tensors = [
        ("W1", model.W1),
        ("b1", model.b1.flatten()), # flatten to 1D
        ("W2", model.W2),
        ("b2", model.b2.flatten())  # flatten to 1D
    ]
    
    for name, t in tensors:
        print(f"Exporting {name} with shape {t.shape}")
        t_f32 = t.astype(np.float32)
        weights_bin.extend(t_f32.tobytes())
        
    with open(os.path.join(weights_dir, "weights.bin"), "wb") as f:
        f.write(weights_bin)
        
    print("Exported weights.bin successfully!")

    # Write configs
    config = {
        "features": FEATURES,
        "input_dim": INPUT_DIM,
        "hidden_dim": HIDDEN_DIM,
        "num_classes": NUM_CLASSES,
        "class_tokens": CLASS_TOKENS
    }
    with open(os.path.join(weights_dir, "config.json"), "w") as f:
        json.dump(config, f, indent=2)
        
    # Write a sample input/output test case to verify Rust correctness
    test_features = np.zeros(INPUT_DIM)
    test_features[0] = 0.1
    test_features[1] = 0.5      # strong 24h momentum (> 0.2)
    test_features[2] = -0.3     # low volatility (< 0.2)
    test_features[3:] = 0.0 # rest zero
    
    # Scale to 6 decimal places (integer) for Solidity interface
    scaled_features = (test_features * 1_000_000).astype(np.int64)
    
    test_probs = model.forward(test_features.reshape(1, -1))[0]
    test_pred_class = np.argmax(test_probs)
    test_pred_token = CLASS_TOKENS[test_pred_class]
    
    mapping = {14: "BUY_ETH", 15: "BUY_USDC", 16: "HOLD"}
    
    test_case = {
        "features": test_features.tolist(),
        "scaled_features": scaled_features.tolist(),
        "probs": test_probs.tolist(),
        "pred_class": int(test_pred_class),
        "pred_token": int(test_pred_token),
        "pred_word": mapping[test_pred_token]
    }
    with open(os.path.join(weights_dir, "test_case.json"), "w") as f:
        json.dump(test_case, f, indent=2)
    print("Exported test_case.json successfully!")

if __name__ == "__main__":
    train_and_export()
