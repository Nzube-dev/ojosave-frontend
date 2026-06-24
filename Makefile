CONTRACT_DIR := contracts/subscription
TARGET_DIR   := contracts/target
WASM_PATH    := $(TARGET_DIR)/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

# Supported triple → environment variables used by build/test recipes
TARGET_TRIPLE ?= wasm32-unknown-unknown
PROFILE       ?= release
ARTIFACT_NAME ?= soroban_subscription_contract
ARTIFACT_PATH  = $(TARGET_DIR)/$(TARGET_TRIPLE)/$(PROFILE)/$(ARTIFACT_NAME).wasm

CARGO_FLAGS   = --manifest-path $(CONTRACT_DIR)/Cargo.toml --target $(TARGET_TRIPLE) --$(PROFILE)

.PHONY: build test clean

# build: Compile the contract to WASM using the current $(TARGET_TRIPLE) and $(PROFILE)
# Override at the command line, e.g.:
#   make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release
# Add new triple:
#   1) rustup target add <triple>
#   2) make build TARGET_TRIPLE=<triple>
build:
	cargo build $(CARGO_FLAGS)
	@test -f "$(ARTIFACT_PATH)" || \
		(echo "ERROR: WASM artifact not found at $(ARTIFACT_PATH)" >&2; exit 1)

# test: Run cargo tests for the contract (native host test, not WASM)
# Note: cargo test cannot cross-compile to WASM; keep this target native.
test:
	cargo test --manifest-path $(CONTRACT_DIR)/Cargo.toml

# clean: Remove all build artifacts for the contract
clean:
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml
