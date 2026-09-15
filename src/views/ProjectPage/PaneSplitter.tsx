/**
 * The draggable boundary between two panes in a split.
 *
 * Dragging it moves space from one side to the other, leaving every
 * other pane in the split alone — so a three-column row can have its
 * first boundary moved without the third column shifting.
 *
 * The arithmetic is done in pixels and converted back to shares at the
 * end, because that is the only way the pointer can track the boundary
 * exactly: shares are relative to a container whose size the splitter
 * would otherwise have to guess.
 */

import { useRef } from "react";
import { usePointerDrag } from "../../shared/usePointerDrag";
import { boundaryShares } from "./paneLayout";
import type { SplitDirection } from "./paneLayout";

/** Props for {@link PaneSplitter}. */
export interface PaneSplitterProps {
    /** Which way the parent split runs. */
    readonly direction: SplitDirection;
    /** Current share of the pane before this boundary. */
    readonly beforeSize: number;
    /** Current share of the pane after it. */
    readonly afterSize: number;
    /**
     * Measures the split's full extent along `direction`, in pixels.
     *
     * A callback rather than a number so the value is read when the
     * drag starts — a window resize between renders would otherwise
     * scale every drag wrongly.
     */
    readonly measureExtent: () => number;
    /** Called with the two new shares as the boundary moves. */
    readonly onResize: (beforeSize: number, afterSize: number) => void;
}

/**
 * Renders the boundary between two panes.
 *
 * @param props - The neighbouring shares and how to report a change.
 * @returns The splitter element.
 */
export function PaneSplitter({
    direction,
    beforeSize,
    afterSize,
    measureExtent,
    onResize,
}: PaneSplitterProps) {
    // Captured at the start of the gesture: the pointer must track the
    // boundary against where it was pressed, not against a share that
    // is changing underneath it.
    const startRef = useRef({ beforePx: 0, afterPx: 0 });

    const handleProps = usePointerDrag({
        onStart: () => {
            const extent = measureExtent();
            const total = beforeSize + afterSize;

            // Nothing to divide: a zero-width split is either unmounted
            // or mid-layout, and dividing by it would give NaN shares.
            if (extent <= 0 || total <= 0) return false;

            startRef.current = {
                beforePx: (beforeSize / total) * extent,
                afterPx: (afterSize / total) * extent,
            };
        },
        onMove: ({ deltaX, deltaY }) => {
            const { beforePx, afterPx } = startRef.current;
            const travelled = direction === "row" ? deltaX : deltaY;

            const shares = boundaryShares(beforePx, afterPx, travelled, beforeSize + afterSize);
            if (!shares) return;

            onResize(shares[0], shares[1]);
        },
    });

    return (
        <div
            className={`pane-splitter pane-splitter-${direction}`}
            role="separator"
            aria-orientation={direction === "row" ? "vertical" : "horizontal"}
            aria-label="Resize panes"
            {...handleProps}
        />
    );
}
