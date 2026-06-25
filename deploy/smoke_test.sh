#!/usr/bin/env bash
# Smoke test for deploy/deploy.sh
# Validates: syntax, env defaults, network selection, and unknown-network rejection.
# Does NOT require stellar CLI or a live network.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/deploy.sh"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WASM_PATH="$REPO_ROOT/contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# ── 1. Syntax check ───────────────────────────────────────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  pass "syntax check"
else
  fail "syntax check"
fi

# ── Stub helpers ──────────────────────────────────────────────────────────────
make_stub_dir() {
  local dir
  dir="$(mktemp -d)"

  # make stub: creates the WASM artifact at the expected path
  cat > "$dir/make" <<STUB
#!/usr/bin/env bash
mkdir -p "$(dirname "$WASM_PATH")"
touch "$WASM_PATH"
STUB
  chmod +x "$dir/make"

  # stellar stub: emits a fake contract ID
  cat > "$dir/stellar" <<'STUB'
#!/usr/bin/env bash
echo "CFAKECONTRACTID000000000000000000000000000000000000000000"
STUB
  chmod +x "$dir/stellar"

  echo "$dir"
}

run_deploy() {
  # $1 = stub dir, remaining = env overrides passed before the script call
  local stub_dir="$1"; shift
  (
    export PATH="$stub_dir:$PATH"
    cd "$REPO_ROOT"
    env "$@" bash "$SCRIPT"
  )
}

# ── 2. testnet run produces contract ID ──────────────────────────────────────
stub="$(make_stub_dir)"
if output=$(run_deploy "$stub" STELLAR_NETWORK=testnet STELLAR_IDENTITY=alice 2>/dev/null) && [ -n "$output" ]; then
  pass "testnet run produces contract ID on stdout"
else
  fail "testnet run produces contract ID on stdout"
fi
rm -rf "$stub"

# ── 3. mainnet run produces contract ID ──────────────────────────────────────
stub="$(make_stub_dir)"
if output=$(run_deploy "$stub" STELLAR_NETWORK=mainnet STELLAR_IDENTITY=alice 2>/dev/null) && [ -n "$output" ]; then
  pass "mainnet run produces contract ID on stdout"
else
  fail "mainnet run produces contract ID on stdout"
fi
rm -rf "$stub"

# ── 4. unknown network is rejected with non-zero exit ────────────────────────
stub="$(make_stub_dir)"
if run_deploy "$stub" STELLAR_NETWORK=badnet 2>/dev/null; then
  fail "unknown network should exit non-zero"
else
  pass "unknown network exits non-zero"
fi
rm -rf "$stub"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
