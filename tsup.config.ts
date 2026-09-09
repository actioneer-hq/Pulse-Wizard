import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: true,
  // shebang so `dist/cli.js` is directly executable as the bin
  banner: { js: "#!/usr/bin/env node" },
});
