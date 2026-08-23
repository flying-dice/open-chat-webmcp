/**
 * Each locale's name IN ITS OWN LANGUAGE — "Deutsch", not "German"
 * (card 105, decisions/37-i18n-paraglide.md).
 *
 * That is the convention a language picker is read by: someone who has landed
 * in the wrong locale needs to recognise their own language in the list, which
 * they cannot do if the list is written in the language they are trying to
 * leave.
 *
 * Spelled out rather than derived from `Intl.DisplayNames`, which card 105
 * measured against this list and found gives the wrong ANSWER for a picker
 * three times over: `zh-CN` comes back as "中文（中国）" where the endonym a
 * Simplified-Chinese reader looks for is "简体中文", and `fr`/`es`/`ru` come
 * back lowercase ("français", "español", "русский") because CLDR stores them
 * the way they are written mid-sentence, not the way a list item is. A
 * hand-written table is also the only form that can be READ in review, which
 * for the one control a lost user has to navigate by matters more than saving
 * ten lines.
 *
 * Typed `Record<Locale, string>` against Paraglide's compiled `locales` tuple
 * on purpose: a locale added to project.inlang/settings.json with no endonym
 * here is a `npm run check` failure, not a picker row reading "pt-BR".
 *
 * WHY IT LIVES IN src/ui (card 123): it was a `const` inside
 * src/options/components/SettingsSection.svelte's instance script — private to
 * the one component that needed it — until Storybook's locale toolbar
 * (decisions/42-storybook.md) became a SECOND reader of exactly this table,
 * for exactly the same reason (a picker of all ten locales, labelled so you
 * can find your own). A second hand-written copy in `.storybook/preview.ts`
 * would have been one more place for the two to disagree with no compiler
 * between them, so the table moved to the shared UI layer where both surfaces
 * and the story surface can read the one copy.
 */

import type { Locale } from "../paraglide/runtime.js";

const LOCALE_ENDONYMS: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  "pt-BR": "Português (Brasil)",
  ko: "한국어",
  ru: "Русский",
  ar: "العربية",
};

/** `locale`'s name in its own language — "Deutsch" for `de`. */
export function localeEndonym(locale: Locale): string {
  return LOCALE_ENDONYMS[locale];
}
