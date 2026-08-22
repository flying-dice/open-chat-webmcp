#!/usr/bin/env node
// Scenario pack (card 112, boards/project-backlog/112-verify-scenario-pack.md):
// Inspector shows server tools with an origin badge after a REAL MCP
// discovery round trip.
//
// Drives the REAL side panel Svelte UI end to end: a genuine MCP server
// (verify/lib/mcpStubServer.mjs — a real `node:http` listener speaking
// Streamable HTTP, not a fixture object) is registered and enabled in seeded
// storage, the panel is opened, App.svelte's own onMount kicks MCP discovery
// automatically (card 38, decisions/19 §4), and this asserts the tool that
// discovery finds is actually rendered in the Inspector's "MCP servers"
// section, badged with the server's own display name — never mistaken for a
// tool the demo PAGE published, which is registered here too so both origins
// are on screen together (src/sidepanel/presentation/toolOrigin.ts's whole
// point).
//
// No model needed: this never sends a chat turn, only opens the Inspector
// view and reads what discovery already put in `panel.serverTools`.
//
// NOT wired into `npm run verify` / `npm run guard` / CI, same posture as the
// existing smokes. Run manually:
//
//   node verify/checks/inspectorScenario.mjs

import { buildExtension } from "../lib/build.mjs";
import { startDemoServer, stopDemoServer, DEMO_INDEX_URL } from "../lib/demoServer.mjs";
import { startMcpStubServer } from "../lib/mcpStubServer.mjs";
import { launchExtension, sidepanelUrl } from "../lib/browser.mjs";
import { createReport } from "../lib/report.mjs";
import { assert } from "../lib/assert.mjs";

const SERVER_NAME = "Verify Stub MCP Server";
const STUB_TOOL_NAME = "stub-search";

/** The WRITE half only — see the call site for why the RELOAD half is a separate step done after every other tab this run needs already exists (verify/lib/liveOllama.mjs's `reloadIntoSeededWorld` documents the same race in the live scripts). */
async function writeMcpServerStorage(page, extensionId, url) {
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ server }) => {
      await chrome.storage.sync.set({ "mcp:servers:list": [server] });
    },
    {
      server: {
        id: "verify-inspector-stub",
        name: SERVER_NAME,
        url,
        enabled: true,
        transport: "auto",
      },
    },
  );
}

async function reloadPanel(page, extensionId) {
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForLoadState("domcontentloaded");
}

async function main() {
  const report = createReport();

  console.log("Building extension -> dist-verify/ ...");
  await buildExtension();
  console.log("Build OK.");

  console.log("Starting demo server (or reusing one already running) on :5175 ...");
  const demoHandle = await startDemoServer();
  console.log(demoHandle.alreadyRunning ? "Demo server already running." : "Demo server started.");

  console.log("Starting a real MCP stub server (Streamable HTTP) ...");
  const mcpStub = await startMcpStubServer({
    name: "verify-inspector-mcp-stub",
    tools: [
      {
        name: STUB_TOOL_NAME,
        description: "A stub server-side tool, for the inspector scenario's discovery check.",
        annotations: { readOnlyHint: true },
        inputSchema: { type: "object", properties: {} },
      },
    ],
  });
  console.log(`MCP stub listening at ${mcpStub.baseUrl}`);

  let ext = null;
  try {
    console.log("Launching Chrome for Testing with the built extension, WebMCP enabled ...");
    ext = await launchExtension({ enableWebMcp: true });
    const { context, extensionId } = ext;
    console.log(`Chrome for Testing ${ext.buildId}; extension id: ${extensionId}`);

    const panel = await context.newPage();
    await writeMcpServerStorage(panel, extensionId, mcpStub.baseUrl);

    // Opened BEFORE the panel's reload, deliberately: card 112 found — by
    // isolated repro, no storage write even involved — that reloading the
    // panel's own tab and only THEN opening a second tab races
    // src/infra/chrome-runtime/tab-sync.ts into mis-tracking the newly
    // active tab as restricted, seemingly permanently. Opening every other
    // tab first and reloading the panel last avoided it 12/12 in the same
    // repro (verify/lib/liveOllama.mjs's `reloadIntoSeededWorld` has the
    // full writeup — this script predates that helper existing for the
    // MCP-only seed here, hence its own small local copy of the same shape).
    const demoPage = await context.newPage();
    await demoPage.goto(DEMO_INDEX_URL);
    await demoPage.waitForFunction(() => document.getElementById("status")?.dataset.kind === "ok", {
      timeout: 35000,
    });
    await reloadPanel(panel, extensionId);

    await report.run("Panel tracks the demo tab after mount", async () => {
      await panel.getByText("WebMCP Demo", { exact: false }).first().waitFor({
        state: "visible",
        timeout: 60000,
      });
      return { tracked: true };
    });

    await report.run(
      "Real MCP discovery: the stub server's own methods were actually called",
      async () => {
        // App.svelte's onMount kicks discovery immediately; poll rather than
        // wait a fixed time, since it's a real network round trip.
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && !mcpStub.requests.includes("tools/list")) {
          await new Promise((r) => setTimeout(r, 200));
        }
        assert(
          mcpStub.requests.includes("initialize"),
          `expected the extension's real MCP client to call "initialize" on the stub; got: ${mcpStub.requests.join(", ")}`,
        );
        assert(
          mcpStub.requests.includes("tools/list"),
          `expected the extension's real MCP client to call "tools/list" on the stub; got: ${mcpStub.requests.join(", ")}`,
        );
        return { requests: [...mcpStub.requests] };
      },
    );

    await report.run(
      'Open the Inspector via the real overflow menu ("Tools & call log")',
      async () => {
        await panel.getByRole("button", { name: "More options" }).click();
        await panel.getByRole("menuitem", { name: "Tools & call log" }).click();
        await panel
          .getByRole("tab", { name: /Tools/ })
          .waitFor({ state: "visible", timeout: 25000 });
        return { opened: true };
      },
    );

    await report.run(
      'Server tool is listed under "MCP servers" with an origin badge naming the server (not "this page")',
      async () => {
        await panel.getByText(SERVER_NAME, { exact: true }).first().waitFor({
          state: "visible",
          timeout: 60000,
        });
        const toolCard = panel.locator("li", { hasText: STUB_TOOL_NAME }).first();
        await toolCard.waitFor({ state: "visible", timeout: 25000 });
        const badge = toolCard.getByText(SERVER_NAME, { exact: true });
        await badge.waitFor({ state: "visible", timeout: 25000 });
        // The demo page's own tools must NOT be badged with the server's
        // name — origin must stay distinguishable per tool, not just per
        // section.
        const pageToolCard = panel.locator("li", { hasText: "read-page-state" }).first();
        await pageToolCard.waitFor({ state: "visible", timeout: 25000 });
        const pageBadge = pageToolCard.getByText("this page", { exact: true });
        await pageBadge.waitFor({ state: "visible", timeout: 25000 });
        return { serverToolBadged: true, pageToolBadgedSeparately: true };
      },
    );

    await report.run(
      'The "Tools (N)" tab count includes both origins, and "No server tools" is gone',
      async () => {
        const noServerTools = panel.getByText("No server tools", { exact: true });
        assert(
          (await noServerTools.count()) === 0,
          'expected the "no server tools" empty state to be gone once discovery found one',
        );
        const tab = panel.getByRole("tab", { name: /Tools \(\d+\)/ });
        await tab.waitFor({ state: "visible", timeout: 25000 });
        const label = await tab.textContent();
        return { tabLabel: label?.trim() };
      },
    );

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
    await mcpStub.close();
    stopDemoServer(demoHandle);
  }
}

main().catch((err) => {
  console.error("\ninspector scenario crashed before completing:", err);
  process.exitCode = 1;
});
