/**
 * LTR bidi isolation for identifiers/URLs interpolated into translated
 * prose (card 104, decisions/37 RTL section). Tool names, origins/URLs and
 * model ids are always left-to-right runs no matter what language the
 * surrounding sentence is in. Left inside an Arabic sentence unmarked, the
 * Unicode bidi algorithm can reorder the punctuation around them — e.g. a
 * trailing "؟" or a closing quote ends up on the wrong side of the domain
 * name — and RTL characters that ever show up inside a user-picked name
 * would bleed their direction into neighbouring text.
 *
 * `isolateLtr` wraps a value in U+2066 LEFT-TO-RIGHT ISOLATE / U+2069 POP
 * DIRECTIONAL ISOLATE. Isolate (not override): the wrapped run always
 * renders left-to-right, but characters inside it still reorder correctly
 * relative to each other, and nothing about it leaks into the surrounding
 * text's own direction. This is for values interpolated INSIDE an
 * already-assembled Paraglide message string, where there is no DOM element
 * boundary to hang a `dir="ltr"` attribute on. Wherever a value already sits
 * in its own element (a mono/code span, a `<div>` showing a URL, a Badge),
 * prefer `dir="ltr"` on that element instead — it is the more idiomatic,
 * inspectable fix and this helper is unnecessary there.
 */
export function isolateLtr(text: string): string {
  return `⁦${text}⁩`;
}

/**
 * Direction-NEUTRAL isolation, for a run whose direction is not ours to
 * decide (card 119): an excerpt of the user's selection on a page, which may
 * be Arabic inside an English UI or English inside an Arabic one.
 *
 * Wraps the value in U+2068 FIRST STRONG ISOLATE / U+2069 POP DIRECTIONAL
 * ISOLATE, so the run takes its own direction from its first strong character
 * — Hebrew text reads right-to-left even when quoted into an English
 * sentence — while still being sealed off from the sentence around it, which
 * is what keeps the punctuation of the surrounding message on the correct
 * side of it. {@link isolateLtr} is the right choice only where the value is
 * KNOWN to be left-to-right (a URL, a model id); using it on natural-language
 * text would force an RTL excerpt to render backwards.
 *
 * Same caveat as above: this is for a value interpolated INSIDE an assembled
 * message string (a tooltip, an `aria-label`). Where the excerpt has its own
 * element, `dir="auto"` on that element is the equivalent and more
 * inspectable fix.
 */
export function isolateAuto(text: string): string {
  return `⁨${text}⁩`;
}
