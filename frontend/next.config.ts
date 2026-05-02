import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // outputFileTracingRoot scopes tracing to this app, avoiding repo-root lockfile scanning
  outputFileTracingRoot: process.cwd(),

  // 1. Force these packages to run in Node.js runtime, not the edge or bundled browser runtime
  serverExternalPackages: [
    '@nillion/secretvaults',
    '@nillion/nuc',
  ],

  // 2. Output standalone is good for Docker builds
  output: 'standalone',

  // 3. Webpack config
  webpack: (config, { isServer }) => {
    // Enable async WASM for snarkjs (Groth16 prover) — voucher.wasm + voucher.zkey
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    if (isServer) {
      // Ensure we don't try to bundle these test files
      config.resolve.alias = {
        ...config.resolve.alias,
        'thread-stream/test': false,
        'thread-stream/bench': false,
      };

      // OPTIONAL: If you are using native modules or binary execution
      config.externals.push('child_process', 'fs', 'net');
    } else {
      // Ignore node-specific dependencies in the browser bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
        module: false,
        "fs/promises": false,
        net: false,
        tty: false,
        child_process: false,
        perf_hooks: false,
        worker_threads: false,
      };

      // Some subpath imports require aliasing instead of just fallbacks
      config.resolve.alias = {
        ...config.resolve.alias,
        "stream/promises": false,
      };
    }
    return config;
  },
};

export default nextConfig;
