/**
 * Global test setup: jest-dom matchers and per-test DOM cleanup.
 *
 * Cleanup is manual because vitest globals are off (the suites import
 * describe/it/expect explicitly), which disables Testing Library's
 * automatic afterEach hook.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
    cleanup();
});
