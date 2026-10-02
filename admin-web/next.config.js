/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: {
    externalDir: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
