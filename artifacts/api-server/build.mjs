import * as esbuild from "esbuild";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Map of workspace package names to their source entry points
const workspacePackages = {
  "@workspace/db":                     resolve(__dirname, "../../lib/db/src/index.ts"),
  "@workspace/db/schema":              resolve(__dirname, "../../lib/db/src/schema/index.ts"),
  "@workspace/api-zod":                resolve(__dirname, "../../lib/api-zod/src/index.ts"),
  "@workspace/integrations-anthropic-ai": resolve(__dirname, "../../lib/integrations-anthropic-ai/src/index.ts"),
  "@workspace/integrations-anthropic-ai/batch": resolve(__dirname, "../../lib/integrations-anthropic-ai/src/batch/index.ts"),
};

// Plugin: resolve @workspace/* imports to their TypeScript source files
const workspacePlugin = {
  name: "workspace",
  setup(build) {
    build.onResolve({ filter: /^@workspace\// }, (args) => {
      const path = workspacePackages[args.path];
      if (path) return { path };
      console.warn(`Unknown workspace package: ${args.path}`);
      return undefined;
    });
  },
};

const entryPoints = [
  "src/index.ts",
  "src/seed.ts",
  "src/migrate-repair-ai-status.ts",
  "src/migrate-multitenancy.ts",
  "src/migrate-backfill-verified-users.ts",
  "src/migrate-repair-lead-statuses.ts",
  "src/migrate-schema-columns.ts",
  "src/migrate-seed-dreamsdesign.ts",
  "src/migrate-sync-missing-leads.ts",
];

await esbuild.build({
  entryPoints,
  bundle: true,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  // All node_modules packages are external (they're CJS or have native binaries)
  packages: "external",
  plugins: [workspacePlugin],
  sourcemap: true,
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
});
