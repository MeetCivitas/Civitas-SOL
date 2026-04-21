#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────
# Build script for the Civitas voucher redemption circuit
# Compiles the Circom circuit and generates proving/verification keys
# ─────────────────────────────────────────────────────────────────────

CIRCUIT_NAME="voucher"
CIRCUIT_FILE="voucher.circom"
BUILD_DIR="build"
PTAU_FILE="pot20_final.ptau"

echo "🔧 Building Civitas Voucher Redemption Circuit"
echo "================================================"

# Create build directory
mkdir -p "$BUILD_DIR"

# ── Step 1: Download Powers of Tau (if not present) ─────────────────
if [ ! -f "$BUILD_DIR/$PTAU_FILE" ]; then
    echo ""
    echo "📥 Downloading Powers of Tau (pot20)..."
    echo "   This is needed for depth-20 Merkle tree (2^20+ constraints)"
    curl -L -o "$BUILD_DIR/$PTAU_FILE" \
        "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_20.ptau"
else
    echo "✅ Powers of Tau already downloaded"
fi

# ── Step 2: Compile circuit ─────────────────────────────────────────
echo ""
echo "⚙️  Compiling circuit: $CIRCUIT_FILE"
circom "$CIRCUIT_FILE" \
    --r1cs \
    --wasm \
    --sym \
    -o "$BUILD_DIR" \
    -l ../node_modules

echo "   R1CS:  $BUILD_DIR/${CIRCUIT_NAME}.r1cs"
echo "   WASM:  $BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm"
echo "   SYM:   $BUILD_DIR/${CIRCUIT_NAME}.sym"

# ── Step 3: Generate proving key (Phase 2) ──────────────────────────
echo ""
echo "🔑 Generating proving key (Groth16 setup)..."
snarkjs groth16 setup \
    "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" \
    "$BUILD_DIR/$PTAU_FILE" \
    "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

# Contribute to ceremony (deterministic for reproducibility in dev)
echo "   Contributing to ceremony..."
snarkjs zkey contribute \
    "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
    "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    --name="civitas-dev" -v -e="civitas-entropy-string"

# ── Step 4: Export verification key ─────────────────────────────────
echo ""
echo "📋 Exporting verification key..."
snarkjs zkey export verificationkey \
    "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    "$BUILD_DIR/verification_key.json"

# ── Step 5: Copy artifacts to frontend ──────────────────────────────
echo ""
echo "📦 Copying artifacts to frontend..."
FRONTEND_ZK="../frontend/public/zk"
mkdir -p "$FRONTEND_ZK"
cp "$BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm" "$FRONTEND_ZK/"
cp "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$FRONTEND_ZK/"
cp "$BUILD_DIR/verification_key.json" "$FRONTEND_ZK/"

echo ""
echo "✅ Build complete!"
echo ""
echo "Artifacts:"
echo "  WASM:             $FRONTEND_ZK/${CIRCUIT_NAME}.wasm"
echo "  Proving key:      $FRONTEND_ZK/${CIRCUIT_NAME}_final.zkey"
echo "  Verification key: $FRONTEND_ZK/verification_key.json"
echo ""
echo "R1CS info:"
snarkjs r1cs info "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" 2>/dev/null || true
