import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Generate the minimal Node server used by the Docker image.
  output: "standalone",
};

export default nextConfig;
