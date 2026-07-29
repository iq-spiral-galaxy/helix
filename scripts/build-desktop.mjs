import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

await build({
  entryPoints: ["electron/main.ts"],
  outfile: "electron/dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  banner: {
    js: [
      'import { createRequire as __helixCreateRequire } from "node:module";',
      "const require = __helixCreateRequire(import.meta.url);",
    ].join("\n"),
  },
  alias: {
    "@iq-helix/core": "./packages/core/dist/index.js",
    "@iq-helix/viewer": "./packages/viewer/dist/index.js",
  },
  define: {
    __HELIX_VERSION__: JSON.stringify(packageJson.version),
  },
  logLevel: "info",
  sourcemap: false,
});
