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

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- lib.dom declares ResizeObserver unconditionally; jsdom does not provide one
globalThis.ResizeObserver ??= InertResizeObserver;

/**
 * jsdom implements no pointer capture, so any handle built on
 * `usePointerDrag` throws on the very first press.
 *
 * The capture is inert here for the same reason the ResizeObserver is:
 * jsdom dispatches exactly the events a test fires, so there is no
 * re-routing to simulate. What the stub buys is the ability to test the
 * *decisions* a drag makes — whether it starts at all, and what it
 * computes — with the geometry left to the browser suite. Capture is
 * recorded rather than ignored so a test can assert it was taken.
 */
const capturedPointers = new WeakMap<Element, Set<number>>();

/* eslint-disable @typescript-eslint/no-unnecessary-condition --
   lib.dom declares these three unconditionally, so the type system
   insists they are already there; jsdom does not implement them. */
if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = function setPointerCapture(
        this: Element,
        pointerId: number,
    ): void {
        const captured = capturedPointers.get(this) ?? new Set<number>();
        captured.add(pointerId);
        capturedPointers.set(this, captured);
    };

    Element.prototype.releasePointerCapture = function releasePointerCapture(
        this: Element,
        pointerId: number,
    ): void {
        capturedPointers.get(this)?.delete(pointerId);
    };

    Element.prototype.hasPointerCapture = function hasPointerCapture(
        this: Element,
        pointerId: number,
    ): boolean {
        return capturedPointers.get(this)?.has(pointerId) ?? false;
    };
}
/* eslint-enable @typescript-eslint/no-unnecessary-condition */

afterEach(() => {
    cleanup();
});
