/** @type {import('next').NextConfig} */
const path = require("path");

const nextConfig = {
  // This app imports the shared i18n/translate.ts from the monorepo root
  // (../../i18n/translate, used by i18n/LocaleProvider.tsx) — same
  // monorepo-tracing concern as admin-web, see that app's next.config.js.
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: {
    externalDir: true,
  },
};

module.exports = nextConfig;
