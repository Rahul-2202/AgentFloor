import type { NextConfig } from "next";
import { existsSync } from "node:fs";

// Locally, the one .env lives at the repo root. On Railway, variables come from the service.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const nextConfig: NextConfig = {
  // Shared types and rule labels come straight from the monorepo's TypeScript.
  transpilePackages: ["@agentfloor/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  // Browser-visible settings, baked in at build time. The same names as the API's
  // variables work too, so one .env serves both.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
