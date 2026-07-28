/**
 * Global test setup: jest-dom matchers, a ResizeObserver stub, and
 * per-test DOM cleanup.
 *
 * Cleanup is manual because vitest globals are off (the suites import
 * describe/it/expect explicitly), which disables Testing Library's
 * automatic afterEach hook.
 */

import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom implements no ResizeObserver, and components that watch their
 * container for size changes would otherwise throw on mount.
 *
 * Deliberately inert rather than a simulation: jsdom has no layout, so
 * there are no size changes to report and a fake that invented some
 * would only mislead. Anything that depends on an observed size is
 * tested in the browser suite instead — see `docs/browser-tests.md`.
 */
class InertResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

globalThis.ResizeObserver ??= InertResizeObserver;

afterEach(() => {
    cleanup();
});
