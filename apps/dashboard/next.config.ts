import path from "path";
import type { NextConfig } from "next";

// Monorepo: root and apps/dashboard both have package-lock.json.
// Pin the tracing/turbopack root so Next stops guessing and warning.
const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
    reactStrictMode: true,
    typescript: {
        ignoreBuildErrors: false,
    },
    outputFileTracingRoot: monorepoRoot,
    turbopack: {
        root: monorepoRoot,
    },
};

export default nextConfig;
