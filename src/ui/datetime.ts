// Dates and times in the INTERFACE's locale (card 105,
// decisions/37-i18n-paraglide.md).
//
// `new Date(ms).toLocaleString()` with no argument formats in the BROWSER's
// locale, which is not the same thing as the language the user picked for
// this extension: someone running Chrome in English who switches the side
// panel to Japanese was getting "8/22/2026, 6:08:08 PM" in the middle of an
// otherwise Japanese line, and an Arabic reader got Latin-digit US dates
// inside an RTL sentence. There were four such call sites (this card found
// them while reading the `ar` options screenshot), all making the same
// mistake, so the fix is one leaf module rather than four `getLocale()`
// arguments that the fifth call site will forget.
//
// The tag comes from Paraglide's `getLocale()`, i.e. the same value the
// message functions resolve with, so the date can never disagree with the
// sentence around it. Every tag in project.inlang/settings.json is a valid
// BCP-47 tag that `Intl` accepts, which is what keeps this free of the
// try/catch a user-supplied tag would need (decisions/34).
import { getLocale } from "../paraglide/runtime.js";

/** Date and time together, e.g. a chat's "last updated" stamp. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(getLocale());
}

/** Time of day only, e.g. when a tool call started. */
export function formatTimeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(getLocale());
}
