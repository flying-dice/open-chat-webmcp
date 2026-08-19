// Screenshots the side panel page (opened as a plain tab, since MV3 side
// panel UI cannot be opened programmatically) across the light/dark x
// 320/400px matrix, plus its two anchored surfaces (the overflow menu and
// the model sheet), for a human to eyeball.
//
// BEST EFFORT: a broken render here is an expected possibility, not a
// harness bug — verify/run.mjs treats a throw from this file as
// non-fatal.
//
// Two pieces of stubbing are what make the shots worth looking at at all:
//
//   1. `chrome.tabs` is stubbed. Opened as a plain tab, the panel asks
//      `chrome.tabs.query({active: true, currentWindow: true})` and gets
//      back ITS OWN tab, whose URL is `chrome-extension://…` — which
//      src/sidepanel/services/activeTab.ts correctly classifies as a
//      restricted page. Without the stub, every screenshot shows the
//      restricted state and nothing else.
//   2. `chrome.storage.local` is seeded with real `ChatSession` /
//      `chat:index` records (the shapes in src/lib/session.ts) so the
//      transcript has messages in it and the overflow menu has more than
//      five chats to list — i.e. so "Recent chats" and its "More" row are
//      both exercised.
//   3. `chrome.storage.sync` is seeded with one provider, and the seeded
//      session carries a resolved `selection` with `selectionExplicit`, so
//      the composer is UNBLOCKED and its model chip renders. Without that,
//      card 35's blocked state is all these shots would ever show. The
//      provider itself is not reachable, so the model sheet screenshot
//      captures the picker's unreachable-provider path — which is the state
//      most worth eyeballing anyway.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { sidepanelUrl } from "../lib/browser.mjs";

const FAKE_TAB = {
  id: 1,
  windowId: 1,
  index: 0,
  active: true,
  title: "Example Domain",
  url: "https://example.com/",
  favIconUrl: "https://example.com/favicon.ico",
};

/** Six chats: five fill the menu's recent list, the sixth forces the "More" row. */
const SEEDED_CHAT_COUNT = 6;

const SEEDED_PROVIDER = {
  id: "seed-provider",
  name: "Ollama",
  baseUrl: "http://localhost:11434",
  type: "ollama",
  defaultModel: "qwen3:8b",
};

function seedData() {
  const now = Date.now();
  const prompts = [
    "What does this page do?",
    "Summarise the pricing table",
    "Find the contact email",
    "Which form fields are required?",
    "List every outbound link",
    "Explain the error banner",
  ];
  const index = [];
  const chats = {};
  for (let i = 0; i < SEEDED_CHAT_COUNT; i++) {
    const id = `seed-${i}`;
    const updatedAt = now - i * 3600_000;
    const messages =
      i === 0
        ? [
            { id: `${id}-u`, role: "user", content: prompts[i] },
            {
              id: `${id}-a`,
              role: "assistant",
              content:
                "It's the IANA example domain — a reserved page kept for use in documentation.\n\n" +
                "- No forms, no scripts\n" +
                "- One outbound link, to `iana.org`\n\n" +
                "```html\n<h1>Example Domain</h1>\n```",
            },
          ]
        : [{ id: `${id}-u`, role: "user", content: prompts[i] }];
    chats[`chat:${id}`] = {
      id,
      origin: "https://example.com",
      messages,
      toolCalls: [],
      createdAt: updatedAt,
      updatedAt,
      selection: { providerId: SEEDED_PROVIDER.id, model: SEEDED_PROVIDER.defaultModel },
      // Card 35's "the user actually chose this" flag — without it the
      // composer sits in its needs-confirmation state instead.
      selectionExplicit: true,
    };
    index.push({
      id,
      origin: "https://example.com",
      createdAt: updatedAt,
      updatedAt,
      messageCount: messages.length,
      toolCallCount: 0,
      preview: prompts[i],
    });
  }
  return { ...chats, "chat:index": index, "tabchat:1": { chatId: "seed-0", tabOrigin: "https://example.com" } };
}

async function shoot(page, outDir, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export async function screenshotSidepanel(context, extensionId, outDir) {
  mkdirSync(outDir, { recursive: true });
  const page = await context.newPage();

  // Must be installed BEFORE the first navigation: activeTab.ts queries
  // chrome.tabs during mount.
  await page.addInitScript(
    ({ tab }) => {
      chrome.tabs.query = async () => [tab];
      chrome.tabs.get = async () => tab;
      const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (msg) => {
        if (msg && msg.type === "runtime:get-tools") {
          return {
            tools: [
              {
                name: "read-page-state",
                description: "Read the current state of the page.",
                inputSchema: { type: "object", properties: {} },
              },
              {
                name: "submit-form",
                description: "Submit the contact form.",
                inputSchema: { type: "object", properties: { email: { type: "string" } } },
                annotations: { destructiveHint: true },
              },
            ],
            available: true,
          };
        }
        return realSend(msg);
      };
    },
    { tab: FAKE_TAB },
  );

  // Seeding has to complete BEFORE the app mounts and reads storage, and
  // chrome.storage writes are async — doing it inside the init script races
  // the stores' initial load and loses. So: navigate once to get an
  // extension-origin context, write, then reload into a seeded world.
  await page.goto(sidepanelUrl(extensionId));
  await page.evaluate(
    async ({ seed, provider }) => {
      await chrome.storage.local.set(seed);
      // Providers live in storage.sync (src/lib/providers/registry.ts), not local.
      await chrome.storage.sync.set({
        "providers:list": [provider],
        "providers:default": { providerId: provider.id, model: provider.defaultModel },
      });
    },
    { seed: seedData(), provider: SEEDED_PROVIDER },
  );

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

  const menuButton = page.getByRole("button", { name: "More options" });
  if (await menuButton.count()) {
    await menuButton.first().click();
    await page.waitForTimeout(250);
    files.push(await shoot(page, outDir, "sidepanel-dark-menu"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }

  const modelChip = page.locator(".picker__trigger");
  if (await modelChip.count()) {
    await modelChip.first().click();
    await page.waitForTimeout(250);
    files.push(await shoot(page, outDir, "sidepanel-dark-model-sheet"));
  }

  await page.close();
  return { files };
}
