import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  ...(process.env.OPENEDL_PLATFORM === "cloudflare"
    ? {}
    : { output: "standalone" as const }),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...SECURITY_HEADERS],
      },
    ];
  },
};

export default nextConfig;
