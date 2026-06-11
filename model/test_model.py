"""Unit tests for the NumPy MLP classifier model."""

import sys
import os
import numpy as np

# Add parent directory to path so we can import model
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import (
    NumPyMLPClassifier, generate_synthetic_data,
    VOCAB, VOCAB_MAP, EMBED_DIM, HIDDEN_DIM, NUM_CLASSES, MAX_LEN, CLASS_TOKENS
)


def test_vocab_consistency():
    """Verify vocab map is consistent with vocab list."""
    assert len(VOCAB) == 17, f"Expected 17 tokens, got {len(VOCAB)}"
    for idx, tok in enumerate(VOCAB):
        assert VOCAB_MAP[tok] == idx, f"VOCAB_MAP mismatch for {tok}"
    print("✅ test_vocab_consistency passed")


def test_model_output_shape():
    """Verify forward pass returns correct shapes."""
    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.array([[1, 3, 4, 7, 9, 13, 0, 0]])  # batch=1, seq=8
    probs = model.forward(x)
    assert probs.shape == (1, NUM_CLASSES), f"Expected (1,3), got {probs.shape}"
    print("✅ test_model_output_shape passed")


def test_softmax_sums_to_one():
    """Verify softmax output sums to 1.0."""
    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.array([[1, 3, 4, 7, 9, 13, 0, 0]])
    probs = model.forward(x)
    total = np.sum(probs, axis=1)
    assert np.allclose(total, 1.0, atol=1e-6), f"Softmax sum is {total}, expected 1.0"
    print("✅ test_softmax_sums_to_one passed")


def test_batch_forward():
    """Verify model handles batched inputs."""
    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.array([
        [1, 3, 4, 7, 9, 13, 0, 0],
        [1, 3, 5, 7, 9, 13, 0, 0],
        [1, 3, 6, 7, 8, 13, 0, 0],
    ])
    probs = model.forward(x)
    assert probs.shape == (3, NUM_CLASSES), f"Expected (3,3), got {probs.shape}"
    assert np.allclose(np.sum(probs, axis=1), 1.0, atol=1e-6)
    print("✅ test_batch_forward passed")


def test_training_converges():
    """Verify model converges to >85% accuracy on synthetic data."""
    np.random.seed(42)
    x_train, y_train = generate_synthetic_data(1000)
    x_val, y_val = generate_synthetic_data(200)

    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)

    for epoch in range(150):
        model.forward(x_train)
        model.backward(y_train, lr=1.0)

    val_probs = model.forward(x_val)
    val_preds = np.argmax(val_probs, axis=1)
    acc = np.mean(val_preds == y_val)

    assert acc > 0.90, f"Model accuracy {acc:.4f} is below 90% threshold"
    print(f"✅ test_training_converges passed (accuracy: {acc:.4f})")


def test_deterministic_predictions():
    """Verify same input produces same output (no stochastic layers)."""
    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.array([[1, 3, 4, 7, 9, 13, 0, 0]])
    probs1 = model.forward(x).copy()
    probs2 = model.forward(x).copy()
    assert np.allclose(probs1, probs2), "Determinism check failed"
    print("✅ test_deterministic_predictions passed")


def test_synthetic_data_distribution():
    """Verify synthetic data covers all 3 classes."""
    _, targets = generate_synthetic_data(1000)
    unique_classes = set(targets.tolist())
    assert unique_classes == {0, 1, 2}, f"Expected classes {{0,1,2}}, got {unique_classes}"

    for c in [0, 1, 2]:
        count = np.sum(targets == c)
        assert count > 50, f"Class {c} has only {count} samples (expected >50)"
    print("✅ test_synthetic_data_distribution passed")


def test_class_tokens_mapping():
    """Verify class tokens map to correct vocab entries."""
    assert VOCAB[CLASS_TOKENS[0]] == "BUY_ETH"
    assert VOCAB[CLASS_TOKENS[1]] == "BUY_USDC"
    assert VOCAB[CLASS_TOKENS[2]] == "HOLD"
    print("✅ test_class_tokens_mapping passed")


def test_backward_updates_weights():
    """Verify backward pass actually updates weights."""
    model = NumPyMLPClassifier(len(VOCAB), EMBED_DIM, HIDDEN_DIM, NUM_CLASSES)
    w1_before = model.W1.copy()

    x = np.array([[1, 3, 4, 7, 9, 13, 0, 0]])
    y = np.array([0])
    model.forward(x)
    model.backward(y, lr=0.1)

    assert not np.allclose(w1_before, model.W1), "Weights were not updated"
    print("✅ test_backward_updates_weights passed")


if __name__ == "__main__":
    test_vocab_consistency()
    test_model_output_shape()
    test_softmax_sums_to_one()
    test_batch_forward()
    test_training_converges()
    test_deterministic_predictions()
    test_synthetic_data_distribution()
    test_class_tokens_mapping()
    test_backward_updates_weights()
    print("\n🎉 All model tests passed!")
