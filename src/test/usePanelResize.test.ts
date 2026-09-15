/**
 * Tests for the panel-resize width arithmetic.
 *
 * The clamp is the whole safety guarantee behind dragging a panel —
 * it is what stops a user shrinking the browser to nothing, or the
 * editor to nothing — so it is checked directly rather than through a
 * simulated drag. The drag itself is covered in the browser suite,
 * where pointers and layout actually exist.
 */

import { describe, expect, it } from "vitest";
import {
    MIN_NEIGHBOUR_WIDTH_PX,
    MIN_PANEL_WIDTH_PX,
    clampPanelWidth,
} from "../shared/usePanelResize";

/** A container comfortably wide enough for both floors. */
const ROOMY_CONTAINER_PX = 1200;

describe("clampPanelWidth", () => {
    it("leaves a comfortable width alone", () => {
        expect(clampPanelWidth(320, ROOMY_CONTAINER_PX)).toBe(320);
    });

    it("refuses to shrink the panel past its minimum", () => {
        expect(clampPanelWidth(10, ROOMY_CONTAINER_PX)).toBe(MIN_PANEL_WIDTH_PX);
    });

    it("refuses a negative width", () => {
        expect(clampPanelWidth(-500, ROOMY_CONTAINER_PX)).toBe(MIN_PANEL_WIDTH_PX);
    });

    it("always leaves room for the neighbour", () => {
        const width = clampPanelWidth(ROOMY_CONTAINER_PX, ROOMY_CONTAINER_PX);

        expect(width).toBe(ROOMY_CONTAINER_PX - MIN_NEIGHBOUR_WIDTH_PX);
        expect(ROOMY_CONTAINER_PX - width).toBeGreaterThanOrEqual(MIN_NEIGHBOUR_WIDTH_PX);
    });

    it("rounds to whole pixels", () => {
        expect(clampPanelWidth(240.6, ROOMY_CONTAINER_PX)).toBe(241);
    });

    it("keeps the panel usable when the container cannot fit both", () => {
        // Both floors cannot be honoured at once here. The panel keeps
        // its minimum: shrinking it further would not give the
        // neighbour enough either, and would leave nothing to grab.
        const cramped = MIN_PANEL_WIDTH_PX + 50;

        expect(clampPanelWidth(400, cramped)).toBe(MIN_PANEL_WIDTH_PX);
        expect(clampPanelWidth(10, cramped)).toBe(MIN_PANEL_WIDTH_PX);
    });

    it("never returns a width a later drag could not recover from", () => {
        // Every width the clamp can produce, at any container size, is
        // at least the minimum — which is what makes the gesture safe
        // to explore.
        for (const container of [0, 100, 400, 800, 1600, 3000]) {
            for (const requested of [-100, 0, 1, 200, 5000]) {
                expect(clampPanelWidth(requested, container)).toBeGreaterThanOrEqual(
                    MIN_PANEL_WIDTH_PX,
                );
            }
        }
    });
});
