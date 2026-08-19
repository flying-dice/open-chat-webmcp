// Terminates the extension's MV3 background service worker via the
// browser-level... no — the *page-attached* CDP ServiceWorker domain (the
// same mechanism as the "Stop" button in chrome://serviceworker-internals).
//
// Two things learned by spiking against this exact Chromium build before
// writing the real checks:
//  1. `browser.newBrowserCDPSession()` does NOT expose the ServiceWorker
//     domain ("'ServiceWorker.enable' wasn't found"); a session attached to
//     any ordinary page in the same context does.
//  2. `context.serviceWorkers()` is NOT a reliable signal for "did it
//     actually stop" — Playwright is slow (sometimes only after several
//     unrelated seconds, or even out-of-order) to remove the old Worker
//     object / fire the new 'serviceworker' event. The CDP
//     ServiceWorker.workerVersionUpdated event's `runningStatus` field is
//     authoritative and near-instant, so that's what this module trusts.
//     MV3 workers fully re-execute their top-level module on every
//     stopped -> running transition (no persisted heap across a stop), so
//     observing that transition for the same versionId is itself the proof
//     that in-memory state (e.g. src/background/sw.ts's `registry` Map) was
//     wiped.

export async function attachServiceWorkerCdp(context) {
  const probePage = await context.newPage();
  await probePage.goto("about:blank");
  const session = await context.newCDPSession(probePage);
  await session.send("ServiceWorker.enable");

  const versions = new Map(); // versionId -> latest ServiceWorkerVersion
  const onUpdate = (params) => {
    for (const v of params.versions || []) versions.set(v.versionId, v);
  };
  session.on("ServiceWorker.workerVersionUpdated", onUpdate);

  return {
    session,
    findRunningVersion(extensionId) {
      for (const v of versions.values()) {
        if (v.scriptURL?.includes(extensionId) && v.runningStatus === "running") return v;
      }
      return null;
    },
    async waitForRunningVersion(extensionId, timeoutMs = 8000) {
      return waitUntilValue(() => this.findRunningVersion(extensionId), timeoutMs);
    },
    async waitForStatus(versionId, status, timeoutMs = 8000) {
      return waitUntilValue(() => {
        const v = versions.get(versionId);
        return v?.runningStatus === status ? v : null;
      }, timeoutMs);
    },
    async close() {
      session.off("ServiceWorker.workerVersionUpdated", onUpdate);
      await session.detach().catch(() => {});
      await probePage.close().catch(() => {});
    },
  };
}

export async function stopWorker(cdp, versionId) {
  await cdp.session.send("ServiceWorker.stopWorker", { versionId });
}

async function waitUntilValue(getValue, timeoutMs, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const v = getValue();
    if (v) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return getValue();
}
