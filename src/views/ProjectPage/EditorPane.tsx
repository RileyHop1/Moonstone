/**
 * One pane of the split editor area: a header naming the file, the
 * editor itself, and the drop zones that split it.
 *
 * Dropping is driven entirely by the pane's own drag events rather than
 * shared "a drag is happening" state. The file browser marks its drags
 * with a private MIME type (see `shared/dragPayload.ts`), so a pane can
 * work out on its own whether something is over it, whether it is
 * something it can accept, and which edge — which keeps the project page
 * from having to broadcast drag state to every pane.
 *
 * Every drop is validated. A pane accepts only a drag the file browser
 * started, carrying a file rather than a directory; anything else —
 * a text selection dragged inside an editor, a file from the desktop —
 * is left alone for whoever else wants it.
 */

import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { TextEditor } from "../editor/TextEditor";
import type { EditorConfiguration } from "../editor/TextEditor/editorConfiguration";
import { hasFileDragPayload, readFileDragPayload } from "../../shared/dragPayload";
import type { DropSide, PaneId } from "./paneLayout";

/** The document a pane has open. */
export interface PaneDocument {
    readonly path: string;
    readonly initialDoc: string;
}

/** Props for {@link EditorPane}. */
export interface EditorPaneProps {
    readonly paneId: PaneId;
    /** The open document, or null for a pane with nothing in it. */
    readonly document: PaneDocument | null;
    /** True when this pane has focus and drives the toolbar. */
    readonly isActive: boolean;
    /** True when this pane's document has unsaved changes. */
    readonly isDirty: boolean;
    /** True when more than one pane is open, so closing is offered. */
    readonly canClose: boolean;
    /**
     * Settings for this pane's editor. Live, not initial-only: the
     * editor re-applies them itself, so every pane follows a theme or
     * mode change rather than only the one that happens to be focused.
     */
    readonly configuration: EditorConfiguration;
    /** Called when the user interacts with this pane. */
    readonly onActivate: (paneId: PaneId) => void;
    /**
     * Called when a file is dropped on this pane. `side` names the edge
     * to split on, or is null for a drop in the middle, which opens the
     * file in this pane instead.
     */
    readonly onDropFile: (paneId: PaneId, side: DropSide | null, path: string) => void;
    readonly onClose: (paneId: PaneId) => void;
    readonly onViewReady: (paneId: PaneId, view: EditorView) => void;
    /** Called when this pane's editor is torn down, so the parent can
     * drop the view it was handed. */
    readonly onViewDestroyed: (paneId: PaneId) => void;
    readonly onDocChanged: (paneId: PaneId) => void;
    readonly onSaveRequested: (paneId: PaneId) => void;
    readonly onDiagnosticsToggled: (visible: boolean) => void;
}

/** How much of a pane's width or height each edge zone claims. */
const EDGE_FRACTION = 0.25;

/**
 * Works out which edge of a pane the pointer is nearest.
 *
 * The middle of the pane is not an edge: dropping there replaces the
 * pane's file rather than splitting, which is what VS Code does and
 * what stops every drop from making another column.
 *
 * @param event - The drag event.
 * @param bounds - The pane's rectangle.
 * @returns The edge, or null for the middle.
 */
function edgeAt(event: ReactDragEvent<HTMLElement>, bounds: DOMRect): DropSide | null {
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;

    // Whichever edge the pointer is closest to wins, so the corners
    // resolve to something rather than to nothing.
    const distances: readonly (readonly [DropSide, number])[] = [
        ["left", x],
        ["right", 1 - x],
        ["top", y],
        ["bottom", 1 - y],
    ];

    const [side, distance] = distances.reduce((best, candidate) =>
        candidate[1] < best[1] ? candidate : best,
    );

    return distance <= EDGE_FRACTION ? side : null;
}

/**
 * Renders one editor pane.
 *
 * @param props - The pane's document, state and callbacks.
 * @returns The pane element.
 */
export function EditorPane({
    paneId,
    document: paneDocument,
    isActive,
    isDirty,
    canClose,
    configuration,
    onActivate,
    onDropFile,
    onClose,
    onViewReady,
    onViewDestroyed,
    onDocChanged,
    onSaveRequested,
    onDiagnosticsToggled,
}: EditorPaneProps) {
    const [hoverSide, setHoverSide] = useState<DropSide | "centre" | null>(null);
    const paneRef = useRef<HTMLElement | null>(null);

    // The pane's rectangle, measured once when a drag arrives rather
    // than on every `dragover`. `dragover` fires continuously while the
    // pointer is over the pane, and `getBoundingClientRect` forces
    // layout each time.
    const boundsRef = useRef<DOMRect | null>(null);

    // `dragleave` bubbles, so it fires when the pointer crosses into a
    // descendant — the header, or any of CodeMirror's DOM. Counting
    // enter/leave pairs instead of clearing on the first leave is what
    // stops the drop hint blinking as the pointer moves over the editor.
    const dragDepthRef = useRef(0);

    const handleDragEnter = useCallback((event: ReactDragEvent<HTMLElement>) => {
        if (!hasFileDragPayload(event.dataTransfer)) return;

        dragDepthRef.current += 1;
        if (dragDepthRef.current === 1) {
            boundsRef.current = paneRef.current?.getBoundingClientRect() ?? null;
        }
    }, []);

    const handleDragLeave = useCallback((event: ReactDragEvent<HTMLElement>) => {
        if (!hasFileDragPayload(event.dataTransfer)) return;

        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) {
            boundsRef.current = null;
            setHoverSide(null);
        }
    }, []);

    const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
        // Only drags the file browser started are ours to take. Without
        // this check a text selection dragged inside an editor — which
        // CodeMirror puts on `text/plain` — would be treated as a path.
        if (!hasFileDragPayload(event.dataTransfer)) return;

        const bounds = boundsRef.current;
        if (!bounds) return;

        // Without this the browser refuses the drop outright.
        event.preventDefault();

        // Opening a file in a pane leaves the file tree untouched, so
        // this is a copy, not a move. The source declares `copyMove`,
        // which is what lets both this and the browser's own move
        // targets work — an incompatible `dropEffect` resolves to
        // `"none"` and then no `drop` event fires at all.
        event.dataTransfer.dropEffect = "copy";

        setHoverSide(edgeAt(event, bounds) ?? "centre");
    }, []);

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLElement>) => {
            const bounds = boundsRef.current;
            const payload = readFileDragPayload(event.dataTransfer);

            dragDepthRef.current = 0;
            boundsRef.current = null;
            setHoverSide(null);

            if (!bounds || payload === null) return;

            // A pane shows one file; there is nothing sensible to do
            // with a directory dropped on it.
            if (payload.kind !== "file") return;

            event.preventDefault();
            // Stops the file browser's own move handler from also
            // claiming a drop that landed on the editor.
            event.stopPropagation();

            onActivate(paneId);
            // A null side means the middle, which opens the file here
            // rather than splitting.
            onDropFile(paneId, edgeAt(event, bounds), payload.path);
        },
        [onActivate, onDropFile, paneId],
    );

    const fileName = paneDocument?.path.split(/[\\/]/).pop() ?? "No file";

    return (
        <section
            ref={paneRef}
            className={`editor-pane${isActive ? " editor-pane-active" : ""}`}
            onPointerDownCapture={() => onActivate(paneId)}
            onFocusCapture={() => onActivate(paneId)}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <header className="editor-pane-header">
                <span className="editor-pane-name" title={paneDocument?.path ?? ""}>
                    {fileName}
                    {isDirty && <span className="editor-pane-dirty"> •</span>}
                </span>
                {canClose && (
                    <button
                        type="button"
                        className="editor-pane-close"
                        title="Close this pane"
                        aria-label={`Close ${fileName}`}
                        onClick={() => onClose(paneId)}
                    >
                        ✕
                    </button>
                )}
            </header>

            {paneDocument ? (
                <TextEditor
                    // Remount per file: a clean editor and a fresh undo
                    // history, matching what a newly opened file means.
                    key={paneDocument.path}
                    initialDoc={paneDocument.initialDoc}
                    configuration={configuration}
                    onDiagnosticsToggled={onDiagnosticsToggled}
                    onViewReady={(view) => {
                        onViewReady(paneId, view);
                    }}
                    onViewDestroyed={() => {
                        onViewDestroyed(paneId);
                    }}
                    onDocChanged={() => onDocChanged(paneId)}
                    onSaveRequested={() => onSaveRequested(paneId)}
                />
            ) : (
                <div className="editor-placeholder">Select a file to start editing.</div>
            )}

            {hoverSide !== null && (
                <div
                    className={`pane-drop-hint pane-drop-hint-${hoverSide}`}
                    aria-hidden="true"
                />
            )}
        </section>
    );
}
