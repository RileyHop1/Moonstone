/**
 * One pane of the split editor area: a header naming the file, the
 * editor itself, and the drop zones that split it.
 *
 * Dropping is driven entirely by the pane's own drag events rather than
 * shared "a drag is happening" state. The file browser already puts the
 * dragged path on the `dataTransfer`, so a pane can work out on its own
 * whether something is over it and which edge — which keeps the project
 * page from having to broadcast drag state to every pane.
 */

import { useCallback, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { TextEditor } from "../editor/TextEditor";
import type { ImageSourceResolver, LinkOpener } from "../editor/TextEditor/LivePreview";
import type { LineNumberMode, ModalMode, Reference, Theme, ViewMode } from "../../shared/types";
import type { DropSide, PaneId } from "./paneLayout";

/** The document a pane has open. */
export interface PaneDocument {
    readonly path: string;
    readonly initialDoc: string;
}

/** Editor configuration shared by every pane. */
export interface PaneEditorSettings {
    readonly viewMode: ViewMode;
    readonly modalMode: ModalMode;
    readonly spellCheckEnabled: boolean;
    readonly theme: Theme;
    readonly lineNumberMode: LineNumberMode;
    readonly showDiagnostics: boolean;
    readonly references: readonly Reference[];
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
    readonly settings: PaneEditorSettings;
    readonly resolveImageSource?: ImageSourceResolver;
    readonly openLink?: LinkOpener;
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
    settings,
    resolveImageSource,
    openLink,
    onActivate,
    onDropFile,
    onClose,
    onViewReady,
    onDocChanged,
    onSaveRequested,
    onDiagnosticsToggled,
}: EditorPaneProps) {
    const [hoverSide, setHoverSide] = useState<DropSide | "centre" | null>(null);
    const paneRef = useRef<HTMLElement | null>(null);

    const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
        const bounds = paneRef.current?.getBoundingClientRect();
        if (!bounds) return;

        // Without this the browser refuses the drop outright.
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";

        setHoverSide(edgeAt(event, bounds) ?? "centre");
    }, []);

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLElement>) => {
            const bounds = paneRef.current?.getBoundingClientRect();
            const path = event.dataTransfer.getData("text/plain");
            setHoverSide(null);

            if (!bounds || path === "") return;
            event.preventDefault();
            // Stops the file browser's own move handler from also
            // claiming a drop that landed on the editor.
            event.stopPropagation();

            onActivate(paneId);
            // A null side means the middle, which opens the file here
            // rather than splitting.
            onDropFile(paneId, edgeAt(event, bounds), path);
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
            onDragOver={handleDragOver}
            onDragLeave={() => setHoverSide(null)}
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
                    initialViewMode={settings.viewMode}
                    initialModalMode={settings.modalMode}
                    initialSpellCheckEnabled={settings.spellCheckEnabled}
                    initialTheme={settings.theme}
                    initialLineNumberMode={settings.lineNumberMode}
                    initialShowDiagnostics={settings.showDiagnostics}
                    onDiagnosticsToggled={onDiagnosticsToggled}
                    initialReferences={settings.references}
                    resolveImageSource={resolveImageSource}
                    openLink={openLink}
                    onViewReady={(view) => onViewReady(paneId, view)}
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
