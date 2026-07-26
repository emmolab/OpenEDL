import type { NextConfig } from "next";

const nextConfig: NextConfig =
  process.env.OPENEDL_PLATFORM === "cloudflare"
    ? {}
    : {
        output: "standalone",
      };

export default nextConfig;
