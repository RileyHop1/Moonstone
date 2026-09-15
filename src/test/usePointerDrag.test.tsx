/**
 * Tests for the shared pointer-drag gesture.
 *
 * Three handles are built on this — the file browser's dock handle, the
 * panel splitter, and the boundary between editor panes — so the
 * decisions it makes are worth pinning down once here rather than three
 * times over. Geometry is not tested here; jsdom has no layout, and the
 * browser suite covers real drags.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePointerDrag } from "../shared/usePointerDrag";
import type { PointerDragHandlers } from "../shared/usePointerDrag";

/**
 * Renders a bare handle wired to the gesture.
 *
 * @param handlers - What the handle should do.
 * @returns The handle element.
 */
function renderHandle(handlers: PointerDragHandlers): HTMLElement {
    function Handle() {
        const props = usePointerDrag(handlers);

        return <div data-testid="handle" {...props} />;
    }

    render(<Handle />);

    return screen.getByTestId("handle");
}

/** A left-button press from the primary pointer. */
const PRIMARY = { isPrimary: true, button: 0, pointerId: 1 };

describe("usePointerDrag", () => {
    it("reports movement during a drag", () => {
        const onMove = vi.fn();
        const handle = renderHandle({ onMove });

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 50 });
        fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 140, clientY: 70 });

        expect(onMove).toHaveBeenCalledWith({
            clientX: 140,
            clientY: 70,
            deltaX: 40,
            deltaY: 20,
        });
    });

    it("ignores a right-button press", () => {
        // The bug this consolidation fixes: `useDockDrag` had no button
        // guard, so a right-click drag on the file browser's header
        // re-docked the panel.
        const onMove = vi.fn();
        const onEnd = vi.fn();
        const handle = renderHandle({ onMove, onEnd });

        fireEvent.pointerDown(handle, {
            isPrimary: true,
            button: 2,
            pointerId: 1,
            clientX: 100,
        });
        fireEvent.pointerMove(handle, {
            isPrimary: true,
            button: 2,
            pointerId: 1,
            clientX: 300,
        });
        fireEvent.pointerUp(handle, { isPrimary: true, button: 2, pointerId: 1, clientX: 300 });

        expect(onMove).not.toHaveBeenCalled();
        expect(onEnd).not.toHaveBeenCalled();
    });

    it("ignores a non-primary pointer", () => {
        // A second finger during a touch gesture is not a drag.
        const onMove = vi.fn();
        const handle = renderHandle({ onMove });

        fireEvent.pointerDown(handle, {
            isPrimary: false,
            button: 0,
            pointerId: 2,
            clientX: 100,
        });
        fireEvent.pointerMove(handle, {
            isPrimary: false,
            button: 0,
            pointerId: 2,
            clientX: 300,
        });

        expect(onMove).not.toHaveBeenCalled();
    });

    it("ignores movement with no press behind it", () => {
        const onMove = vi.fn();
        const handle = renderHandle({ onMove });

        fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 300 });

        expect(onMove).not.toHaveBeenCalled();
    });

    it("captures the pointer so the drag survives leaving the handle", () => {
        const handle = renderHandle({});

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100 });

        expect(handle.hasPointerCapture(1)).toBe(true);
    });

    it("lets a handler decline the gesture", () => {
        // A splitter refuses when its split has no measurable extent.
        const onMove = vi.fn();
        const handle = renderHandle({ onStart: () => false, onMove });

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100 });
        fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 300 });

        expect(onMove).not.toHaveBeenCalled();
    });

    describe("movement threshold", () => {
        it("withholds movement until the threshold is passed", () => {
            const onMove = vi.fn();
            const handle = renderHandle({ thresholdPx: 8, onMove });

            fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 0 });
            fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 104, clientY: 0 });

            expect(onMove).not.toHaveBeenCalled();
        });

        it("reports every move once the threshold is passed", () => {
            const onMove = vi.fn();
            const handle = renderHandle({ thresholdPx: 8, onMove });

            fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 0 });
            fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 120, clientY: 0 });
            // Back inside the threshold: the drag is already under way
            // and must not stop reporting.
            fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 102, clientY: 0 });

            expect(onMove).toHaveBeenCalledTimes(2);
        });

        it("reports a press that never moved as not a drag", () => {
            // This is what separates a click on the header from a drag
            // of it.
            const onEnd = vi.fn();
            const handle = renderHandle({ thresholdPx: 8, onEnd });

            fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 0 });
            fireEvent.pointerUp(handle, { ...PRIMARY, clientX: 102, clientY: 0 });

            expect(onEnd).toHaveBeenCalledWith(expect.anything(), false);
        });

        it("reports a press that travelled as a drag", () => {
            const onEnd = vi.fn();
            const handle = renderHandle({ thresholdPx: 8, onEnd });

            fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 0 });
            fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 140, clientY: 0 });
            fireEvent.pointerUp(handle, { ...PRIMARY, clientX: 140, clientY: 0 });

            expect(onEnd).toHaveBeenCalledWith(expect.anything(), true);
        });

        it("counts vertical travel towards the threshold", () => {
            const onMove = vi.fn();
            const handle = renderHandle({ thresholdPx: 8, onMove });

            fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 0, clientY: 100 });
            fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 0, clientY: 140 });

            expect(onMove).toHaveBeenCalled();
        });
    });

    it("cancels rather than ending when the gesture is interrupted", () => {
        const onEnd = vi.fn();
        const onCancel = vi.fn();
        const handle = renderHandle({ onEnd, onCancel });

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100 });
        fireEvent.pointerCancel(handle, { ...PRIMARY, clientX: 140 });

        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onEnd).not.toHaveBeenCalled();
    });

    it("ignores a release that no press preceded", () => {
        const onEnd = vi.fn();
        const handle = renderHandle({ onEnd });

        fireEvent.pointerUp(handle, { ...PRIMARY, clientX: 140 });

        expect(onEnd).not.toHaveBeenCalled();
    });

    it("starts a second gesture cleanly after the first ends", () => {
        const onMove = vi.fn();
        const handle = renderHandle({ onMove });

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 100, clientY: 0 });
        fireEvent.pointerUp(handle, { ...PRIMARY, clientX: 100, clientY: 0 });

        fireEvent.pointerDown(handle, { ...PRIMARY, clientX: 200, clientY: 0 });
        fireEvent.pointerMove(handle, { ...PRIMARY, clientX: 230, clientY: 0 });

        // Measured from the second press, not the first.
        expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ deltaX: 30 }));
    });
});
