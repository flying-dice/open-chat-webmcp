// Screenshots the side panel page (opened as a plain tab, since MV3 side
// panel UI cannot be opened programmatically) in light and dark at 320px
// width, for a human to eyeball. BEST EFFORT: the panel is being actively
// edited by another agent concurrently, so a broken render here is an
// expected possibility, not a harness bug.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { sidepanelUrl } from "../lib/browser.mjs";

export async function screenshotSidepanel(context, extensionId, outDir) {
  mkdirSync(outDir, { recursive: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(sidepanelUrl(extensionId));
  await page.waitForLoadState("domcontentloaded");
  // Give the Svelte app a moment to mount (or fail trying to) before capturing.
  await page.waitForTimeout(700);

  const lightPath = path.join(outDir, "sidepanel-light-320w.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: lightPath });

  const darkPath = path.join(outDir, "sidepanel-dark-320w.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: darkPath });

  await page.close();
  return { lightPath, darkPath };
}
