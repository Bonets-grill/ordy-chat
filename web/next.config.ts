import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
  serverExternalPackages: ["@neondatabase/serverless"],
};

export default nextConfig;
