import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/setup/cloudflare/restore": ["./bootstrap/**", "./cloudflare/migrations/**"],
  },
};

export default nextConfig;
