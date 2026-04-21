#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT/build"
WORKLOAD_DIR="$(cd "$ROOT/../workload" && pwd)/circuits"
PTAU="$ROOT/pot12_final.ptau"

mkdir -p "$BUILD_DIR"
mkdir -p "$WORKLOAD_DIR"

if [ ! -f "$PTAU" ]; then
  echo "Missing pot file: $PTAU"
  echo "Download pot12_final.ptau and place it in $ROOT"
  exit 1
fi

CIRCUITS=("passport" "age_proof" "commitment" "voucher")

for CIR in "${CIRCUITS[@]}"; do
  echo "=== Building circuit: $CIR ==="

  # compile into build/
  circom "$ROOT/${CIR}.circom" --r1cs --wasm --sym -o "$BUILD_DIR"

  # determine paths (supporting both circom output layouts)
  R1CS="$BUILD_DIR/${CIR}.r1cs"
  # wasm may be at build/<CIR>.wasm or build/<CIR>_js/<CIR>.wasm
  if [ -f "$BUILD_DIR/${CIR}.wasm" ]; then
    WASM="$BUILD_DIR/${CIR}.wasm"
  elif [ -f "$BUILD_DIR/${CIR}_js/${CIR}.wasm" ]; then
    WASM="$BUILD_DIR/${CIR}_js/${CIR}.wasm"
  else
    echo "ERROR: cannot find ${CIR}.wasm in $BUILD_DIR or $BUILD_DIR/${CIR}_js/"
    exit 2
  fi

  ZKEY0="$BUILD_DIR/${CIR}_0000.zkey"
  ZKEYF="$BUILD_DIR/${CIR}.zkey"
  VERIF="$BUILD_DIR/verification_${CIR}.json"

  echo "Running groth16 setup for $CIR..."
  snarkjs groth16 setup "$R1CS" "$PTAU" "$ZKEY0"

  echo "Contributing to zkey (non-interactive)..."
  snarkjs zkey contribute "$ZKEY0" "$ZKEYF" --name="auto-contrib" -v || true

  echo "Exporting verification key..."
  snarkjs zkey export verificationkey "$ZKEYF" "$VERIF"

  echo "Copying artifacts to workload/circuits..."
  cp "$WASM" "$WORKLOAD_DIR/${CIR}.wasm"
  cp "$ZKEYF" "$WORKLOAD_DIR/${CIR}.zkey"
  cp "$VERIF" "$WORKLOAD_DIR/verification_${CIR}.json"

  # copy optional witness JS if present (helpful for local witness generation)
  if [ -f "$BUILD_DIR/${CIR}_js/witness_calculator.js" ]; then
    cp "$BUILD_DIR/${CIR}_js/witness_calculator.js" "$WORKLOAD_DIR/${CIR}_witness_calculator.js"
  fi
done

echo "All circuits built. Artifacts available in $WORKLOAD_DIR"
