declare module "snarkjs" {
  export const groth16: {
    fullProve: (
      inputs: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ) => Promise<{
      proof: Record<string, unknown>;
      publicSignals: (string | number)[];
    }>;
    verify: (
      vKey: any,
      publicSignals: any,
      proof: any
    ) => Promise<boolean>;
  };
}

