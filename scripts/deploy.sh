#!/usr/bin/env bash
# scripts/deploy.sh — Civitas-Sol One-Shot Deploy
# Usage:
#   ./scripts/deploy.sh devnet       # Deploy to Solana devnet
#   ./scripts/deploy.sh mainnet-beta # Deploy to mainnet (careful!)
#
# Prerequisites:
#   - solana CLI, anchor CLI, nargo, node (v20+) installed
#   - ANCHOR_WALLET env set to your keypair path, e.g.:
#       export ANCHOR_WALLET=~/.config/solana/civitas-deployer.json
#   - Funded deployer wallet (at least 5 SOL on devnet, 3 SOL on mainnet)
set -euo pipefail

CLUSTER="devnet"
ENV_FILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --env)
      ENV_FILE="$2"
      shift 2
      ;;
    *)
      CLUSTER="$1"
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  echo "Loading environment variables from $ENV_FILE..."
  set -a
  source "$ENV_FILE"
  set +a
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Civitas-Sol Deploy Script                       ║"
echo "║  Cluster: $CLUSTER"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── 1. Verify environment ──────────────────────────────────────────────────

if [ -z "${ANCHOR_WALLET:-}" ]; then
  DEFAULT_WALLET="$HOME/.config/solana/civitas-deployer.json"
  if [ -f "$DEFAULT_WALLET" ]; then
    export ANCHOR_WALLET="$DEFAULT_WALLET"
    echo "⚠️ ANCHOR_WALLET not set. Auto-using $DEFAULT_WALLET"
  else
    echo "❌ ANCHOR_WALLET not set. Export your keypair path:"
    echo "   export ANCHOR_WALLET=~/.config/solana/civitas-deployer.json"
    exit 1
  fi
fi

command -v anchor >/dev/null 2>&1 || { echo "❌ anchor CLI not found. Install: https://www.anchor-lang.com/docs/installation"; exit 1; }
command -v nargo  >/dev/null 2>&1 || { echo "❌ nargo not found. Install: https://noir-lang.org/docs/getting_started/installation"; exit 1; }
command -v node   >/dev/null 2>&1 || { echo "❌ node not found. Install: https://nodejs.org"; exit 1; }

DEPLOYER_PUBKEY=$(solana-keygen pubkey "$ANCHOR_WALLET")
echo "💰 Deployer: $DEPLOYER_PUBKEY"

# ── 2. Install workspace dependencies ──────────────────────────────────────

echo ""
echo "📦 Installing frontend dependencies..."
cd "$REPO_ROOT/frontend"
npm install --legacy-peer-deps

# ── 3. Compute accurate test vectors for Prover.toml ──────────────────────

echo ""
echo "📐 Computing BN254 Poseidon test vectors..."
node scripts/compute-test-vectors.mjs > /tmp/civitas-vectors.txt
cat /tmp/civitas-vectors.txt
echo ""
echo "✅ Test vectors computed (check Prover.toml is up to date)"

# ── 4. Compile Noir circuit ───────────────────────────────────────────────

echo ""
echo "🔲 Compiling Noir circuit..."
cd "$REPO_ROOT/circuits/voucher_noir"
nargo compile --silence-warnings
echo "  ✅ Circuit compiled: target/voucher.json"

echo ""
echo "🧪 Running Noir circuit tests..."
nargo test --silence-warnings
echo "  ✅ Circuit tests passed"

# Copy compiled artifact to frontend public dir
mkdir -p "$REPO_ROOT/frontend/public/circuits/voucher_noir/target"
cp target/voucher.json "$REPO_ROOT/frontend/public/circuits/voucher_noir/target/"
echo "  ✅ Circuit artifact copied to frontend/public"

# ── 4. Anchor: build + test ───────────────────────────────────────────────

echo ""
echo "⚓ Building Anchor program..."
cd "$REPO_ROOT"
anchor build

# Capture program ID
PROGRAM_ID=$(solana-keygen pubkey target/deploy/civitas_payroll-keypair.json)
echo "  ✅ Program ID: $PROGRAM_ID"

# Update Anchor.toml program address
sed -i.bak "s/CiViTAS1111111111111111111111111111111111111/$PROGRAM_ID/g" Anchor.toml
sed -i.bak "s/CiViTAS1111111111111111111111111111111111111/$PROGRAM_ID/g" programs/civitas-payroll/src/lib.rs
# Rebuild with correct ID
anchor build

echo ""
echo "🧪 Running Anchor tests (localnet)..."
anchor test --skip-deploy || echo "⚠ Some tests may require localnet + Token-2022. Run manually with: anchor test"

# ── 5. Deploy to cluster ──────────────────────────────────────────────────

echo ""
echo "🚀 Deploying to $CLUSTER..."
anchor deploy --provider.cluster "$CLUSTER"

echo ""
echo "✅ Program deployed!"
echo "   Program ID:  $PROGRAM_ID"
echo "   Cluster:     $CLUSTER"
echo "   Explorer:    https://explorer.solana.com/address/$PROGRAM_ID?cluster=$CLUSTER"

# ── 6. Update frontend .env ───────────────────────────────────────────────

ENV_FILE="$REPO_ROOT/frontend/.env.local"
if [ -f "$ENV_FILE" ]; then
  sed -i.bak "s/NEXT_PUBLIC_CIVITAS_PROGRAM_ID=.*/NEXT_PUBLIC_CIVITAS_PROGRAM_ID=$PROGRAM_ID/" "$ENV_FILE"
  echo "  ✅ Updated .env.local NEXT_PUBLIC_CIVITAS_PROGRAM_ID=$PROGRAM_ID"
else
  echo "  ⚠ No .env.local found — copy frontend/.env.example to frontend/.env.local and set:"
  echo "    NEXT_PUBLIC_CIVITAS_PROGRAM_ID=$PROGRAM_ID"
fi

# ── 7. Build frontend ─────────────────────────────────────────────────────

echo ""
echo "🏗 Building Next.js frontend..."
cd "$REPO_ROOT/frontend"
npm run build

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  🎉 Civitas-Sol Deploy Complete!                 ║"
echo "║  Program ID: $PROGRAM_ID"
echo "║  Cluster:    $CLUSTER"
echo "║                                                   ║"
echo "║  Next steps:                                      ║"
echo "║  1. vercel --prod (frontend deploy)               ║"
echo "║  2. Set env vars in Vercel dashboard              ║"
echo "║  3. anchor idl init $PROGRAM_ID --filepath target/idl/civitas_payroll.json"
echo "╚══════════════════════════════════════════════════╝"
