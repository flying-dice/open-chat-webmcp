---
column: todo
labels: [infra]
priority: med
updatedAt: 2026-08-23T23:50:00.000Z
---
# Harness: drive the TRUE side panel, not the panel-as-tab

The scenario pack's "chip appears" pass drove the panel document opened as
a TAB — the genuine side panel had never been automated, which let a
real-panel-only doubt survive until a live report forced a scratch probe.
The probe proved the technique; port it into verify/lib as a reusable
driver: plant a button on the options page that calls
chrome.sidePanel.open({windowId}) and click it with Playwright (trusted
gesture — CDP userGesture on the worker does NOT satisfy the requirement),
then find the panel's raw CDP target via the debug-port /json list (the
true panel is never a Playwright page) and drive it with Runtime.evaluate +
Input.dispatchMouseEvent. Launch needs --remote-debugging-port. Convert the
sharing-gate scenario's chip steps to the true panel; keep the tab flavour
for the checks where stubs are the point.

## Checklist

- [ ] Reusable true-panel driver in verify/lib with the technique documented
- [ ] Sharing-gate chip scenario running against the genuine side panel, 3x green
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
