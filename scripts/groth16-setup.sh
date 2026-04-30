#!/usr/bin/env bash
# scripts/groth16-setup.sh
# One-time Groth16 trusted setup for the voucher circuit.
#
# What this does:
#   1. Compiles circuits/voucher_circom/voucher.circom → r1cs + wasm
#   2. Downloads Hermez powersOfTau (pot15_final.ptau, 32K constraints)
#   3. Runs `snarkjs groth16 setup` to produce voucher_0000.zkey
#   4. Runs `snarkjs zkey contribute` (single contribution from this machine)
#   5. Exports verification key JSON
#   6. Runs scripts/vk-to-rust.ts to embed VK as keys/voucher_vk.bin
#   7. Copies wasm + zkey to frontend/public/zk/ for the client prover
#
# Re-run this whenever the circuit constraints change. The `voucher_vk.bin`
# is checked into git so the on-chain program builds without external state.
#
# Requirements (install these first):
#   - circom 2.x   (https://docs.circom.io/getting-started/installation/)
#   - snarkjs      (npm i -g snarkjs)
#   - circomlib    (npm i circomlib in this repo)
#   - tsx          (npx tsx ...)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRC="$ROOT/circuits/voucher_circom"
BUILD="$CIRC/build"
KEYS="$ROOT/programs/civitas-payroll/keys"
PUBZK="$ROOT/frontend/public/zk"

mkdir -p "$BUILD" "$KEYS" "$PUBZK"

# ── 0. Verify circomlib is available ──────────────────────────────────────
if [ ! -d "$ROOT/node_modules/circomlib" ] && [ ! -d "$CIRC/node_modules/circomlib" ]; then
  echo "circomlib not found. Run:  cd $ROOT && npm i circomlib"
  exit 1
fi

# ── 1. Compile circuit ────────────────────────────────────────────────────
echo "[1/6] Compiling voucher.circom..."
circom "$CIRC/voucher.circom" \
  --r1cs --wasm --sym \
  -o "$BUILD" \
  -l "$ROOT/node_modules"

# ── 2. Download powers-of-tau ─────────────────────────────────────────────
# Multiple mirrors — Hermez S3 returns 403 since 2025; gcloud is the
# Polygon zkEVM-maintained mirror.
PTAU="$BUILD/pot15_final.ptau"
PTAU_URLS=(
  "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau"
  "https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"
)
if [ ! -f "$PTAU" ] || [ "$(wc -c <"$PTAU" 2>/dev/null || echo 0)" -lt 1000000 ]; then
  echo "[2/6] Downloading powers-of-tau (pot15_final.ptau)..."
  for u in "${PTAU_URLS[@]}"; do
    echo "  trying: $u"
    rm -f "$PTAU"
    if curl -L --fail --connect-timeout 10 -o "$PTAU" "$u" && [ -s "$PTAU" ]; then
      echo "  ✓ downloaded $(wc -c <"$PTAU") bytes"
      break
    fi
  done
  if [ ! -s "$PTAU" ]; then
    echo "ERROR: could not download pot15_final.ptau from any mirror"
    exit 1
  fi
fi

# ── 3. groth16 setup ──────────────────────────────────────────────────────
echo "[3/6] groth16 setup..."
snarkjs groth16 setup \
  "$BUILD/voucher.r1cs" \
  "$PTAU" \
  "$BUILD/voucher_0000.zkey"

# ── 4. Contribution (single, from this machine — for production add more) ─
echo "[4/6] zkey contribute..."
ENTROPY="${SETUP_ENTROPY:-$(date +%s%N)$RANDOM}"
snarkjs zkey contribute \
  "$BUILD/voucher_0000.zkey" \
  "$BUILD/voucher_final.zkey" \
  --name="civitas-v3-$(date +%Y%m%d)" \
  -e="$ENTROPY"

# ── 5. Export verification key ────────────────────────────────────────────
echo "[5/6] Exporting verification key..."
snarkjs zkey export verificationkey \
  "$BUILD/voucher_final.zkey" \
  "$BUILD/verification_key.json"

# ── 6. Convert VK → BPF binary + copy artifacts to frontend ───────────────
echo "[6/6] Converting VK to Rust binary + copying client artifacts..."
npx -y tsx "$ROOT/scripts/vk-to-rust.ts" \
  "$BUILD/verification_key.json" \
  "$KEYS/voucher_vk.bin"

cp "$BUILD/voucher_final.zkey" "$PUBZK/voucher_final.zkey"
cp "$BUILD/voucher_js/voucher.wasm" "$PUBZK/voucher.wasm"
cp "$BUILD/verification_key.json" "$PUBZK/verification_key.json"

echo
echo "✓ Trusted setup complete."
echo "  on-chain VK : $KEYS/voucher_vk.bin"
echo "  client wasm : $PUBZK/voucher.wasm"
echo "  client zkey : $PUBZK/voucher_final.zkey"
echo
echo "Next: anchor build && anchor deploy --provider.cluster devnet"
