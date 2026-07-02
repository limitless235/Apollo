import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@huggingface/transformers",
    "onnxruntime-node",
    "sharp",
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
