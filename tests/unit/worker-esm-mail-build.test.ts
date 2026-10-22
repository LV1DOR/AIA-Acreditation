import { expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/worker/package.json", import.meta.url));
const { build } = require("esbuild");
const { workerRuntimeBanner } = await import(pathToFileURL(require.resolve("./runtime-banner.mjs")).href);
it("fixes CommonJS Node util loading in the actual ESM build format", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aia-worker-esm-"));
  try {
    await writeFile(join(dir, "helper.cjs"), 'module.exports = require("util").format;');
    await writeFile(join(dir, "entry.mjs"), 'import format from "./helper.cjs"; console.log(format("%s", "SYNTHETIC_OK"));');
    for (const fixed of [false, true]) {
      const file = join(dir, fixed ? "fixed.mjs" : "baseline.mjs");
      await build({ entryPoints: [join(dir, "entry.mjs")], outfile: file, bundle: true, platform: "node", format: "esm", banner: fixed ? { js: workerRuntimeBanner } : undefined, logLevel: "silent" });
      const result = spawnSync(process.execPath, [file], { encoding: "utf8", timeout: 10000, env: { NODE_ENV: "production", PATH: process.env.PATH } });
      expect(result.error).toBeUndefined();
      if (fixed) { expect(result.status).toBe(0); expect(result.stdout.trim()).toBe("SYNTHETIC_OK"); }
      else { expect(result.status).not.toBe(0); expect(result.stderr).toContain('Dynamic require of "util" is not supported'); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
