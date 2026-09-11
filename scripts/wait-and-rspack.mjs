import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (!process.env.OPEND_DEBUG) {
  delete process.env.NODE_DEBUG;
  delete process.env.NODE_DEBUG_NATIVE;
}

const host = "127.0.0.1";
const timeoutMs = 30_000;
const started = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portFile = path.join(
  os.tmpdir(),
  `opend-dev-${createHash("sha1").update(root).digest("hex").slice(0, 8)}.json`
);
const defaultUiPort = Number(process.env.OPEND_UI_PORT || 5174);

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function isOpend(port) {
  try {
    const res = await fetch(`http://${host}:${port}/api/meta`);
    if (!res.ok) return false;
    const data = await res.json();
    return typeof data?.project === "string";
  } catch {
    return false;
  }
}

async function firstFree(start, count) {
  for (let i = 0; i < count; i++) {
    const port = start + i;
    if (!(await canConnect(port))) return port;
  }
  return start;
}

function readApiPort() {
  try {
    const data = JSON.parse(fs.readFileSync(portFile, "utf8"));
    const port = Number(data.api);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

let apiPort = null;
while (apiPort == null) {
  if (Date.now() - started > timeoutMs) {
    console.error(`[ui] timed out waiting for API (see ${portFile})`);
    process.exit(1);
  }
  const written = readApiPort();
  if (written && (await canConnect(written)) && (await isOpend(written))) {
    apiPort = written;
    break;
  }
  await new Promise((r) => setTimeout(r, 150));
}

const uiPort = await firstFree(defaultUiPort, 20);
console.log(`[ui] API ready on ${host}:${apiPort}, Rspack on ${uiPort}`);

const rspackBin = path.join(root, "node_modules", "@rspack", "cli", "bin", "rspack.js");
const child = spawn(process.execPath, [rspackBin, "dev", "--mode", "development"], {
  stdio: "inherit",
  cwd: root,
  env: {
    ...process.env,
    OPEND_PORT: String(apiPort),
    OPEND_UI_PORT: String(uiPort),
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch {
      /* ignore */
    }
  }
  process.exit(code ?? 1);
});
