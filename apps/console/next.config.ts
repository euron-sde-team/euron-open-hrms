import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One self-contained server bundle (`node server.js`), the unit a container image ships.
  output: "standalone",
  // In a monorepo the standalone trace must start at the repo root, or the
  // workspace packages and the hoisted node_modules are left out of the bundle.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The shared packages ship TypeScript source; Next compiles them in place.
  transpilePackages: ["@open-hrms/ui", "@open-hrms/api-client", "@open-hrms/types"],
  poweredByHeader: false,
};

export default nextConfig;
