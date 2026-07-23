/**
 * Pointer-based drag-to-dock behavior for the file browser.
 *
 * The consuming component spreads {@link DockDrag.handleProps} onto a
 * drag handle. While dragging, `hoverSide` reports which half of the
 * window the pointer is in so drop zones can highlight; releasing the
 * pointer calls `onDock` with that side.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** Side of the window a panel can dock to. */
export type DockSide = "left" | "right";

/** Props to spread onto the drag-handle element. */
export interface DockDragHandleProps {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

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

    // Refs mirror the interaction state so the stable callbacks below
    // never read stale closures.
    const pressedRef = useRef(false);
    const startXRef = useRef(0);
    const passedThresholdRef = useRef(false);

    const resetDrag = useCallback(() => {
        pressedRef.current = false;
        passedThresholdRef.current = false;
        setIsDragging(false);
        setHoverSide(null);
    }, []);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        // Pointer capture routes all further move/up events to the
        // handle, even when the pointer leaves it.
        event.currentTarget.setPointerCapture(event.pointerId);
        pressedRef.current = true;
        startXRef.current = event.clientX;
        passedThresholdRef.current = false;
    }, []);

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
        if (!pressedRef.current) return;

        const movedFar = Math.abs(event.clientX - startXRef.current) >= DRAG_THRESHOLD_PX;
        if (!passedThresholdRef.current && !movedFar) return;

        passedThresholdRef.current = true;
        setIsDragging(true);
        setHoverSide(sideForPointer(event.clientX));
    }, []);

    const onPointerUp = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            const shouldDock = pressedRef.current && passedThresholdRef.current;

            if (shouldDock) {
                onDock(sideForPointer(event.clientX));
            }

            resetDrag();
        },
        [onDock, resetDrag],
    );

    const handleProps = useMemo<DockDragHandleProps>(
        () => ({
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: resetDrag,
        }),
        [onPointerDown, onPointerMove, onPointerUp, resetDrag],
    );

    return { isDragging, hoverSide, handleProps };
}
