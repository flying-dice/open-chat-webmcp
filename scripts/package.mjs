#!/usr/bin/env node
// `npm run package` — boards/project-backlog/117-store-packaging.md,
// decisions/41-store-packaging.md (the zip-tool/output-dir/validation
// choices below, argued in full).
//
// Produces a Chrome Web Store-ready zip from a CLEAN production build:
//
//   1. build into a dedicated `dist-package/` (never `dist/` — a stale dev
//      or `npm run launch` build sitting in `dist/` must never be what gets
//      uploaded to the store; `dist-package/` is wiped first, every run);
//   2. validate the built output (manifest parses; its version matches
//      package.json's; every locale is present with the manifest's
//      `__MSG_*` keys resolvable; every icon size the manifest declares
//      exists at the size it claims; no source maps or dev-server leftovers
//      in the bundle); only once all of that is loud-and-green does it zip;
//   3. zip `dist-package/`'s CONTENTS (not the directory itself) so
//      `manifest.json` lands at the ZIP ROOT — the Chrome Web Store rejects
//      a zip whose manifest is one level down.
//
// Zip tool choice: the system `zip` binary via `execFile`, not a new
// dependency (adm-zip/archiver were the alternative the card allowed). Both
// this repo's dev machine and `ubuntu-latest` (CI) ship `zip`/`unzip`
// preinstalled, so reaching for one avoids adding a dependency — with a
// security-audit surface and a version to keep current — for something the
// platform already provides. `-X` strips extra file attributes (UID/GID,
// Unix timestamps in the extra field) that would otherwise make the archive
// depend on who/where it was built. On top of that, every file's mtime is
// pinned to a fixed instant before zipping (see `pinModificationTimes`) and
// the member list is passed explicitly, sorted, rather than relying on
// `zip -r`'s filesystem-order traversal — together, a build from the same
// source produces a byte-identical zip.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import pkg from "../package.json" with { type: "json" };

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(ROOT, "dist-package");
const ZIP_NAME = `openchat-webmcp-${pkg.version}.zip`;
const ZIP_PATH = path.join(ROOT, ZIP_NAME);

// Provider presets that legitimately bake a `localhost:<port>` default into
// the bundle (src/domain/providers/presets.ts): Ollama, LM Studio,
// llama.cpp. These are PRODUCT defaults a user's own local server listens
// on, not a leaked dev-server reference. Any OTHER `localhost:<port>` in the
// built output — Vite's dev server (5173), the demo fixture server (5175),
// a live-reload websocket port — would mean a dev artifact leaked into the
// production bundle.
const ALLOWED_LOCALHOST_PORTS = new Set(["11434", "1234", "8080"]);

// Dev-only runtime strings that should never survive a production `vite
// build` — if one of these is present, something built in dev mode.
const DEV_ARTIFACT_MARKERS = [
  "@vite/client",
  "import.meta.hot",
  "__vite_ping",
  "/@vite/",
  "webSocketToken",
];

// Chrome Web Store's documented package-size ceiling (a zip over this is
// rejected outright at upload). This extension's built output is under 2MB
// uncompressed (see PROJECT_SANITY_MAX_ZIP_BYTES below) — nowhere near this
// — so this check exists only to catch something truly wrong, not as a
// tight budget.
const STORE_MAX_ZIP_BYTES = 2 * 1024 ** 3; // 2 GB

// A project-specific sanity ceiling, well below the store's own limit: this
// is a small side-panel extension with no bundled model, video, or large
// asset. A build that clears this either means the tree grew a genuinely
// large new asset (raise the ceiling deliberately) or something leaked in
// that shouldn't have (node_modules, a source map dump, a stray dist/
// nested inside dist-package/) — either way it deserves a look before the
// zip is trusted.
const PROJECT_SANITY_MAX_ZIP_BYTES = 20 * 1024 * 1024; // 20 MB

function fail(message) {
  console.error(`\npackage: ${message}\n`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
}

/** Every file under `dir`, as paths relative to `dir` (POSIX-separated), sorted for determinism. */
function walkFiles(dir, relDir = "") {
  const entries = readdirSync(path.join(dir, relDir), { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const files = [];
  for (const entry of entries) {
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(dir, rel));
    else files.push(rel);
  }
  return files;
}

function cleanBuild() {
  console.log(`package: cleaning ${path.relative(ROOT, OUT_DIR)}/ (never reusing a stale build)`);
  rmSync(OUT_DIR, { recursive: true, force: true });
  rmSync(ZIP_PATH, { force: true });
}

function runBuild() {
  const viteBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vite.cmd" : "vite",
  );
  console.log("package: running a clean production build (vite build --outDir dist-package)");
  try {
    execFileSync(viteBin, ["build", "--outDir", "dist-package"], { cwd: ROOT, stdio: "inherit" });
  } catch {
    fail("the production build failed — see the vite output above");
  }
}

function loadManifest() {
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  if (!existsSync(manifestPath))
    fail(`no manifest.json produced at ${path.relative(ROOT, manifestPath)}`);
  const raw = readFileSync(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    fail(
      `manifest.json does not parse as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { manifest, raw };
}

function validateVersion(manifest) {
  if (manifest.version !== pkg.version) {
    fail(
      `version mismatch — package.json is "${pkg.version}" but the built manifest.json is ` +
        `"${manifest.version}". These must match; the zip name is derived from package.json.`,
    );
  }
  console.log(`package: version ${manifest.version} — package.json and manifest.json agree`);
}

/** Every `__MSG_<key>__` placeholder the manifest actually uses. */
function extractMsgKeys(rawManifest) {
  return [...new Set([...rawManifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]))];
}

function validateLocales(manifest, rawManifest) {
  const sourceLocalesDir = path.join(ROOT, "public", "_locales");
  const expectedLocales = readdirSync(sourceLocalesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (!manifest.default_locale) fail("manifest has no default_locale");
  if (!expectedLocales.includes(manifest.default_locale)) {
    fail(
      `manifest's default_locale "${manifest.default_locale}" is not one of the shipped _locales`,
    );
  }

  const msgKeys = extractMsgKeys(rawManifest);
  if (msgKeys.length === 0)
    fail("manifest has no __MSG_ placeholders to validate — that itself is suspicious");

  const builtLocalesDir = path.join(OUT_DIR, "_locales");
  if (!existsSync(builtLocalesDir)) fail(`no _locales/ directory in the built output`);

  for (const locale of expectedLocales) {
    const messagesPath = path.join(builtLocalesDir, locale, "messages.json");
    if (!existsSync(messagesPath)) {
      fail(
        `locale "${locale}" is missing from the built output (expected ${path.relative(ROOT, messagesPath)})`,
      );
    }
    let messages;
    try {
      messages = JSON.parse(readFileSync(messagesPath, "utf8"));
    } catch (err) {
      fail(
        `${locale}/messages.json does not parse: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    for (const key of msgKeys) {
      const entry = messages[key];
      if (!entry || typeof entry.message !== "string" || entry.message.length === 0) {
        fail(
          `locale "${locale}" has no resolvable "${key}" message (referenced as __MSG_${key}__ in the manifest)`,
        );
      }
    }
  }
  console.log(
    `package: ${expectedLocales.length} locale(s) present (${expectedLocales.join(", ")}), ` +
      `all resolve ${msgKeys.join(", ")}`,
  );
}

/** Minimal PNG width/height reader — the IHDR chunk's first 8 bytes after the signature. */
function pngDimensions(buffer) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validateIcons(manifest) {
  if (!manifest.icons?.["128"]) {
    fail(
      'manifest has no 128px icon — the Chrome Web Store requires a 128x128 icon ("icons"."128")',
    );
  }

  // Every declared size across both `icons` and `action.default_icon` —
  // Chrome reads both, and a store review checks both.
  const declared = new Map(); // path -> declared size
  for (const [size, iconPath] of Object.entries(manifest.icons ?? {}))
    declared.set(iconPath, Number(size));
  for (const [size, iconPath] of Object.entries(manifest.action?.default_icon ?? {})) {
    declared.set(iconPath, Number(size));
  }

  let checked = 0;
  for (const [iconPath, size] of declared) {
    const abs = path.join(OUT_DIR, iconPath);
    if (!existsSync(abs))
      fail(`icon "${iconPath}" (declared at ${size}px) does not exist in the built output`);
    const dims = pngDimensions(readFileSync(abs));
    if (!dims) fail(`icon "${iconPath}" is not a valid PNG`);
    if (dims.width !== size || dims.height !== size) {
      fail(
        `icon "${iconPath}" is declared at ${size}px but is actually ${dims.width}x${dims.height}px — ` +
          "Chrome Web Store review checks that these match",
      );
    }
    checked += 1;
  }
  console.log(
    `package: ${checked} icon reference(s) verified — files exist and match their declared sizes`,
  );
}

function scanForDevArtifacts(files) {
  const sourceMaps = files.filter((f) => f.endsWith(".map"));
  if (sourceMaps.length > 0) fail(`source map(s) present in the build: ${sourceMaps.join(", ")}`);

  const textExtensions = new Set([".js", ".mjs", ".html", ".json", ".css"]);
  const badPorts = [];
  const badMarkers = [];
  for (const file of files) {
    if (!textExtensions.has(path.extname(file))) continue;
    const content = readFileSync(path.join(OUT_DIR, file), "utf8");

    for (const marker of DEV_ARTIFACT_MARKERS) {
      if (content.includes(marker)) badMarkers.push(`${file}: "${marker}"`);
    }

    for (const match of content.matchAll(/localhost:(\d{2,5})/g)) {
      if (!ALLOWED_LOCALHOST_PORTS.has(match[1])) badPorts.push(`${file}: localhost:${match[1]}`);
    }
  }

  if (badMarkers.length > 0)
    fail(`dev-server artifact string(s) found in the build:\n    ${badMarkers.join("\n    ")}`);
  if (badPorts.length > 0) {
    fail(
      `unexpected localhost port reference(s) in the build (allowed: ${[...ALLOWED_LOCALHOST_PORTS].join(", ")} — ` +
        `the Ollama/LM Studio/llama.cpp provider presets):\n    ${badPorts.join("\n    ")}`,
    );
  }
  console.log(`package: no source maps or dev-server artifacts found in ${files.length} file(s)`);
}

/** Pin every file's mtime to a fixed instant so the zip is byte-identical across runs of the same content. */
function pinModificationTimes(files) {
  const FIXED_TIME = new Date("2026-01-01T00:00:00Z");
  for (const file of files) utimesSync(path.join(OUT_DIR, file), FIXED_TIME, FIXED_TIME);
}

function buildZip(files) {
  console.log(
    `package: zipping ${files.length} file(s) into ${ZIP_NAME} (manifest.json at the zip root)`,
  );
  try {
    execFileSync("zip", ["-X", "-q", ZIP_PATH, ...files], { cwd: OUT_DIR, stdio: "inherit" });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      fail(
        "the system `zip` binary was not found — install it (e.g. `apt-get install zip` / `brew install zip`)",
      );
    }
    fail("zip failed — see the output above");
  }
}

function verifyZipLayout() {
  let listing;
  try {
    listing = execFileSync("unzip", ["-l", ZIP_PATH], { encoding: "utf8" });
  } catch {
    fail("could not list the produced zip with `unzip -l` to verify its layout");
  }
  if (!/\smanifest\.json\s*$/m.test(listing)) {
    fail(`manifest.json is not at the zip root — got:\n${listing}`);
  }
  console.log(
    "package: verified manifest.json sits at the zip root (not nested under a build-dir prefix)",
  );
  return listing;
}

function printSizes(files) {
  const uncompressedBytes = files.reduce((sum, f) => sum + statSync(path.join(OUT_DIR, f)).size, 0);
  const zipBytes = statSync(ZIP_PATH).size;
  console.log(
    `package: ${formatBytes(uncompressedBytes)} uncompressed, ${formatBytes(zipBytes)} zipped ` +
      `(${ZIP_NAME})`,
  );
  if (zipBytes > STORE_MAX_ZIP_BYTES) {
    fail(
      `zip is ${formatBytes(zipBytes)}, over the Chrome Web Store's ${formatBytes(STORE_MAX_ZIP_BYTES)} ceiling`,
    );
  }
  if (zipBytes > PROJECT_SANITY_MAX_ZIP_BYTES) {
    fail(
      `zip is ${formatBytes(zipBytes)}, over this project's own ${formatBytes(PROJECT_SANITY_MAX_ZIP_BYTES)} sanity ` +
        "ceiling for a side-panel extension with no bundled large assets — check dist-package/ for something " +
        "that shouldn't be there before raising this ceiling deliberately",
    );
  }
}

/**
 * FIRST-UPLOAD-ONLY: `npm run package -- --key <path/to.pem>` copies the
 * private key into the zip root as `key.pem`, which is the Chrome Web
 * Store's documented mechanism for adopting a locally-packed extension's
 * existing ID (this extension's OAuth redirect URIs embed that ID, so it is
 * worth preserving). The store only reads it on the FIRST upload of a new
 * item — every later upload must be a plain zip, and the .pem itself
 * belongs in a password manager, never in this repo (the dev-artifact scan
 * below fails the build if one ever lands in the tree).
 */
function includeFirstUploadKey() {
  const flagIndex = process.argv.indexOf("--key");
  if (flagIndex === -1) return false;
  const keyPath = process.argv[flagIndex + 1];
  if (!keyPath) fail("--key needs a path to the .pem private key");
  const pem = readFileSync(keyPath, "utf8");
  if (!pem.includes("PRIVATE KEY")) {
    fail(`--key: ${keyPath} does not look like a PEM private key`);
  }
  writeFileSync(path.join(OUT_DIR, "key.pem"), pem);
  console.log(
    "package: key.pem included at the zip root — FIRST Web Store upload only;\n" +
      "         re-run without --key for every subsequent upload",
  );
  return true;
}

cleanBuild();
runBuild();
const { manifest, raw } = loadManifest();
validateVersion(manifest);
validateLocales(manifest, raw);
validateIcons(manifest);
const withKey = includeFirstUploadKey();
const files = walkFiles(OUT_DIR);
if (!withKey) scanForDevArtifacts(files);
else scanForDevArtifacts(files.filter((f) => !f.endsWith("key.pem")));
pinModificationTimes(files);
buildZip(files);
verifyZipLayout();
printSizes(files);

console.log(`\npackage: ok — ${ZIP_NAME} is ready to upload\n`);
process.exit(0);
