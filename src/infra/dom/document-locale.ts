/**
 * `<html lang>` / `<html dir>` bootstrap (card 100,
 * decisions/37-i18n-paraglide.md).
 *
 * Both `index.html` files ship a hardcoded `lang="en"` and no `dir` at all,
 * which is correct for exactly one of the ten locales decision 37 names. Two
 * separate things depend on getting this right, and neither is cosmetic:
 *
 *   `lang`  the browser's own language-sensitive behaviour — hyphenation,
 *           quote and digit shaping, the voice a screen reader picks, and
 *           `:lang()` in CSS. A screen reader reading German copy in an
 *           English voice is the failure this prevents.
 *   `dir`   the writing direction the whole page inherits. Tailwind v4's
 *           logical utilities (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/…) and the
 *           `rtl:` variant BOTH resolve against it, so for Arabic and Hebrew
 *           this one attribute is what makes card 104's utility sweep mean
 *           anything. Without it that sweep is a no-op.
 *
 * It runs BEFORE `mount()` on both surfaces (src/sidepanel/main.ts,
 * src/options/main.ts) so the first paint is already in the right direction —
 * the same reason `startDarkModeSync()` runs there. There is no "keep it in
 * sync" half to this the way there is for the theme: Paraglide's `setLocale()`
 * reloads the document by default (decisions/37 chose that over a bespoke
 * reactivity layer), and a reload re-runs this from the top.
 *
 * Both values arrive as ARGUMENTS rather than being read from
 * `src/paraglide/runtime.js` here, for two reasons. It keeps this adapter's
 * dependency the document and nothing else — the composition root is what
 * knows where a locale comes from, exactly as it is what knows which storage
 * adapter to build (`only-roots-construct-infra` in .dependency-cruiser.cjs).
 * And it leaves the RTL question with Paraglide's own `getTextDirection()`,
 * which resolves it from `Intl.Locale`'s text info with a hardcoded RTL
 * language set as fallback; a second, hand-maintained list of right-to-left
 * languages in this repo would only be a way for the two to disagree.
 */

/**
 * Stamp `locale` onto `<html lang>` and `direction` onto `<html dir>`.
 * Idempotent, and safe to call before anything is mounted —
 * `document.documentElement` exists from the moment the parser sees `<html>`,
 * which is well before a module script runs.
 */
export function applyDocumentLocale(locale: string, direction: "ltr" | "rtl"): void {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = direction;
}
