#!/usr/bin/env node
// axe-core over the seeded screens — boards/project-backlog/115-accessibility-pass.md
//
// The enforcement half of card 115. The audit half (keyboard walks, focus
// returns, live regions) is human judgement and lives in that card's journal;
// this is the part a machine can keep true, run after run, so the fixes that
// card landed cannot quietly rot.
//
// WHAT IT CHECKS. Four real screens, all against the SAME seed the screenshot
// matrix uses (../lib/seed.mjs — one fixture, so "it looked right in the
// screenshots" and "it audited clean" are statements about the same world):
//
//   sidepanel-chat        the transcript with seeded history, an activity
//                         group, notices, the context strip and the composer
//   sidepanel-inspector   Tools + the tool cards' schema disclosures
//   sidepanel-history     the chat list, its rows and their delete actions
//   options               providers, approval policy, MCP servers, history
//
// LIGHT THEME ONLY, deliberately (the card says light is enough): the only
// rule whose result actually depends on the theme is `color-contrast`, and
// the light palette is the tighter of the two against this repo's Zinc tokens
// — every contrast failure card 115 fixed was a light-mode one, and each was
// already passing in dark.
//
// WHAT FAILS. `serious` and `critical` violations fail loudly, by name, with
// the offending selectors. `moderate`/`minor` are PRINTED but do not fail:
// they are overwhelmingly axe's best-practice advice about document structure
// (see the waiver table below), and a gate that fails on advice is a gate
// people learn to switch off.
//
// BEST EFFORT in verify/run.mjs's sense — a throw here is reported SKIP, not
// FAIL, exactly like the screenshot matrix — but never SILENT: a screen whose
// locator drifted throws with the screen named, rather than auditing three
// screens and reporting a clean pass over the fourth it never reached.
//
// ── HOW AXE GETS ONTO THE PAGE, AND WHY NOT addScriptTag ────────────────────
//
// Both surfaces are extension pages under MV3's `script-src 'self'`. That CSP
// blocks INLINE script outright, and `page.addScriptTag({ content | path })`
// is inline script by construction: Playwright builds a `<script>` element and
// assigns the source as its text. Measured, not assumed — the first version of
// this check did exactly that and Chrome refused it:
//
//   Executing inline script violates the following Content Security Policy
//   directive 'script-src 'self''
//
// `addScriptTag({ url })` is no better: the URL would have to be same-origin
// to satisfy `'self'`, and node_modules is not inside the extension.
//
// `page.addInitScript({ path })` is the CSP-safe route, and is what this file
// uses. It runs through the DevTools protocol before the page's own scripts,
// which is not subject to the document's CSP at all — and, unlike Playwright's
// `bypassCSP: true` context option, it changes NOTHING about the policy the
// page under audit actually runs under. Auditing a page with its security
// headers switched off would be auditing a different page.
//
// It must be installed before the first navigation, which is why `checkAxe`
// creates its own pages rather than accepting one already navigated.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension } from "../lib/build.mjs";
import { launchExtension, optionsUrl, sidepanelUrl } from "../lib/browser.mjs";
import { installPanelFixtureStubs, seedExtensionStorage } from "../lib/seed.mjs";
import { createReport } from "../lib/report.mjs";

const AXE_SCRIPT = fileURLToPath(
  new URL("../../node_modules/axe-core/axe.min.js", import.meta.url),
);

/** Impacts that fail the check. Card 115: "serious/critical fail loudly". */
const FAILING_IMPACTS = new Set(["serious", "critical"]);

/**
 * The rule sets this runs. WCAG 2.0/2.1 A and AA are the bar; `best-practice`
 * is included on purpose even though nothing in it can fail on its own — it is
 * where `region`/`landmark-one-main` live, and card 115 fixed both by giving
 * the side panel a real `<main>`. Running them means a future edit that loses
 * that landmark shows up in this check's output instead of nowhere.
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

/**
 * DELIBERATELY WAIVED RULES, each with the reason it cannot simply be fixed.
 * A waiver suppresses a rule ENTIRELY (it is not run), so the list is meant to
 * stay short and to be re-argued rather than grown — an entry here is a claim
 * that the rule is wrong about this codebase, not that the finding is
 * inconvenient.
 *
 * EMPTY, as card 115 leaves it. Every serious/critical finding the audit
 * turned up was a real defect with a real fix (six unnamed approval-policy
 * radios; two light-mode contrast failures), and the moderate ones were fixed
 * too. The table stays because the next person will need somewhere to put a
 * justified exception — with the justification, not instead of it.
 *
 * @type {Record<string, string>}
 */
export const AXE_WAIVERS = {};

/**
 * The screens audited, in the order one page visits them. `open` leaves the
 * page showing that screen; it must throw (rather than return quietly) if what
 * it is looking for is not there, so a drifted selector is a named failure
 * instead of an audit of whatever happened to be on screen.
 */
const SIDEPANEL_SCREENS = [
  {
    name: "sidepanel-chat",
    async open(page, extensionId) {
      await page.goto(sidepanelUrl(extensionId));
      await page.waitForLoadState("domcontentloaded");
      await requireVisible(
        page.locator(".picker__trigger"),
        "the composer's model chip",
        "sidepanel-chat",
      );
    },
  },
  {
    name: "sidepanel-inspector",
    async open(page) {
      await openMenuItem(page, /Tools & call log/, "sidepanel-inspector");
      await requireVisible(
        page.getByRole("tab", { name: /Tools/ }),
        "the Tools tab",
        "sidepanel-inspector",
      );
    },
  },
  {
    name: "sidepanel-history",
    async open(page) {
      await page.getByRole("button", { name: "Back to chat" }).click();
      await openMenuItem(page, /^More$/, "sidepanel-history");
      await requireVisible(
        page.getByRole("listitem").first(),
        "a seeded chat row",
        "sidepanel-history",
      );
    },
  },
];

/** Waits for a locator, naming the screen and what was expected when it is not there. */
async function requireVisible(locator, what, screen) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw new Error(`axe: could not reach ${screen} — ${what} was not visible (selector drifted?)`);
  }
}

/** Opens the header's overflow menu and picks one row by its accessible name. */
async function openMenuItem(page, name, screen) {
  await requireVisible(
    page.getByRole("button", { name: "More options" }),
    "the header's overflow-menu button",
    screen,
  );
  await page.getByRole("button", { name: "More options" }).click();
  await requireVisible(page.getByRole("menuitem", { name }), `the "${name}" menu row`, screen);
  await page.getByRole("menuitem", { name }).click();
}

/**
 * Runs axe over whatever the page is currently showing and returns its
 * violations, normalised to the small shape this check reports on.
 */
async function auditScreen(page, name) {
  // A short settle: every screen above is reached by a click that swaps the
  // panel's whole main area, and axe reading it mid-transition would audit a
  // DOM neither state ever actually presents.
  await page.waitForTimeout(400);
  const violations = await page.evaluate(
    async ({ tags, waived }) => {
      const result = await window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: tags },
        rules: Object.fromEntries(waived.map((id) => [id, { enabled: false }])),
      });
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      }));
    },
    { tags: AXE_TAGS, waived: Object.keys(AXE_WAIVERS) },
  );
  return violations.map((v) => ({ ...v, screen: name }));
}

/**
 * Audits every screen on both surfaces and throws with the full list if any
 * violation is `serious` or `critical`.
 *
 * Takes a launched `context` and the runtime-resolved `extensionId` so
 * verify/run.mjs can register it without paying for a second browser; `main()`
 * below supplies its own when this file is run on its own.
 */
export async function checkAxe(context, extensionId) {
  const findings = [];

  const panelPage = await context.newPage();
  try {
    await panelPage.addInitScript({ path: AXE_SCRIPT });
    // Before the first navigation — the panel reads `chrome.tabs` at mount.
    await installPanelFixtureStubs(panelPage);
    await panelPage.setViewportSize({ width: 400, height: 900 });
    await panelPage.emulateMedia({ colorScheme: "light" });
    await seedExtensionStorage(panelPage, extensionId);

    for (const screen of SIDEPANEL_SCREENS) {
      await screen.open(panelPage, extensionId);
      findings.push(...(await auditScreen(panelPage, screen.name)));
    }
  } finally {
    await panelPage.close();
  }

  // Its own page, after the panel's is closed — the options page must be
  // audited exactly as a user meets it, with none of the panel's stubs and no
  // still-mounted panel racing its storage reads.
  const optionsPage = await context.newPage();
  try {
    await optionsPage.addInitScript({ path: AXE_SCRIPT });
    await optionsPage.setViewportSize({ width: 1024, height: 900 });
    await optionsPage.emulateMedia({ colorScheme: "light" });
    await optionsPage.goto(optionsUrl(extensionId));
    await optionsPage.waitForLoadState("domcontentloaded");
    await requireVisible(
      optionsPage.getByRole("heading", { name: "Chat providers" }),
      "the providers section heading",
      "options",
    );
    findings.push(...(await auditScreen(optionsPage, "options")));
  } finally {
    await optionsPage.close();
  }

  const blocking = findings.filter((v) => FAILING_IMPACTS.has(v.impact));
  const advisory = findings.filter((v) => !FAILING_IMPACTS.has(v.impact));

  if (blocking.length > 0) {
    throw new Error(
      `axe found ${blocking.length} serious/critical violation(s):\n` +
        blocking
          .map(
            (v) =>
              `  [${v.impact}] ${v.screen} — ${v.id}: ${v.help}\n` +
              v.nodes.map((n) => `      ${n}`).join("\n") +
              `\n      ${v.helpUrl}`,
          )
          .join("\n"),
    );
  }

  return {
    screens: [...SIDEPANEL_SCREENS.map((s) => s.name), "options"],
    blocking: 0,
    // Printed with the first offending node: an advisory nobody can locate is
    // an advisory nobody acts on, and this is the only place these are shown.
    advisory: advisory.map(
      (v) => `${v.screen}/${v.id} (${v.impact}, ${v.nodes.length}) — ${v.nodes[0]}`,
    ),
    waived: Object.keys(AXE_WAIVERS),
  };
}

/**
 * Standalone entry point: `node verify/checks/axe.mjs`. Builds, launches, and
 * runs exactly the audit verify/run.mjs registers, so the check can be
 * iterated on without waiting out the whole suite.
 */
async function main() {
  const report = createReport();
  let ext = null;
  try {
    console.log("Building extension -> dist-verify/ ...");
    await buildExtension();
    console.log("Build OK. Launching Chrome for Testing ...");
    ext = await launchExtension({ enableWebMcp: true });

    await report.runBestEffort(
      "axe-core: no serious/critical accessibility violations on the seeded side panel (chat/inspector/history) or options page, light theme",
      () => checkAxe(ext.context, ext.extensionId),
      "axe",
    );
    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
  }
}

// Only when run directly, never when verify/run.mjs imports `checkAxe`.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("\naxe check crashed before completing:", err);
    process.exitCode = 1;
  });
}
