// The story surface's runtime (card 123, decisions/42-storybook.md).
//
// src/sidepanel/main.ts and src/options/main.ts each do three things before
// `mount()`: import the one stylesheet, fill the services singleton, and put
// the document into the right theme, language and writing direction. A story
// needs all three too — it just needs them per STORY, driven by a toolbar,
// instead of once per document. So this file is the story surface's version of
// those roots, and every decorator below is one line of `main.ts` made
// switchable.
//
// -- The three toolbar axes (decision 42) ------------------------------------
//
//   theme   `.dark` on `<html>`. The extension has NO in-app theme toggle
//           (decisions/28) — src/infra/dom/dark-mode.ts mirrors
//           `prefers-color-scheme` — so a reviewer on a light OS could not see
//           the dark side of a component at all before this. The decorator
//           writes the same class `startDarkModeSync()` writes, which is what
//           `@custom-variant dark (&:is(.dark *))` in src/app.css resolves
//           every `dark:` utility and `.dark { --token }` override against.
//   locale  all ten, labelled with the endonyms src/ui/localeNames.ts holds
//           (the options page's own language picker reads the same table).
//           Driving Paraglide's `setLocale` AND the `<html lang>`/`<html dir>`
//           bootstrap is what makes this a real RTL switch rather than a
//           translated-strings switch: Tailwind's logical utilities and the
//           `rtl:` variant resolve against `dir`, so `ar`/`he` only mirror if
//           that attribute follows the locale (see
//           src/infra/dom/document-locale.ts).
//   width   320/400px, OPT-IN via `parameters.panelWidth` — see
//           ./PanelWidth.svelte for why those two numbers and why it is not a
//           Storybook viewport.
//
// -- Two kinds of decorator --------------------------------------------------
//
// The Svelte renderer decides what a decorator MEANT by identity: return the
// value `storyFn(context)` gave you and it was a side effect; return anything
// else and it is treated as a wrapping component. Theme, locale and services
// are side effects on the document/the singletons and return the story
// unchanged; only the width preset wraps.
//
// Decorators are applied innermost-LAST, so listing services first means it
// runs outermost — the singletons are refilled before the locale is set and
// long before the component reads a port.

import "../src/app.css";

import type { Decorator, Preview } from "@storybook/svelte-vite";

import { applyDocumentLocale } from "../src/infra/dom";
import { localeEndonym } from "../src/ui/localeNames";
import { getTextDirection, locales, setLocale, type Locale } from "../src/paraglide/runtime.js";
import PanelWidth from "./PanelWidth.svelte";
import {
  initStoryServices,
  resetOptionsStoryServices,
  resetSidePanelStoryServices,
  type OptionsServicesSeed,
  type SidePanelServicesSeed,
} from "./story-services";

// Before Storybook imports a single story module — see initStoryServices' own
// comment for why that ordering is load-bearing.
initStoryServices();

/**
 * The parameters a story may set on top of Storybook's own.
 *
 * Storybook types `parameters` as an open `Record<string, any>` bag, so this
 * interface is what gives the three decorators below something to read that a
 * typo fails against. Declared here rather than module-augmenting Storybook's
 * own `Parameters`: an augmentation would apply repo-wide from whichever file
 * happened to be loaded first, and this is one surface's contract.
 */
interface StoryParameters {
  /** Wrap this story in a side-panel-width container. Omit for full-width (options/shared-UI) stories. */
  panelWidth?: 320 | 400;
  /** Canned data for this story: a callback per surface, handed a freshly reset fake bundle to seed. */
  services?: {
    sidepanel?: SidePanelServicesSeed;
    options?: OptionsServicesSeed;
  };
}

/**
 * Refill both service singletons from fresh fakes, then let this story seed
 * whichever surface it needs. Runs for EVERY story, seeded or not, so a story
 * that sets nothing is guaranteed the untouched defaults rather than whatever
 * the previously-viewed story left behind (see ./story-services.ts).
 */
const withServices: Decorator = (story, context) => {
  const { services } = context.parameters as StoryParameters;
  services?.sidepanel?.(resetSidePanelStoryServices());
  services?.options?.(resetOptionsStoryServices());
  return story(context);
};

/** `.dark` on `<html>`, exactly as src/infra/dom/dark-mode.ts writes it. */
const withTheme: Decorator = (story, context) => {
  document.documentElement.classList.toggle("dark", context.globals.theme === "dark");
  return story(context);
};

/**
 * Paraglide's locale AND the document's lang/dir, together — the pair
 * src/{sidepanel,options}/main.ts apply at boot.
 *
 * `{ reload: false }`: Paraglide's default is to reload the document so every
 * already-rendered `m.someKey()` is re-evaluated, which is right for the two
 * real surfaces (decisions/37) and wrong here — Storybook re-renders the story
 * itself whenever a global changes, so the message functions run again anyway,
 * and a reload would throw away the preview iframe mid-switch. The
 * localStorage write `setLocale` does is still the real one, so `getLocale()`
 * inside a component resolves through the app's own strategy chain.
 */
const withLocale: Decorator = (story, context) => {
  const locale = context.globals.locale as Locale;
  setLocale(locale, { reload: false });
  applyDocumentLocale(locale, getTextDirection(locale));
  return story(context);
};

/** Opt-in side-panel width. The one decorator here that actually wraps. */
const withPanelWidth: Decorator = (story, context) => {
  const { panelWidth } = context.parameters as StoryParameters;
  if (panelWidth === undefined) return story(context);
  return { Component: PanelWidth, props: { width: panelWidth } };
};

const preview: Preview = {
  decorators: [withServices, withTheme, withLocale, withPanelWidth],
  globalTypes: {
    theme: {
      description: "Light or dark — the `.dark` class the extension mirrors from the OS",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description:
        "UI language — drives Paraglide plus <html lang>/<html dir>, so RTL is one click",
      toolbar: {
        title: "Locale",
        icon: "globe",
        items: locales.map((locale) => ({ value: locale, title: localeEndonym(locale) })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "light",
    locale: "en",
  },
  parameters: {
    // The app's own surface colour, not Storybook's white — the tokens follow
    // the theme toolbar, so the canvas does too.
    backgrounds: { disable: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
