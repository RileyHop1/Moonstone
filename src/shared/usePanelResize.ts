/**
 * Pointer-based resizing for a side panel.
 *
 * The consuming component spreads {@link PanelResize.handleProps} onto
 * a splitter element; dragging it reports a new width, already clamped
 * to something usable.
 *
 * Built as a sibling of `useDockDrag` and for the same reason: pointer
 * capture routes every move and release back to the handle even when
 * the pointer outruns it, which a plain mousemove listener does not.
 */

import { useRef, useState } from "react";
import { usePointerDrag } from "./usePointerDrag";
import type { PointerDragHandleProps } from "./usePointerDrag";
import type { DockSide } from "./useDockDrag";

/** Props to spread onto the splitter element. */
export type PanelResizeHandleProps = PointerDragHandleProps;

/** State and handlers returned by {@link usePanelResize}. */
export interface PanelResize {
    /** True while the splitter is being dragged. */
    readonly isResizing: boolean;
    /** Handlers for the splitter element. */
    readonly handleProps: PanelResizeHandleProps;
}

/** Options for {@link usePanelResize}. */
export interface PanelResizeOptions {
    /** Which edge the panel is docked to; decides the drag direction. */
    readonly side: DockSide;
    /** Reads the panel's current width when a drag starts. */
    readonly getWidth: () => number;
    /** Reads the width available to the panel and its neighbour. */
    readonly getAvailableWidth: () => number;
    /** Receives each clamped width as the drag progresses. */
    readonly onResize: (width: number) => void;
}

/**
 * Narrowest the panel may become.
 *
 * A panel that can be dragged to nothing is a panel the user cannot
 * get back — the floor is what makes the gesture safe to explore.
 */
export const MIN_PANEL_WIDTH_PX = 150;

/** Width always left to whatever sits beside the panel. */
export const MIN_NEIGHBOUR_WIDTH_PX = 240;

/**
 * Clamps a requested width so neither the panel nor its neighbour can
 * be squeezed out of existence.
 *
 * Pure and exported for testing: the arithmetic is the whole safety
 * guarantee, and it is far easier to check here than through a drag.
 *
 * @param requested - The width the drag is asking for.
 * @param availableWidth - Total width shared by the panel and its neighbour.
 * @returns The width to apply.
 */
export function clampPanelWidth(requested: number, availableWidth: number): number {
    // A container too narrow to honour both floors gives the panel the
    // minimum: shrinking it further would not help the neighbour, and
    // an unusable panel is worse than a cramped one.
    const maximum = Math.max(MIN_PANEL_WIDTH_PX, availableWidth - MIN_NEIGHBOUR_WIDTH_PX);

    return Math.round(Math.min(Math.max(requested, MIN_PANEL_WIDTH_PX), maximum));
}

/**
 * Provides splitter drag state and pointer handlers.
 *
 * @param options - Dock side, width accessors, and the resize callback.
 * @returns Resize state and the props for the splitter element.
 */
export function usePanelResize({
    side,
    getWidth,
    getAvailableWidth,
    onResize,
}: PanelResizeOptions): PanelResize {
    const [isResizing, setIsResizing] = useState(false);

    // The width when the gesture began; every move is measured from it
    // rather than accumulated, so rounding cannot drift.
    const startWidthRef = useRef(0);

    const handleProps = usePointerDrag({
        onStart: () => {
            startWidthRef.current = getWidth();
            setIsResizing(true);
        },
        onMove: ({ deltaX }) => {
            // Docked right, the panel grows as the pointer moves left,
            // so the delta is inverted.
            const delta = side === "left" ? deltaX : -deltaX;

            onResize(clampPanelWidth(startWidthRef.current + delta, getAvailableWidth()));
        },
        onEnd: () => {
            setIsResizing(false);
        },
        onCancel: () => {
            setIsResizing(false);
        },
    });

    return { isResizing, handleProps };
}
