"""Unit tests for the new continuous 15-feature NumPy MLP classifier model."""

import sys
import os
import numpy as np

# Add parent directory to path so we can import model
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import (
    NumPyMLPClassifier, generate_synthetic_data,
    FEATURES, INPUT_DIM, HIDDEN_DIM, NUM_CLASSES, CLASS_TOKENS
)


def test_feature_list_size():
    """Verify features length is 15."""
    assert len(FEATURES) == 15, f"Expected 15 features, got {len(FEATURES)}"
    print("✅ test_feature_list_size passed")


def test_model_output_shape():
    """Verify forward pass returns correct shapes."""
    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.random.randn(1, INPUT_DIM)
    probs = model.forward(x)
    assert probs.shape == (1, NUM_CLASSES), f"Expected (1,3), got {probs.shape}"
    print("✅ test_model_output_shape passed")


def test_softmax_sums_to_one():
    """Verify softmax output sums to 1.0."""
    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.random.randn(1, INPUT_DIM)
    probs = model.forward(x)
    total = np.sum(probs, axis=1)
    assert np.allclose(total, 1.0, atol=1e-6), f"Softmax sum is {total}, expected 1.0"
    print("✅ test_softmax_sums_to_one passed")


def test_batch_forward():
    """Verify model handles batched inputs."""
    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.random.randn(5, INPUT_DIM)
    probs = model.forward(x)
    assert probs.shape == (5, NUM_CLASSES), f"Expected (5,3), got {probs.shape}"
    assert np.allclose(np.sum(probs, axis=1), 1.0, atol=1e-6)
    print("✅ test_batch_forward passed")


def test_training_converges():
    """Verify model converges to high accuracy on synthetic data."""
    np.random.seed(42)
    x_train, y_train = generate_synthetic_data(1000)
    x_val, y_val = generate_synthetic_data(200)

    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)

    for epoch in range(300):
        model.forward(x_train)
        model.backward(y_train, lr=0.2)

    val_probs = model.forward(x_val)
    val_preds = np.argmax(val_probs, axis=1)
    acc = np.mean(val_preds == y_val)

    assert acc > 0.85, f"Model accuracy {acc:.4f} is below 85% threshold"
    print(f"✅ test_training_converges passed (accuracy: {acc:.4f})")


def test_deterministic_predictions():
    """Verify same input produces same output (no stochastic layers)."""
    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)
    x = np.random.randn(1, INPUT_DIM)
    probs1 = model.forward(x).copy()
    probs2 = model.forward(x).copy()
    assert np.allclose(probs1, probs2), "Determinism check failed"
    print("✅ test_deterministic_predictions passed")


def test_synthetic_data_distribution():
    """Verify synthetic data covers classes."""
    _, targets = generate_synthetic_data(1000)
    unique_classes = set(targets.tolist())
    # Should at least cover HOLD and either BUY_ETH or BUY_USDC
    assert len(unique_classes) >= 2, f"Expected multiple classes, got {unique_classes}"
    print("✅ test_synthetic_data_distribution passed")


def test_class_tokens_mapping():
    """Verify class tokens map to correct indices."""
    assert CLASS_TOKENS[0] == 14
    assert CLASS_TOKENS[1] == 15
    assert CLASS_TOKENS[2] == 16
    print("✅ test_class_tokens_mapping passed")


def test_backward_updates_weights():
    """Verify backward pass actually updates weights."""
    model = NumPyMLPClassifier(INPUT_DIM, HIDDEN_DIM, NUM_CLASSES)
    w1_before = model.W1.copy()

    x = np.random.randn(1, INPUT_DIM)
    y = np.array([0])
    model.forward(x)
    model.backward(y, lr=0.1)

    assert not np.allclose(w1_before, model.W1), "Weights were not updated"
    print("✅ test_backward_updates_weights passed")


if __name__ == "__main__":
    test_feature_list_size()
    test_model_output_shape()
    test_softmax_sums_to_one()
    test_batch_forward()
    test_training_converges()
    test_deterministic_predictions()
    test_synthetic_data_distribution()
    test_class_tokens_mapping()
    test_backward_updates_weights()
    print("\n🎉 All new model tests passed!")
