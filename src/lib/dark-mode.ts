/**
 * shadcn-svelte's dark theme is class-based: `src/app.css` declares
 * `@custom-variant dark (&:is(.dark *))`, so every `dark:` utility and the
 * `.dark { --token: ... }` block only apply beneath an element carrying the
 * `dark` class. Nothing puts that class there on its own.
 *
 * The extension has no in-app theme toggle (decisions/28-shadcn-svelte-maia-zinc.md)
 * — it follows the OS/browser setting — so both UI surfaces call this once at
 * boot to mirror `prefers-color-scheme` onto `<html>` and keep mirroring it as
 * the user flips their system theme with the panel open.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

function apply(isDark: boolean): void {
  document.documentElement.classList.toggle("dark", isDark);
}

/**
 * Sync `<html class="dark">` with `prefers-color-scheme`, now and on every
 * change. Returns a teardown that stops listening — the entry points never
 * need it (the document dies with the listener), but it keeps this testable
 * and lets a future host page opt out.
 */
export function startDarkModeSync(): () => void {
  const media = window.matchMedia(DARK_QUERY);
  apply(media.matches);

  const onChange = (event: MediaQueryListEvent) => apply(event.matches);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
