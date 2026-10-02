/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  // Monorepo: this app imports files from ../lib (Phase 2/3's shared
  // tripStateMachine/matching/escrow/payments/push modules). Without this,
  // Next's serverless output-file-tracing (used for Vercel's Node functions)
  // may not correctly resolve the workspace root, and either bundles too
  // much or misses files outside admin-web/. Point it at the monorepo root
  // (one level up) explicitly rather than relying on lockfile auto-detection.
  outputFileTracingRoot: path.join(__dirname, ".."),

  experimental: {
    // Needed on some Next 14 versions for outputFileTracingRoot with
    // path aliases that escape the app directory; harmless if unused.
    externalDir: true,
  },
};

module.exports = nextConfig;
