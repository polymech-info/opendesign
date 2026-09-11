import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(bin, args) {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const rspack = path.join(root, "node_modules/@rspack/cli/bin/rspack.js");
const esbuild = path.join(root, "node_modules/esbuild/bin/esbuild");

console.log("[build] client (rspack)");
run(rspack, ["build", "--mode", "production"]);

console.log("[build] cli (esbuild)");
run(esbuild, [
  "src/cli.ts",
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--packages=bundle",
  "--outfile=dist/cli.js",
]);

const cliOut = path.join(root, "dist/cli.js");
let code = fs.readFileSync(cliOut, "utf8");
code = code.replace(/^(?:#!\/usr\/bin\/env node\r?\n)+/, "");
fs.writeFileSync(cliOut, "#!/usr/bin/env node\n" + code);
try {
  fs.chmodSync(cliOut, 0o755);
} catch {
  /* windows */
}

const iconSrc = path.resolve(root, "../../packages/tabler-icons/icons/filled");
const iconDest = path.join(root, "dist/tabler-icons");
if (!fs.existsSync(iconSrc)) {
  console.error("[build] missing Tabler icons at", iconSrc);
  process.exit(1);
}
console.log("[build] icons → dist/tabler-icons");
fs.rmSync(iconDest, { recursive: true, force: true });
fs.cpSync(iconSrc, iconDest, { recursive: true });
const names = fs
  .readdirSync(iconDest)
  .filter((file) => file.endsWith(".svg"))
  .map((file) => file.slice(0, -4));
fs.writeFileSync(path.join(iconDest, "index.json"), JSON.stringify(names));
console.log(`[build] ${names.length} Tabler icons`);
