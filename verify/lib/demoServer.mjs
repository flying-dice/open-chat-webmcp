// Starts (or reuses) the demo fixture server (`npm run demo`, demo/vite.config.ts,
// fixed port 5175) that the harness loads pages from.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const DEMO_ORIGIN = "http://localhost:5175";
export const DEMO_INDEX_URL = `${DEMO_ORIGIN}/index.html`;

async function isUp() {
  try {
    const res = await fetch(DEMO_INDEX_URL, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForUp(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isUp()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Returns { proc, alreadyRunning }. Caller should stopDemoServer(handle) in a finally. */
export async function startDemoServer() {
  if (await isUp()) {
    return { proc: null, alreadyRunning: true };
  }
  const proc = spawn("npx", ["vite", "--config", "demo/vite.config.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", () => {});
  const ok = await waitForUp(15000);
  if (!ok) {
    proc.kill();
    throw new Error("demo server did not come up on http://localhost:5175 within 15s");
  }
  return { proc, alreadyRunning: false };
}

export function stopDemoServer(handle) {
  if (handle?.proc && !handle.alreadyRunning) {
    handle.proc.kill();
  }
}
