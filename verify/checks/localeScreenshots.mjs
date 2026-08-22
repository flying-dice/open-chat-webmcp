// SCRATCH verification script for card 105 (the nine translations) — NOT
// wired into `npm run verify`. Where card 104's rtlScreenshots.mjs FORCED
// `dir`/`lang` onto the document because no `ar` locale existed yet, this one
// drives the real thing: it writes Paraglide's own `PARAGLIDE_LOCALE`
// localStorage key before the page's first script runs, so `getLocale()`
// resolves the locale through the shipped strategy chain and
// `applyDocumentLocale()` sets `<html lang>`/`<html dir>` on its own.
//
// Per locale it:
//   - asserts `<html lang>`/`<html dir>` came out right (ar => rtl),
//   - asserts a KNOWN TRANSLATED STRING is actually on the page — read from
//     messages/<locale>.json, so the probe cannot drift from the file,
//   - screenshots the side panel at BOTH side-panel widths (320 and 400) and
//     the options page, and
//   - reports every element whose content overflows its box horizontally,
//     which is what a long German compound or a CJK label does at 320px.
//
// Run directly:  node verify/checks/localeScreenshots.mjs [locale…]
// Evidence only — PNGs land in verify/output/screenshots/ (gitignored) with a
// `locale-<tag>-` prefix; the findings are journalled on the card.
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildExtension } from "../lib/build.mjs";
import { launchExtension, optionsUrl, sidepanelUrl } from "../lib/browser.mjs";
import {
  buildStorageFixture,
  FIXTURE_LOCAL_KEY_PREFIXES,
  FIXTURE_PAGE_TOOLS,
  FIXTURE_TAB,
} from "../../src/infra/chrome-storage/testing/storage-fixtures.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT_DIR = path.join(ROOT, "verify", "output", "screenshots");
const LOCALES = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["ar", "zh-CN", "de"];
const RTL = new Set(["ar", "he", "fa", "ur"]);

/**
 * The ten endonyms the picker must offer, in any locale — the list is the
 * same in every language by definition, which is the property being checked
 * (a picker that translated its own rows would be useless to the person who
 * cannot read the language they are stuck in).
 */
const EXPECTED_ENDONYMS = [
  "English",
  "简体中文",
  "日本語",
  "Deutsch",
  "Français",
  "Español",
  "Português (Brasil)",
  "한국어",
  "Русский",
  "العربية",
];

/** A message's text for a locale, straight out of the file the build reads. */
function messageOf(locale, key) {
  const file = path.join(ROOT, "messages", `${locale}.json`);
  const value = JSON.parse(readFileSync(file, "utf8"))[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Everything a reader can see, as one string: rendered text plus the
 * attributes that carry copy but never reach `innerText` (placeholders,
 * aria-labels, titles). A probe found here is a probe the user sees.
 */
const VISIBLE_TEXT = () => {
  const parts = [document.body.innerText];
  for (const el of document.querySelectorAll("[placeholder],[aria-label],[title]")) {
    parts.push(
      el.getAttribute("placeholder") ?? "",
      el.getAttribute("aria-label") ?? "",
      el.getAttribute("title") ?? "",
    );
  }
  return parts.join("\n");
};

/**
 * Elements whose content is wider than the box holding it. `scrollWidth`
 * exceeding `clientWidth` by more than a rounding pixel is text that is
 * clipped or forcing a scrollbar — the failure mode long compounds cause.
 * Deliberately skips the elements that are SUPPOSED to scroll horizontally
 * (code blocks, the `overflow-x-auto` wrappers) and anything ellipsised,
 * where clipping is the design.
 */
const OVERFLOWS = () => {
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 1 || el.clientWidth === 0) continue;
    const style = getComputedStyle(el);
    if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
    if (style.textOverflow === "ellipsis") continue;
    if (el.closest("pre, code, [data-slot='scroll-area-viewport']")) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute("class") ?? "").slice(0, 70),
      by: overflow,
      text: (el.textContent ?? "").trim().slice(0, 60),
    });
  }
  return out;
};

/** The document-level facts the locale bootstrap is responsible for. */
const DOC_LOCALE = () => ({
  lang: document.documentElement.lang,
  dir: document.documentElement.dir,
  stored: localStorage.getItem("PARAGLIDE_LOCALE"),
  bodyOverflowsViewport: document.documentElement.scrollWidth > window.innerWidth + 1,
});

async function shoot(page, name, options = {}) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  console.log("  wrote", path.relative(ROOT, file));
}

async function reportOverflow(page, where) {
  const found = await page.evaluate(OVERFLOWS);
  if (found.length === 0) {
    console.log(`  overflow: none (${where})`);
    return;
  }
  console.log(`  overflow: ${found.length} element(s) (${where})`);
  for (const f of found.slice(0, 12)) {
    console.log(`    +${f.by}px  <${f.tag} class="${f.cls}">  "${f.text}"`);
  }
}

async function probe(page, locale, key, where) {
  const expected = messageOf(locale, key);
  if (expected === undefined) {
    console.log(`  probe SKIP  ${key} is not a plain message in ${locale}.json`);
    return;
  }
  const visible = await page.evaluate(VISIBLE_TEXT);
  const ok = visible.includes(expected);
  console.log(`  probe ${ok ? "OK  " : "FAIL"}  ${where} — ${key}: “${expected.slice(0, 60)}”`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("building dist-verify…");
  await buildExtension();

  const { context, extensionId, close } = await launchExtension();
  try {
    // Seed the fixture once, in the base locale, through a throwaway page.
    const seeder = await context.newPage();
    await seeder.goto(sidepanelUrl(extensionId));
    await seeder.evaluate(
      async ({ local, sync, ownedPrefixes }) => {
        const existing = await chrome.storage.local.get(null);
        const stale = Object.keys(existing).filter((k) =>
          ownedPrefixes.some((p) => k.startsWith(p)),
        );
        if (stale.length > 0) await chrome.storage.local.remove(stale);
        await chrome.storage.local.set(local);
        await chrome.storage.sync.set(sync);
      },
      { ...buildStorageFixture(), ownedPrefixes: FIXTURE_LOCAL_KEY_PREFIXES },
    );
    await seeder.close();

    for (const locale of LOCALES) {
      console.log(`\n=== ${locale} ===`);
      const page = await context.newPage();
      // BEFORE the first script of the page: this is the whole point — the
      // app then resolves the locale itself, exactly as it would after the
      // options page's picker wrote the same key and reloaded.
      await page.addInitScript(
        ({ tab, tools, tag }) => {
          localStorage.setItem("PARAGLIDE_LOCALE", tag);
          chrome.tabs.query = async () => [tab];
          chrome.tabs.get = async () => tab;
          const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage = async (msg) => {
            if (msg && msg.type === "runtime:get-tools") return { tools, available: true };
            return realSend(msg);
          };
        },
        { tab: FIXTURE_TAB, tools: FIXTURE_PAGE_TOOLS, tag: locale },
      );
      await page.emulateMedia({ colorScheme: "light" });

      for (const width of [320, 400]) {
        await page.setViewportSize({ width, height: 720 });
        await page.goto(sidepanelUrl(extensionId));
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(900);

        if (width === 400) {
          const doc = await page.evaluate(DOC_LOCALE);
          const wantDir = RTL.has(locale) ? "rtl" : "ltr";
          const ok = doc.lang === locale && doc.dir === wantDir;
          console.log(
            `  document: lang="${doc.lang}" dir="${doc.dir}" stored="${doc.stored}" ${ok ? "OK" : `FAIL (wanted lang=${locale} dir=${wantDir})`}`,
          );
          if (!ok) process.exitCode = 1;
          await probe(page, locale, "composer_placeholder", "side panel");
          await probe(page, locale, "transcript_disclaimer", "side panel");
          // Card 114 (decisions/38): the two shapes whose words are NOT in
          // storage at all. The seeded chat holds a denied tool call and an
          // assistant note as KINDS with empty content, so finding these
          // strings on screen proves the transcript is being localized at
          // render time rather than replaying whatever English it was
          // recorded with.
          await probe(page, locale, "toolOutcome_denied", "side panel (tool outcome)");
          await probe(page, locale, "openOptionsCheckApiKeyAction", "side panel (note action)");
        }
        await shoot(page, `locale-${locale}-sidepanel-${width}`);
        await reportOverflow(page, `side panel @${width}`);

        // The tools/call-log view: the densest labels in the panel, and the
        // one card 104 found a real direction bug in.
        await page
          .getByRole("button", { name: /.*/ })
          .first()
          .waitFor()
          .catch(() => {});
        await page.evaluate(() => {
          const chip = document.querySelector(
            ".context-chip__button, [data-testid='context-chip']",
          );
          if (chip instanceof HTMLElement) chip.click();
        });
        await page.waitForTimeout(400);
        await shoot(page, `locale-${locale}-tools-${width}`);
        await reportOverflow(page, `tools @${width}`);
      }
      await page.close();

      // Options page: the forms, where the long strings live.
      const optionsPage = await context.newPage();
      await optionsPage.addInitScript(
        (tag) => localStorage.setItem("PARAGLIDE_LOCALE", tag),
        locale,
      );
      await optionsPage.emulateMedia({ colorScheme: "light" });
      await optionsPage.setViewportSize({ width: 1024, height: 900 });
      await optionsPage.goto(optionsUrl(extensionId));
      await optionsPage.waitForLoadState("domcontentloaded");
      await optionsPage.waitForTimeout(900);
      await probe(optionsPage, locale, "optionsPageSubtitle", "options page");
      await probe(optionsPage, locale, "settingsLanguageDescription", "options page");
      await shoot(optionsPage, `locale-${locale}-options`, { fullPage: true });
      await reportOverflow(optionsPage, "options page");

      // The language picker itself: open it and read the ten options back, to
      // prove the list is complete AND that each row is its own endonym
      // rather than the tag or the current language's word for it.
      await optionsPage.locator("#interface-locale").click();
      await optionsPage.waitForTimeout(400);
      const options = await optionsPage.evaluate(() =>
        [...document.querySelectorAll("[role='option']")].map((el) =>
          (el.textContent ?? "").trim(),
        ),
      );
      console.log(`  picker (${options.length}): ${options.join(" | ")}`);
      const missing = EXPECTED_ENDONYMS.filter((name) => !options.some((o) => o.includes(name)));
      if (missing.length > 0) {
        console.log(`  picker FAIL — missing ${missing.join(", ")}`);
        process.exitCode = 1;
      }
      await shoot(optionsPage, `locale-${locale}-language-picker`);
      await optionsPage.close();
    }
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
