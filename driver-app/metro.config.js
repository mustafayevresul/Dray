const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// This app is NOT an npm workspace (React Native and Next.js apps hoisting
// into the same node_modules tree is a common source of dependency-version
// conflicts — e.g. two different Reacts — so driver-app deliberately keeps
// its own node_modules). But it DOES import plain TS/JSON files from the
// monorepo root (../../i18n/translate.ts, ../../i18n/locales/*.json), which
// sit outside Metro's default watched folder (driver-app/ itself). Without
// this, Metro's bundler simply can't find those files and the build fails
// with "Unable to resolve module ../../i18n/translate".
config.watchFolders = [monorepoRoot];

// Because driver-app isn't a workspace, monorepoRoot/node_modules doesn't
// exist — only look up node_modules from driver-app itself, not the root,
// to avoid Metro resolving a package from the wrong tree if one is ever
// added at the repo root for the Next.js apps.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// .json is enabled by default, but explicit here since the locale files
// (../../i18n/locales/*.json) are exactly the kind of cross-boundary import
// this config exists for — worth being explicit about what Metro resolves.
config.resolver.sourceExts = [...config.resolver.sourceExts, "json"];

module.exports = config;
