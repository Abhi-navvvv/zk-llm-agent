.PHONY: train build test-all prove

train:
	venv/bin/python model/model.py
	node scripts/copy-weights.js

build:
	pnpm install
	node scripts/copy-weights.js
	cargo build --release
	pnpm --filter web build

test-all:
	venv/bin/python model/test_model.py
	cargo test --workspace
	cd contracts && export PATH="$$HOME/.foundry/bin:$$PATH" && forge test -vvv
	pnpm --filter web test:e2e

prove:
	cargo run --release --bin zk-llm-script -- --prove
