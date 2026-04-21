// lib/merkle-tree.ts
// Off-chain Merkle tree builder for Civitas commitment trees
// Uses BN254 Poseidon (ZK-friendly) — mirrors the on-chain light-poseidon and Noir circuit

import { bn128Poseidon2 as poseidon2 } from "./bn128-poseidon";

export const TREE_DEPTH = 20;
const EMPTY_LEAF = BigInt(0);

/**
 * Compute zero hashes for empty tree levels.
 * zeros[0] = 0 (empty leaf)
 * zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
 */
function computeZeroHashes(): bigint[] {
    const zeros: bigint[] = [EMPTY_LEAF];
    for (let i = 0; i < TREE_DEPTH; i++) {
        zeros.push(poseidon2(zeros[i], zeros[i]));
    }
    return zeros;
}

const ZERO_HASHES = computeZeroHashes();

/**
 * Incremental Merkle tree for payroll commitments.
 * Supports efficient append-only insertion and proof generation.
 */
export class MerkleTree {
    public leaves: bigint[] = [];
    private layers: bigint[][] = [];

    constructor(existingLeaves?: bigint[]) {
        if (existingLeaves) {
            this.leaves = [...existingLeaves];
        }
        this.rebuild();
    }

    /** Get the current Merkle root */
    get root(): bigint {
        if (this.layers.length === 0) return ZERO_HASHES[TREE_DEPTH];
        return this.layers[this.layers.length - 1][0] || ZERO_HASHES[TREE_DEPTH];
    }

    /** Get the number of leaves */
    get size(): number {
        return this.leaves.length;
    }

    /** Insert a new leaf (commitment) */
    insert(leaf: bigint): number {
        const index = this.leaves.length;
        this.leaves.push(leaf);
        this.rebuild();
        return index;
    }

    /** Insert multiple leaves at once */
    insertBatch(newLeaves: bigint[]): void {
        this.leaves.push(...newLeaves);
        this.rebuild();
    }

    /**
     * Generate a Merkle proof for a leaf at a given index.
     * Returns path (sibling hashes) and indices (position indicators).
     */
    getProof(index: number): { path: bigint[]; indices: bigint[] } {
        if (index >= this.leaves.length) {
            throw new Error(`Leaf index ${index} out of bounds (${this.leaves.length} leaves)`);
        }

        const path: bigint[] = [];
        const indices: bigint[] = [];
        let currentIndex = index;

        for (let level = 0; level < TREE_DEPTH; level++) {
            const layerSize = this.layers[level]?.length || 0;
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

            if (siblingIndex < layerSize) {
                path.push(this.layers[level][siblingIndex]);
            } else {
                path.push(ZERO_HASHES[level]);
            }

            indices.push(isRight ? BigInt(1) : BigInt(0));
            currentIndex = Math.floor(currentIndex / 2);
        }

        return { path, indices };
    }

    /** Verify a proof against the current root */
    verifyProof(leaf: bigint, path: bigint[], indices: bigint[]): boolean {
        let current = leaf;
        for (let i = 0; i < TREE_DEPTH; i++) {
            if (indices[i] === BigInt(0)) {
                current = poseidon2(current, path[i]);
            } else {
                current = poseidon2(path[i], current);
            }
        }
        return current === this.root;
    }

    /** Get all leaves */
    getLeaves(): bigint[] {
        return [...this.leaves];
    }

    /** Serialize tree state for storage */
    serialize(): string {
        return JSON.stringify({
            leaves: this.leaves.map((l) => l.toString()),
            depth: TREE_DEPTH,
        });
    }

    /** Deserialize tree state */
    static deserialize(json: string): MerkleTree {
        const data = JSON.parse(json);
        const leaves = data.leaves.map((l: string) => BigInt(l));
        return new MerkleTree(leaves);
    }

    /** Rebuild all layers from leaves */
    private rebuild(): void {
        this.layers = [];

        // Level 0: leaves (padded with zeros to next power of 2 if needed)
        const level0 = [...this.leaves];
        this.layers.push(level0);

        // Build upper levels
        for (let level = 0; level < TREE_DEPTH; level++) {
            const currentLayer = this.layers[level];
            const nextLayer: bigint[] = [];

            for (let i = 0; i < currentLayer.length; i += 2) {
                const left = currentLayer[i];
                const right =
                    i + 1 < currentLayer.length
                        ? currentLayer[i + 1]
                        : ZERO_HASHES[level];
                nextLayer.push(poseidon2(left, right));
            }

            // If the previous layer had an odd number or we need more levels
            if (nextLayer.length === 0 && level < TREE_DEPTH - 1) {
                nextLayer.push(ZERO_HASHES[level + 1]);
            }

            this.layers.push(nextLayer);
        }
    }
}

/**
 * Build a Merkle tree from an array of commitment strings.
 */
export function buildMerkleTree(commitments: string[]): MerkleTree {
    const leaves = commitments.map((c) => BigInt(c));
    return new MerkleTree(leaves);
}
