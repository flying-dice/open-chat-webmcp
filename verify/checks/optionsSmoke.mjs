#!/usr/bin/env node
// Options-form smoke: drives the REAL options page (add/edit/delete a
// provider and an MCP server, custom-header rows, the reserved-header-name
// error, Show/Hide for a masked value, and the "permission needed" state a
// "Test connection" click starts from) end to end in Chrome for Testing.
// Card 81 asked for this manual smoke ("Coverage caveat" in its journal —
// verify/ never drove the options page); card 90 automates it.
//
// NOT wired into `npm run verify` / `npm run guard` / CI — it's a slower,
// UI-driven pass over a surface the required checks don't touch. Run
// manually:
//
//   node verify/checks/optionsSmoke.mjs
//
// Needs no model and no network beyond localhost — safe to run any time.
//
// One deliberate omission: this never clicks "Test connection" itself.
// `handleTest` (ProviderForm.svelte/McpServerForm.svelte) calls
// `chrome.permissions.request()` as its first `await`
// (src/options/forms/hostPermission.svelte.ts), which — given a real user
// gesture, which a Playwright `.click()` genuinely is — raises Chrome's own
// native permission bubble, a browser-chrome UI element with no DOM handle
// Playwright can drive or dismiss. Clicking through it would hang the
// script waiting for a human who isn't there. The "Permission needed for
// this host" badge both forms already render from `chrome.permissions.
// contains()` (no prompt) BEFORE any click is the same "permission needed"
// signal `handleTest` would hit as its own first step — that badge is
// captured as the evidence instead, and is asserted explicitly.
//
// No OAuth: the MCP server flow leaves Authentication at its default
// "None" (per the card's "an MCP server minus OAuth" — no real auth server
// available to complete a sign-in against).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { buildExtension } from "../lib/build.mjs";
import { launchExtension, optionsUrl } from "../lib/browser.mjs";
import { createReport } from "../lib/report.mjs";
import { assert } from "../lib/assert.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCREENSHOT_DIR = path.join(ROOT, "verify", "output", "screenshots");

async function shoot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const report = createReport();
  const shots = [];

  async function step(label, fn) {
    console.log(`\n--- ${label}`);
    await report.run(label, fn);
    const last = report.results[report.results.length - 1];
    console.log(`    [${last.status}] ${JSON.stringify(last.detail).slice(0, 300)}`);
  }

  let ext = null;
  try {
    console.log("Building extension -> dist-verify/ ...");
    await buildExtension();
    console.log("Build OK.");

    console.log("Launching Chrome for Testing with the built extension ...");
    ext = await launchExtension({ enableWebMcp: true });
    const { context, extensionId } = ext;
    console.log(`Chrome for Testing ${ext.buildId}; extension id: ${extensionId}`);

    const page = await context.newPage();
    // Both registries' "Remove" confirmations are a native window.confirm()
    // (ProvidersSection.svelte/McpServersSection.svelte's handleRemove) —
    // auto-accept every one for the rest of this run.
    page.on("dialog", (d) => d.accept());

    await page.goto(optionsUrl(extensionId));
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByRole("heading", { name: "Chat providers" })
      .waitFor({ state: "visible", timeout: 5000 });

    // -----------------------------------------------------------------
    // Provider: add via the preset flow
    // -----------------------------------------------------------------
    await step("Add provider: preset picker -> Ollama tile -> pre-filled form", async () => {
      await page.getByRole("button", { name: "Add provider" }).click();
      // PresetPicker.svelte's tile is one <button> wrapping TWO text spans
      // (the label "Ollama" AND the secondary "No API key" line), so its
      // computed accessible name is both concatenated — an exact "Ollama"
      // match would miss it. Filter by contained text instead.
      await page.getByRole("button").filter({ hasText: "Ollama" }).first().click();
      const nameField = page.locator("#pf-name");
      await nameField.waitFor({ state: "visible", timeout: 5000 });
      assert(
        (await nameField.inputValue()) === "Ollama",
        "expected the Ollama preset to pre-fill the display name",
      );
      const urlField = page.locator("#pf-url");
      const prefilledUrl = await urlField.inputValue();
      assert(prefilledUrl.length > 0, "expected the Ollama preset to pre-fill a base URL");
      shots.push(await shoot(page, "options-smoke-provider-add-form"));
      return { prefilledName: "Ollama", prefilledUrl };
    });

    await step(
      'Provider form shows "Permission granted" for the localhost preset (manifest grants http://localhost/* at install — a fresh profile never needs to ask for it)',
      async () => {
        const badge = page.getByText("Permission granted", { exact: true });
        await badge.waitFor({ state: "visible", timeout: 5000 });
        return { permissionGranted: true };
      },
    );

    await step(
      "Provider header row: add, reserved-name (Content-Type) error, then remove",
      async () => {
        await page.getByRole("button", { name: "Add header" }).click();
        const firstKey = page.locator("#pf-header-0-key");
        await firstKey.fill("x-tenant-id");
        // The value input is the sibling text input in the same row.
        const firstRow = firstKey.locator("xpath=ancestor::div[contains(@class,'items-start')]");
        await firstRow.locator('input[placeholder="Value"]').fill("acme-corp");

        await page.getByRole("button", { name: "Add header" }).click();
        const secondKey = page.getByPlaceholder("Header name, e.g. x-api-key").nth(1);
        await secondKey.fill("Content-Type");
        // headerRowError (src/options/forms/headerRows.ts) only reaches the
        // reserved-name check once BOTH halves of a row are non-blank.
        const secondRow = secondKey.locator("xpath=ancestor::div[contains(@class,'items-start')]");
        await secondRow.locator('input[placeholder="Value"]').fill("anything");
        const reservedError = page.getByText("Content-Type is set automatically", { exact: false });
        await reservedError.waitFor({ state: "visible", timeout: 5000 });
        shots.push(await shoot(page, "options-smoke-provider-header-reserved-error"));

        // Remove the offending second row — its own "Remove header …" button.
        await page.getByRole("button", { name: /Remove header Content-Type/i }).click();
        await reservedError.waitFor({ state: "detached", timeout: 5000 });
        return { addedRows: 2, reservedErrorShown: true, removedOffendingRow: true };
      },
    );

    await step('Show/Hide an API key value via "Add one anyway"', async () => {
      // "Add one anyway" only renders for a LOCAL preset of a needs-key TYPE
      // (ProviderForm.svelte's `typeInfo.needsApiKey && activePreset?.local`
      // branch). The Ollama preset's type never needs a key, so this flow
      // lives on the LM Studio preset (openai type, local) instead: cancel
      // back out of the Ollama form, open the LM Studio one for this step,
      // then cancel it — the Ollama add continues in the next step.
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Add provider" }).click();
      await page.getByRole("button").filter({ hasText: "LM Studio" }).first().click();
      await page.locator("#pf-name").waitFor({ state: "visible", timeout: 5000 });
      await page.getByRole("button", { name: "Add one anyway" }).click();
      const keyField = page.locator("#pf-key");
      await keyField.waitFor({ state: "visible", timeout: 5000 });
      await keyField.fill("sk-smoke-test-not-a-real-key");
      assert(
        (await keyField.getAttribute("type")) === "password",
        "expected the key field masked by default",
      );
      await page.getByRole("button", { name: "Show", exact: true }).click();
      assert(
        (await keyField.getAttribute("type")) === "text",
        "expected Show to unmask the key field",
      );
      shots.push(await shoot(page, "options-smoke-provider-key-shown"));
      await page.getByRole("button", { name: "Hide", exact: true }).click();
      assert(
        (await keyField.getAttribute("type")) === "password",
        "expected Hide to re-mask the key field",
      );
      // Done with the LM Studio detour — cancel it and re-open the Ollama
      // preset form so the following save step operates on the provider this
      // run is actually adding. (The header rows exercised two steps ago were
      // validation-only; the save step asserts the row saves, not headers.)
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Add provider" }).click();
      await page.getByRole("button").filter({ hasText: "Ollama" }).first().click();
      await page.locator("#pf-name").waitFor({ state: "visible", timeout: 5000 });
      return { shown: true, hidden: true };
    });

    await step("Save the new provider and see its row", async () => {
      await page.getByRole("button", { name: "Add provider", exact: true }).click();
      // ProviderRow.svelte renders the saved provider's name as plain text
      // next to its Edit/Remove buttons — the reliable "it saved" signal.
      const row = page.getByText("Ollama", { exact: true }).first();
      await row.waitFor({ state: "visible", timeout: 5000 });
      shots.push(await shoot(page, "options-smoke-provider-saved-row"));
      return { saved: true };
    });

    await step("Edit the saved provider and save changes", async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      const nameField = page.locator("#pf-name");
      await nameField.waitFor({ state: "visible", timeout: 5000 });
      await nameField.fill("Ollama (edited by smoke test)");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page
        .getByText("Ollama (edited by smoke test)", { exact: true })
        .waitFor({ state: "visible", timeout: 5000 });
      return { edited: true };
    });

    await step("Delete the provider (native confirm auto-accepted)", async () => {
      await page.getByRole("button", { name: "Remove", exact: true }).first().click();
      await page
        .getByText("Ollama (edited by smoke test)", { exact: true })
        .waitFor({ state: "detached", timeout: 5000 });
      return { deleted: true };
    });

    // -----------------------------------------------------------------
    // MCP server: add, minus OAuth (Authentication stays "None")
    // -----------------------------------------------------------------
    await step("Add MCP server: form fields, no OAuth", async () => {
      await page.getByRole("button", { name: "Add MCP server" }).click();
      await page.locator("#mf-name").waitFor({ state: "visible", timeout: 5000 });
      await page.locator("#mf-name").fill("Smoke Test MCP Server");
      await page.locator("#mf-url").fill("https://mcp.example.com/mcp");
      shots.push(await shoot(page, "options-smoke-mcp-add-form"));
      return { filled: true };
    });

    await step(
      'MCP server form shows "Permission needed for this host" before any Test-connection click',
      async () => {
        const badge = page.getByText("Permission needed for this host");
        await badge.waitFor({ state: "visible", timeout: 5000 });
        return { permissionNeeded: true };
      },
    );

    await step("MCP header row: add, reserved-name (Content-Type) error, then remove", async () => {
      await page.getByRole("button", { name: "Add header" }).click();
      const firstKey = page.locator("#mf-header-0-key");
      await firstKey.fill("Content-Type");
      // validateServerHeaders (src/domain/tools/servers.ts) also only fires
      // once a row has a value — headerRowError checks the blank-value case
      // first, same as the provider form.
      const firstRow = firstKey.locator("xpath=ancestor::div[contains(@class,'items-start')]");
      await firstRow.locator('input[placeholder="Value"]').fill("anything");
      const reservedError = page
        .getByText("is set automatically by the client", { exact: false })
        .first();
      await reservedError.waitFor({ state: "visible", timeout: 5000 });
      shots.push(await shoot(page, "options-smoke-mcp-header-reserved-error"));
      await page.getByRole("button", { name: /Remove header Content-Type/i }).click();
      return { addedRow: 1, reservedErrorShown: true, removedOffendingRow: true };
    });

    await step("Save the new MCP server and see its row", async () => {
      await page.getByRole("button", { name: "Add server", exact: true }).click();
      const row = page.getByText("Smoke Test MCP Server", { exact: true }).first();
      await row.waitFor({ state: "visible", timeout: 5000 });
      shots.push(await shoot(page, "options-smoke-mcp-saved-row"));
      return { saved: true };
    });

    await step("Edit the saved MCP server and save changes", async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      const nameField = page.locator("#mf-name");
      await nameField.waitFor({ state: "visible", timeout: 5000 });
      await nameField.fill("Smoke Test MCP Server (edited)");
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page
        .getByText("Smoke Test MCP Server (edited)", { exact: true })
        .waitFor({ state: "visible", timeout: 5000 });
      return { edited: true };
    });

    await step("Delete the MCP server (native confirm auto-accepted)", async () => {
      await page.getByRole("button", { name: "Remove", exact: true }).first().click();
      await page
        .getByText("Smoke Test MCP Server (edited)", { exact: true })
        .waitFor({ state: "detached", timeout: 5000 });
      return { deleted: true };
    });

    console.log(`\nScreenshots (${shots.length}):`);
    for (const s of shots) console.log(`  ${s}`);

    const ok = report.print();
    process.exitCode = ok ? 0 : 1;
  } finally {
    if (ext) await ext.close();
  }
}

main().catch((err) => {
  console.error("\noptions smoke crashed before completing:", err);
  process.exitCode = 1;
});
