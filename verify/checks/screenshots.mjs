// Screenshots both UI surfaces for a human to eyeball: the side panel
// (opened as a plain tab, since MV3 side-panel UI cannot be opened
// programmatically) across the light/dark x 320/400px matrix plus its two
// anchored surfaces and its activity timeline, and the options page in light
// and dark.
//
// BEST EFFORT: a broken render here is an expected possibility, not a
// harness bug — verify/run.mjs treats a throw from this file as
// non-fatal (reported SKIP, not FAIL).
//
// "Non-fatal" is not the same as "silent". Card 72 made every locator this
// file depends on a hard requirement (`requireLocator`) and asserts the full
// `EXPECTED_SHOTS` matrix before returning, so a drifted accessible name or
// hook class downgrades the check to SKIP *with the missing shot named*
// instead of quietly writing eight files and reporting PASS.
//
// CARD 86 — WHERE THE SEED DATA COMES FROM. It used to be ~250 lines of
// hand-written `ChatSession` / `chat:index` / provider literals right here: a
// second copy of the storage schema, outside src/, typechecked by nothing,
// and already drifted (no `createdAt` on transcript entries; a `defaultModel`
// field no provider type has). That copy is gone. The records now come from
// src/infra/chrome-storage/testing/storage-fixtures.mjs — plain `.mjs` so
// this no-build Node script can import it, JSDoc-typed against the real
// domain types so `npm run check` typechecks it, and round-tripped through
// the real adapters by a Vitest test so drift breaks `npm test` instead of
// quietly emptying a screenshot.
//
// The write itself, and the two pieces of stubbing that make the shots worth
// looking at at all (`chrome.tabs` and `runtime:get-tools`), moved to
// ../lib/seed.mjs in card 110 — `npm run dev:chrome -- --seed` opens onto the
// same seeded world these shots capture, and one mechanism is the only way
// that stays true. Read that file for why each step is what it is.
//
// The fixture's provider is deliberately unreachable, so the model sheet
// captures the picker's unreachable-provider path — the state most worth
// eyeballing anyway.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { optionsUrl, sidepanelUrl } from "../lib/browser.mjs";
import { installPanelFixtureStubs, seedExtensionStorage } from "../lib/seed.mjs";
import {
  FIXTURE_CHAT_PROMPTS,
  FIXTURE_MCP_SERVER,
  FIXTURE_PROVIDER,
} from "../../src/infra/chrome-storage/testing/storage-fixtures.mjs";

async function shoot(page, outDir, name, options = {}) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, ...options });
  return file;
}

/**
 * Every capture this check is supposed to produce. Card 72: the anchored and
 * activity shots used to hang off `if (await locator.count())` guards, so a
 * drifted accessible name or hook class silently produced a SHORTER file list
 * and the check still reported PASS — exactly the silent degradation
 * decisions/28 warns migration cards about. The matrix below is asserted
 * after the run instead, so a missing capture is a loud SKIP naming the shot
 * that vanished. Card 86 added the last two: the options page had no
 * screenshot coverage at all, which card 72's journal flagged and left open.
 */
const EXPECTED_SHOTS = [
  "sidepanel-light-320w",
  "sidepanel-dark-320w",
  "sidepanel-light-400w",
  "sidepanel-dark-400w",
  "sidepanel-dark-menu",
  "sidepanel-dark-model-sheet",
  "sidepanel-dark-activity-expanded",
  "sidepanel-dark-activity-payload",
  "sidepanel-dark-activity-collapsed",
  "options-light",
  "options-dark",
];

/**
 * Waits for a locator the matrix depends on, turning "it isn't there" into a
 * message that names the selector and what it was for — a drifted hook class
 * or accessible name is then one line of report output, not a mystery.
 */
async function requireLocator(locator, what) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(
      `Screenshot matrix incomplete: could not find ${what} (${locator}) — selector drifted?`,
    );
  }
  return locator.first();
}

async function captureSidepanel(page, extensionId, outDir) {
  const files = [];

  for (const width of [320, 400]) {
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 720 });
      await page.emulateMedia({ colorScheme });
      await page.goto(sidepanelUrl(extensionId));
      await page.waitForLoadState("domcontentloaded");
      // Give the Svelte app a moment to mount (or fail trying to) and the
      // seeded session a moment to load before capturing.
      await page.waitForTimeout(900);
      files.push(await shoot(page, outDir, `sidepanel-${colorScheme}-${width}w`));
    }
  }

  // The two anchored surfaces, which are the hardest things to eyeball
  // any other way: both are dismissed by a click anywhere outside them, so
  // they never appear in an ordinary screenshot.
  await page.setViewportSize({ width: 400, height: 720 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForTimeout(900);

  const menuButton = await requireLocator(
    page.getByRole("button", { name: "More options" }),
    "the header's overflow-menu button",
  );
  await menuButton.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-menu"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // `.picker__trigger` is a styling-free hook class kept on the composer's
  // model chip purely for this locator (ProviderPicker.svelte) — the chip's
  // own accessible name is the model id, which moves with seed data.
  const modelChip = await requireLocator(
    page.locator(".picker__trigger"),
    "the composer's model-picker trigger",
  );
  await modelChip.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-model-sheet"));
  // Dismiss before the activity shots below — left open, the sheet would
  // sit on top of every one of them.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);

  // Card 61: the activity timeline. The fixture's chat 0 (still the current
  // tab's chat at this point — its `tabchat:` pointer targets it, and
  // nothing above has navigated away) has an error AND a denied call, so its
  // group is expanded by default (decisions/26: a group that needs attention
  // never auto-collapses) — no click needed for the "expanded" shot.
  //
  // `.activity-group .summary` and `.step .row-head` are, like
  // `.picker__trigger`, styling-free hook classes kept on
  // ActivityGroup.svelte / ToolCallRow.svelte for these two locators.
  await requireLocator(page.locator(".activity-group .summary"), "an activity group's summary row");
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-expanded"));

  const firstRow = await requireLocator(
    page.locator(".step .row-head"),
    "a tool-call step's header row",
  );
  await firstRow.click();
  await page.waitForTimeout(250);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-payload"));

  // The fixture's chat 1 is a clean all-success run, so its group is
  // COLLAPSED by default — the contrast decisions/26 is built around, and
  // otherwise never captured by any shot above. Reached via the overflow
  // menu's recent-chats list rather than a direct storage-pointer rewrite, so
  // this exercises the same navigation path a user actually takes. A fresh
  // reload first (rather than continuing on the page left mid-interaction by
  // the payload-expand click above) resets scroll/expansion state so the
  // menu's "More options" button is exactly where every other shot in this
  // file finds it.
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);
  const menuButtonAgain = await requireLocator(
    page.getByRole("button", { name: "More options" }),
    "the header's overflow-menu button (second open)",
  );
  await menuButtonAgain.click();
  await page.waitForTimeout(250);
  // Matched by the chat's own title — which `titleFromSummary` derives from
  // its first user message, i.e. the fixture's own prompt text — rather than
  // by an index into the menu. An index would be a silent hostage to whatever
  // else the menu happens to list above the recent chats; the title is what
  // it actually says on screen.
  const chatOneRow = await requireLocator(
    page.getByRole("menuitem", { name: FIXTURE_CHAT_PROMPTS[1] }),
    "the second seeded chat's row in the menu's recent-chats list",
  );
  await chatOneRow.click();
  await page.waitForTimeout(400);
  files.push(await shoot(page, outDir, "sidepanel-dark-activity-collapsed"));

  return files;
}

/**
 * The options page, light and dark (card 86 — card 72 flagged it as the one
 * surface with no screenshot coverage at all).
 *
 * Full-page rather than viewport-clipped: unlike the panel this page has no
 * fixed height to design against, and the sections worth reviewing (MCP
 * servers, chat history, attribution) all sit below a 900px fold. It reads
 * the SAME fixture the panel shots do — the seeded provider fills the
 * providers section, the seeded MCP server fills the servers section, and
 * the six seeded chats fill the history section, so none of the three is
 * captured in its empty state.
 *
 * Its own page rather than the panel's: the `chrome.tabs`/`runtime:get-tools`
 * init script above is the side panel's business and the options page must be
 * shot exactly as a user sees it.
 */
async function captureOptions(context, extensionId, outDir) {
  const page = await context.newPage();
  const files = [];
  try {
    await page.setViewportSize({ width: 1024, height: 900 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.goto(optionsUrl(extensionId));
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(900);

      // Every section heading is required, not probed: the options page is
      // one page with four independently-mounted sections, and a section
      // that failed to mount would otherwise just be missing from a picture.
      for (const heading of ["Chat providers", "Tool approval", "MCP servers", "Chat history"]) {
        await requireLocator(
          page.getByRole("heading", { name: heading }),
          `the options page's "${heading}" section heading (${colorScheme})`,
        );
      }
      // ...and the seed itself is required, so a page that mounted but read
      // no storage is a loud SKIP rather than four empty-state cards.
      await requireLocator(
        page.getByText(FIXTURE_PROVIDER.name, { exact: true }),
        `the seeded provider's row (${colorScheme})`,
      );
      await requireLocator(
        page.getByText(FIXTURE_MCP_SERVER.name, { exact: true }),
        `the seeded MCP server's row (${colorScheme})`,
      );

      files.push(await shoot(page, outDir, `options-${colorScheme}`, { fullPage: true }));
    }
  } finally {
    await page.close();
  }
  return files;
}

export async function screenshotSurfaces(context, extensionId, outDir) {
  mkdirSync(outDir, { recursive: true });
  const page = await context.newPage();

  // Must be installed BEFORE the first navigation: the panel queries
  // chrome.tabs during mount.
  await installPanelFixtureStubs(page);

  const files = [];
  try {
    await seedExtensionStorage(page, extensionId);
    files.push(...(await captureSidepanel(page, extensionId, outDir)));
  } finally {
    await page.close();
  }

  // After the panel page is closed, so the options page's own
  // `chrome.storage` reads are not racing a still-mounted panel's writes.
  files.push(...(await captureOptions(context, extensionId, outDir)));

  const captured = new Set(files.map((f) => path.basename(f, ".png")));
  const missing = EXPECTED_SHOTS.filter((name) => !captured.has(name));
  if (missing.length > 0) {
    throw new Error(`Screenshot matrix incomplete: missing ${missing.join(", ")}`);
  }
  return { count: files.length, files };
}
