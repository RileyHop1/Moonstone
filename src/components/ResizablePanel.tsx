/**
 * A side panel the user can resize by dragging, and collapse out of
 * the way entirely.
 *
 * The panel owns its own width and collapsed state so its content —
 * the file browser today, a second file window later — needs to know
 * nothing about either. Whatever sits beside it reclaims the space on
 * its own, provided that neighbour is a flex child that grows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DockSide } from "../shared/useDockDrag";
import {
    MIN_PANEL_WIDTH_PX,
    clampPanelWidth,
    usePanelResize,
} from "../shared/usePanelResize";
import "../styles/ResizablePanel.css";

/** Props for {@link ResizablePanel}. */
export interface ResizablePanelProps {
    /** Width the panel opens at, in pixels. */
    readonly initialWidth: number;
    /** Which edge the panel is docked to. */
    readonly side: DockSide;
    /** Accessible label for the splitter and collapse control. */
    readonly label: string;
    /** The panel's contents. */
    readonly children: ReactNode;
}

/** Width of the rail left behind when the panel is collapsed. */
const COLLAPSED_RAIL_PX = 26;

/**
 * Renders a resizable, collapsible side panel.
 *
 * @param props - Initial width, dock side, label and contents.
 * @returns The panel element.
 */
export function ResizablePanel({
    initialWidth,
    side,
    label,
    children,
}: ResizablePanelProps) {
    // The width the user asked for, which outlives a window too narrow
    // to honour it: shrinking the window and widening it again gives
    // their choice back rather than quietly keeping the squeezed value.
    const [preferredWidth, setPreferredWidth] = useState(initialWidth);
    const [containerWidth, setContainerWidth] = useState<number | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // The panel's own element, so the space it shares with its
    // neighbour is measured rather than assumed from the window.
    const panelRef = useRef<HTMLDivElement | null>(null);

    // Measured in an effect, never during render: on the first render
    // the ref is still null, and a fallback guess there once pinned the
    // panel to its minimum before the user had touched anything.
    useEffect(() => {
        const container = panelRef.current?.parentElement;
        if (!container) return;

        const observer = new ResizeObserver(([entry]) => {
            if (entry) setContainerWidth(entry.contentRect.width);
        });
        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    const appliedWidth = isCollapsed
        ? COLLAPSED_RAIL_PX
        : containerWidth === null
          ? Math.max(preferredWidth, MIN_PANEL_WIDTH_PX)
          : clampPanelWidth(preferredWidth, containerWidth);

    // The drag starts from what is on screen, not from a preference the
    // container may currently be too narrow to honour.
    const appliedWidthRef = useRef(appliedWidth);
    appliedWidthRef.current = appliedWidth;

    const { isResizing, handleProps } = usePanelResize({
        side,
        getWidth: useCallback(() => appliedWidthRef.current, []),
        getAvailableWidth: useCallback(
            () => panelRef.current?.parentElement?.clientWidth ?? Number.POSITIVE_INFINITY,
            [],
        ),
        onResize: setPreferredWidth,
    });

    /**
     * Collapses the panel, or restores it to the width it had.
     *
     * The width is deliberately left untouched while collapsed, so it
     * is still there to come back to.
     */
    const toggleCollapsed = useCallback((): void => {
        setIsCollapsed((collapsed) => !collapsed);
    }, []);

    const collapseTowards = side === "left" ? "◀" : "▶";
    const expandTowards = side === "left" ? "▶" : "◀";

    return (
        <div
            ref={panelRef}
            className={
                `resizable-panel resizable-panel-${side}` +
                (isCollapsed ? " resizable-panel-collapsed" : "")
            }
            style={{ width: `${appliedWidth}px` }}
        >
            {!isCollapsed && <div className="resizable-panel-content">{children}</div>}

            <div className={`panel-splitter${isResizing ? " panel-splitter-active" : ""}`}>
                <button
                    type="button"
                    className="panel-collapse-toggle"
                    title={isCollapsed ? `Show ${label}` : `Hide ${label}`}
                    aria-label={isCollapsed ? `Show ${label}` : `Hide ${label}`}
                    aria-expanded={!isCollapsed}
                    // The splitter below would otherwise start a drag
                    // from the same press and swallow the click.
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={toggleCollapsed}
                >
                    {isCollapsed ? expandTowards : collapseTowards}
                </button>

                {/*
                 * Only a expanded panel can be dragged: a collapsed one
                 * has no width to adjust, and dragging the rail would
                 * be a confusing way to discover that.
                 */}
                {!isCollapsed && (
                    <div
                        className="panel-splitter-grip"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${label}`}
                        {...handleProps}
                    />
                )}
            </div>
        </div>
    );
}
