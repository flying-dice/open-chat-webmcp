// Setup for the "component" (jsdom) Vitest project only — see
// vitest.config.ts. Extends Vitest's `expect` with jest-dom's DOM matchers
// (`toBeInTheDocument`, `toHaveTextContent`, ...) for every component test,
// card 84 included, so no test file has to remember the import itself.
import "@testing-library/jest-dom/vitest";
