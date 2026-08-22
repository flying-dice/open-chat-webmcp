// SCRATCH verification script for card 104 (RTL readiness) — NOT wired into
// `npm run verify`. Forces `dir="rtl"`/`lang="ar"` on both surfaces after
// mount (there is no `ar` locale yet — decisions/37 — so this is the only
// way to eyeball the physical->logical Tailwind sweep, the directional-icon
// flips and the bidi isolation before translations land) and screenshots the
// same seeded-fixture states verify/checks/screenshots.mjs already covers
// for LTR, at 400px. Run directly: `node verify/checks/rtlScreenshots.mjs`.
//
// Evidence only — filenames land in verify/output/screenshots/ (gitignored)
// with an `rtl-` prefix, and the findings from reading them are journalled
// on the card, not committed as assets.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { buildExtension } from "../lib/build.mjs";
import { launchExtension, sidepanelUrl, optionsUrl } from "../lib/browser.mjs";
import {
  buildStorageFixture,
  FIXTURE_CHAT_PROMPTS,
  FIXTURE_LOCAL_KEY_PREFIXES,
  FIXTURE_PAGE_TOOLS,
  FIXTURE_PROVIDER,
  FIXTURE_MCP_SERVER,
  FIXTURE_TAB,
} from "../../src/infra/chrome-storage/testing/storage-fixtures.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const OUT_DIR = path.join(ROOT, "verify", "output", "screenshots");

async function forceRtl(page) {
  await page.evaluate(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
    // bits-ui's ScrollArea (Inspector.svelte/HistoryPanel.svelte) reads its
    // own `dir` from `getTextDirection(getLocale())` — Paraglide's
    // `getLocale()` always resolves "en" until an `ar` locale is actually
    // registered (decisions/37, not yet landed), so it cannot be exercised
    // through the app's real locale plumbing yet. This DOM patch stands in
    // for that, proving the fix independent of Paraglide's locale list: once
    // `ar` ships, the component prop takes over for real.
    for (const el of document.querySelectorAll('[data-slot="scroll-area"]')) {
      el.setAttribute("dir", "rtl");
    }
  });
}

async function shoot(page, name, options = {}) {
  const file = path.join(OUT_DIR, `rtl-${name}.png`);
  await page.screenshot({ path: file, ...options });
  console.log("wrote", file);
  return file;
}

async function seedStorage(page, extensionId) {
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ local, sync, ownedPrefixes }) => {
      const existing = await chrome.storage.local.get(null);
      const stale = Object.keys(existing).filter((k) => ownedPrefixes.some((p) => k.startsWith(p)));
      if (stale.length > 0) await chrome.storage.local.remove(stale);
      await chrome.storage.local.set(local);
      await chrome.storage.sync.set(sync);
    },
    { ...buildStorageFixture(), ownedPrefixes: FIXTURE_LOCAL_KEY_PREFIXES },
  );
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log("building dist-verify…");
  await buildExtension();

  const { context, extensionId, close } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.addInitScript(
      ({ tab, tools }) => {
        chrome.tabs.query = async () => [tab];
        chrome.tabs.get = async () => tab;
        const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = async (msg) => {
          if (msg && msg.type === "runtime:get-tools") return { tools, available: true };
          return realSend(msg);
        };
      },
      { tab: FIXTURE_TAB, tools: FIXTURE_PAGE_TOOLS },
    );

    await seedStorage(page, extensionId);

    await page.setViewportSize({ width: 400, height: 720 });
    await page.emulateMedia({ colorScheme: "light" });

    // 1. Chat view: transcript + expanded activity group (fixture chat 0
    //    has an error + a denied call, so decisions/26 keeps it expanded by
    //    default — no click needed).
    await page.goto(sidepanelUrl(extensionId));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(900);
    await forceRtl(page);
    await page.waitForTimeout(200);
    await shoot(page, "sidepanel-chat");

    // 2. Overflow menu (recent chats + "Tools & call log" + settings).
    // No `ar` locale exists yet (decisions/37) — only `dir`/`lang` are
    // forced above, so Paraglide still serves English copy and the plain
    // English accessible name below still resolves.
    const overflowMenuButton = page.getByRole("button", { name: "More options" });
    await overflowMenuButton.click();
    await page.waitForTimeout(250);
    await shoot(page, "sidepanel-menu");

    // 3. Tools panel (inspector view) via the menu's "Tools & call log" item.
    // Its ScrollArea mounts fresh here (SPA view switch, no navigation), so
    // the dir-patch has to run again — see forceRtl's own comment.
    await page.getByRole("menuitem", { name: "Tools & call log" }).click();
    await page.waitForTimeout(300);
    await forceRtl(page);
    await shoot(page, "sidepanel-tools");

    // 4. Model picker sheet.
    await page.goto(sidepanelUrl(extensionId));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(900);
    await forceRtl(page);
    await page.waitForTimeout(200);
    const modelChip = page.locator(".picker__trigger");
    await modelChip.click();
    await page.waitForTimeout(250);
    await shoot(page, "sidepanel-model-sheet");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    // 5. History panel, via the overflow menu's "More" row.
    const overflowMenuButton2 = page.getByRole("button", { name: "More options" });
    await overflowMenuButton2.click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: "More" }).click();
    await page.waitForTimeout(300);
    await forceRtl(page);
    await shoot(page, "sidepanel-history");

    await page.close();

    // 6. Options page, all sections, full page.
    const optionsPage = await context.newPage();
    await optionsPage.setViewportSize({ width: 1024, height: 900 });
    await optionsPage.goto(optionsUrl(extensionId));
    await optionsPage.waitForLoadState("domcontentloaded");
    await optionsPage.waitForTimeout(900);
    await forceRtl(optionsPage);
    await optionsPage.waitForTimeout(200);
    await optionsPage.waitForSelector(`text=${FIXTURE_PROVIDER.name}`);
    await optionsPage.waitForSelector(`text=${FIXTURE_MCP_SERVER.name}`);
    await shoot(optionsPage, "options", { fullPage: true });

    // 7. Options: MCP server add form open (headers editor visible).
    await optionsPage
      .getByRole("button", { name: /Add server|Add MCP server/i })
      .click()
      .catch(() => {});
    await optionsPage.waitForTimeout(300);
    await shoot(optionsPage, "options-mcp-add-form", { fullPage: true });

    console.log("chat prompts used:", FIXTURE_CHAT_PROMPTS.length);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
