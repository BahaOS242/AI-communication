import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg and the Prisma adapter are Node-only; keep them out of the bundler.
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
