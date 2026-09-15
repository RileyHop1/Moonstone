/**
 * The pointer-drag gesture every draggable handle in Moonstone is built
 * on: the file browser's dock handle, the panel splitter, and the
 * splitter between editor panes.
 *
 * All three were the same twenty lines — press, capture the pointer,
 * track movement, release — differing only in what they do with the
 * numbers. They had also drifted: the panel splitter checked
 * `isPrimary && button === 0` and the dock handle did not, so a
 * right-button drag on the file browser header re-docked the panel.
 * Centralising the gesture fixes that everywhere at once.
 *
 * Pointer capture is the reason this is worth sharing at all. Without
 * it, moving faster than the browser dispatches events takes the
 * pointer off the handle and the drag simply stops; with it, every
 * further move and the release are routed back to the handle even when
 * the pointer is somewhere else entirely.
 */

import { useCallback, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/** Props to spread onto a drag-handle element. */
export interface PointerDragHandleProps {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}

/** Where a drag is, relative to where it started. */
export interface PointerDragPosition {
    /** The pointer's current x coordinate. */
    readonly clientX: number;
    /** The pointer's current y coordinate. */
    readonly clientY: number;
    /** How far the pointer has moved horizontally since the press. */
    readonly deltaX: number;
    /** How far the pointer has moved vertically since the press. */
    readonly deltaY: number;
}

/** What a caller does at each stage of the gesture. */
export interface PointerDragHandlers {
    /**
     * Called on a press that starts a drag, before any movement.
     *
     * Return false to decline the gesture — used where the handle is
     * conditionally inert.
     */
    readonly onStart?: (position: PointerDragPosition) => boolean | void;
    /** Called on each move once the threshold has been passed. */
    readonly onMove?: (position: PointerDragPosition) => void;
    /**
     * Called when the pointer is released.
     *
     * `moved` is false for a press that never passed the threshold —
     * a click, not a drag — which is how a handle tells the two apart.
     */
    readonly onEnd?: (position: PointerDragPosition, moved: boolean) => void;
    /** Called when the gesture is cancelled rather than released. */
    readonly onCancel?: () => void;
    /**
     * Movement in pixels before the gesture counts as a drag.
     *
     * Zero — the default — reports every move, which is what a splitter
     * wants. A handle that also responds to clicks needs a few pixels of
     * slack so a shaky click is not read as a drag.
     */
    readonly thresholdPx?: number;
}

/**
 * Wires up a pointer-drag gesture on a handle element.
 *
 * @param handlers - What to do at each stage of the gesture.
 * @returns Props to spread onto the handle element.
 */
export function usePointerDrag(handlers: PointerDragHandlers): PointerDragHandleProps {
    // The latest handlers, read at gesture time, so the returned props
    // stay stable across renders and a caller need not memoise.
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    const pressedRef = useRef(false);
    const passedThresholdRef = useRef(false);
    const startXRef = useRef(0);
    const startYRef = useRef(0);

    const positionOf = useCallback(
        (event: ReactPointerEvent<HTMLElement>): PointerDragPosition => ({
            clientX: event.clientX,
            clientY: event.clientY,
            deltaX: event.clientX - startXRef.current,
            deltaY: event.clientY - startYRef.current,
        }),
        [],
    );

    const reset = useCallback(() => {
        pressedRef.current = false;
        passedThresholdRef.current = false;
    }, []);

    const onPointerDown = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            // Secondary buttons and non-primary pointers (a second
            // finger, say) are not drags.
            if (!event.isPrimary || event.button !== 0) return;

            startXRef.current = event.clientX;
            startYRef.current = event.clientY;

            if (handlersRef.current.onStart?.(positionOf(event)) === false) return;

            // Routes every further move and the release back here, even
            // once the pointer has left the handle.
            event.currentTarget.setPointerCapture(event.pointerId);
            pressedRef.current = true;
            passedThresholdRef.current = false;

            // Stops the press turning into a text selection or the
            // browser's own drag of whatever is under the pointer.
            event.preventDefault();
        },
        [positionOf],
    );

    const onPointerMove = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            if (!pressedRef.current) return;

            const position = positionOf(event);

            if (!passedThresholdRef.current) {
                const threshold = handlersRef.current.thresholdPx ?? 0;
                const travelled = Math.max(
                    Math.abs(position.deltaX),
                    Math.abs(position.deltaY),
                );
                if (travelled < threshold) return;

                passedThresholdRef.current = true;
            }

            handlersRef.current.onMove?.(position);
        },
        [positionOf],
    );

    const onPointerUp = useCallback(
        (event: ReactPointerEvent<HTMLElement>) => {
            if (!pressedRef.current) return;

            const moved = passedThresholdRef.current;
            reset();
            handlersRef.current.onEnd?.(positionOf(event), moved);
        },
        [positionOf, reset],
    );

    const onPointerCancel = useCallback(() => {
        if (!pressedRef.current) return;

        reset();
        handlersRef.current.onCancel?.();
    }, [reset]);

    return useMemo<PointerDragHandleProps>(
        () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
        [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
    );
}
