// Builds the extension into its OWN output directory (never `dist/`) so a
// concurrent `npm run build` by another agent cannot clobber a running
// verification pass, and vice versa. See boards/project-backlog/25.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const VERIFY_OUT_DIR = "dist-verify";
export const VERIFY_OUT_PATH = path.join(ROOT, VERIFY_OUT_DIR);

export function buildExtension() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["vite", "build", "--outDir", VERIFY_OUT_DIR],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("exit", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`vite build --outDir ${VERIFY_OUT_DIR} failed (exit ${code}):\n${out}\n${err}`));
    });
    child.on("error", reject);
  });
}
