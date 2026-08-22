// Smoke test for the "component" jsdom Vitest project (card 82,
// vitest.config.ts) — NOT coverage of any real component, that is card 84's
// job. This proves, once, that the four pieces the CRXJS multi-entry build
// otherwise hides behind `vite.config.ts` actually work together under
// Vitest: the Svelte plugin compiles a `.svelte` file with runes, jsdom
// supplies a DOM for it to mount into, @testing-library/svelte can render
// and query it, and vitest.setup.ts's jest-dom import extends `expect` with
// `toHaveTextContent`. If this test breaks, the jsdom project itself is
// broken — the fixture is deliberately too trivial to break on its own.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Smoke from "./Smoke.svelte";

describe("jsdom component project (smoke)", () => {
  it("mounts a Svelte 5 component and reads its rendered text via Testing Library + jest-dom", () => {
    render(Smoke, { name: "Vitest" });
    expect(screen.getByText("Hello, Vitest!")).toBeInTheDocument();
  });
});
