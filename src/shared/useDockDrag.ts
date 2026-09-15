/**
 * Pointer-based drag-to-dock behavior for the file browser.
 *
 * The consuming component spreads {@link DockDrag.handleProps} onto a
 * drag handle. While dragging, `hoverSide` reports which half of the
 * window the pointer is in so drop zones can highlight; releasing the
 * pointer calls `onDock` with that side.
 */

import { useState } from "react";
import { usePointerDrag } from "./usePointerDrag";
import type { PointerDragHandleProps } from "./usePointerDrag";

/** Side of the window a panel can dock to. */
export type DockSide = "left" | "right";

/**
 * Props to spread onto the drag-handle element.
 *
 * An alias rather than its own shape: every handle in the app spreads
 * the same four pointer handlers, and declaring them separately here is
 * what let this hook and `usePanelResize` drift apart.
 */
export type DockDragHandleProps = PointerDragHandleProps;

/** State and handlers returned by {@link useDockDrag}. */
export interface DockDrag {
    /** True while a drag has passed the movement threshold. */
    readonly isDragging: boolean;
    /** The side the panel would dock to if released now. */
    readonly hoverSide: DockSide | null;
    /** Handlers for the drag-handle element. */
    readonly handleProps: DockDragHandleProps;
}

/** Minimum horizontal movement before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 8;

/**
 * Maps a pointer position to the window half it is in.
 *
 * @param clientX - The pointer's x coordinate.
 * @returns The dock side for that position.
 */
function sideForPointer(clientX: number): DockSide {
    return clientX < window.innerWidth / 2 ? "left" : "right";
}

/**
 * Provides drag-to-dock state and pointer handlers.
 *
 * @param onDock - Called with the chosen side when a drag is released.
 * @returns Drag state and the props for the handle element.
 */
export function useDockDrag(onDock: (side: DockSide) => void): DockDrag {
    const [isDragging, setIsDragging] = useState(false);
    const [hoverSide, setHoverSide] = useState<DockSide | null>(null);

    const clearDrag = (): void => {
        setIsDragging(false);
        setHoverSide(null);
    };

    const handleProps = usePointerDrag({
        // The header is a drag handle, but it is also just a header —
        // a press that never travels must not re-dock anything.
        thresholdPx: DRAG_THRESHOLD_PX,
        onMove: ({ clientX }) => {
            setIsDragging(true);
            setHoverSide(sideForPointer(clientX));
        },
        onEnd: ({ clientX }, moved) => {
            if (moved) onDock(sideForPointer(clientX));
            clearDrag();
        },
        onCancel: clearDrag,
    });

    return { isDragging, hoverSide, handleProps };
}
