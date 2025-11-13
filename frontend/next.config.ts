import type { NextConfig } from "next";

const apiInternalURL =
  process.env.API_INTERNAL_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiInternalURL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
