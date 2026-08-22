---
column: todo
labels: [frontend]
priority: med
updatedAt: 2026-08-23T12:00:00.000Z
---
# RTL readiness sweep

Prepare both surfaces for Arabic before translations land
(decisions/37): the one-time sweep from physical to logical Tailwind
utilities across all components — ml-/mr-/pl-/pr-/left-/right-/text-left/
text-right/border-l/r/rounded-l/r → ms-/me-/ps-/pe-/start-/end-/
text-start/text-end/border-s/e/rounded-s/e — so the dir flip from card
100's bootstrap does the work. Audit Hugeicons for genuinely directional
glyphs (back/forward arrows, chevrons) and give only those rtl:scale-x-
[-1]; symmetric icons untouched. Verify the transcript, composer, menus,
popovers and forms under dir="rtl" with a pseudo-locale or forced dir
(screenshots at 400px), including bidi edge cases (LTR tool names and URLs
inside RTL text get dir="ltr"/unicode-bidi isolation where needed).

## Checklist

- [ ] Physical-direction utility sweep complete; grep proves no stragglers outside vendored kit
- [ ] Directional icons flipped via rtl: variant; inventory journalled
- [ ] Mono identifiers/URLs bidi-isolated in transcript and tool views
- [ ] dir="rtl" screenshot pass over key screens journalled (both surfaces)
- [ ] npm test, npm run check, npm run guard, npm run build, npm run verify green
