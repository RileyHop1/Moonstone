/**
 * Editor toolbar: save/undo/redo, LaTeX snippet insertion, and exit.
 */

import type {
    EditorCommands,
    ProjectActions,
    SnippetName,
    ViewModeControl,
} from "../../../shared/appActions";
import type { ViewMode } from "../../../shared/types";
import "./Toolbar.css";

/** A transient toolbar status: confirmation (info) or failure (error). */
export interface StatusMessage {
    readonly kind: "info" | "error";
    readonly text: string;
}

/** Props for {@link Toolbar}. */
export interface ToolbarProps {
    /** True when the open file has unsaved changes. */
    readonly isDirty: boolean;
    /** True when the active pane has any file open, PDFs included. */
    readonly hasOpenFile: boolean;
    /** True when the active pane holds editable text rather than a PDF. */
    readonly canEditFile: boolean;
    /** True while a compile is running, so it cannot be started twice. */
    readonly isCompiling: boolean;
    /**
     * The editor actions the buttons delegate to.
     *
     * The view mode is read from `actions` rather than taken as its own
     * prop: it used to be both, which is two sources of truth for one
     * value and nothing keeping them in step.
     */
    readonly actions: EditorCommands & ViewModeControl & ProjectActions;
    /** Status shown at the right edge (e.g. "Saved ✓" or errors). */
    readonly statusMessage: StatusMessage | null;
}

/** One segment of the view-mode control: its label, tooltip, and mode. */
interface ViewModeSegment {
    readonly label: string;
    readonly title: string;
    readonly mode: ViewMode;
}

/** The view-mode segments, in display order. */
const VIEW_MODE_SEGMENTS: readonly ViewModeSegment[] = [
    { label: "Src", title: "Source — raw LaTeX", mode: "source" },
    { label: "Live", title: "Live preview", mode: "live" },
    { label: "Read", title: "Read only — fully rendered", mode: "readonly" },
];

/** One snippet button's label, tooltip, and snippet name. */
interface SnippetButton {
    readonly label: string;
    readonly title: string;
    readonly name: SnippetName;
}

/** The snippet buttons shown in the toolbar, in display order. */
const SNIPPET_BUTTONS: readonly SnippetButton[] = [
    { label: "$x$", title: "Inline math", name: "inlineMath" },
    { label: "$$", title: "Block math", name: "blockMath" },
    { label: "⊞", title: "Table", name: "table" },
    { label: "α", title: "Alpha", name: "alpha" },
    { label: "β", title: "Beta", name: "beta" },
    { label: "∑", title: "Sum", name: "sum" },
    { label: "∫", title: "Integral", name: "integral" },
    { label: "⁄", title: "Fraction", name: "fraction" },
    { label: "√", title: "Square root", name: "squareRoot" },
    { label: "📄", title: "Document template", name: "template" },
];

/**
 * Renders the toolbar row above the editor.
 *
 * @param props - Editor state and actions.
 * @returns The toolbar element.
 */
export function Toolbar({
    isDirty,
    hasOpenFile,
    canEditFile,
    isCompiling,
    actions,
    statusMessage,
}: ToolbarProps) {
    // Read-only mode is non-editable, so snippet insertion is disabled.
    const canEdit = canEditFile && actions.viewMode !== "readonly";

    return (
        <div className="editor-toolbar">
            <button
                type="button"
                className="toolbar-button"
                disabled={!canEditFile || !isDirty}
                title="Save (Ctrl+S)"
                onClick={actions.save}
            >
                Save
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={!canEditFile}
                title="Undo (Ctrl+Z)"
                onClick={actions.undo}
            >
                Undo
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={!canEditFile}
                title="Redo (Ctrl+Y)"
                onClick={actions.redo}
            >
                Redo
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={!canEditFile}
                title="Find & Replace (Ctrl+F)"
                onClick={actions.findReplace}
            >
                🔍
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={isCompiling}
                title="Compile the main document to PDF"
                onClick={actions.compile}
            >
                {isCompiling ? "Compiling…" : "Compile"}
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={!canEditFile}
                title="Show this line in the PDF (Ctrl+Alt+J)"
                onClick={actions.showInPdf}
            >
                Show in PDF
            </button>
            <button
                type="button"
                className="toolbar-button"
                disabled={!hasOpenFile || isCompiling}
                title="Save a copy of the compiled PDF somewhere else"
                onClick={actions.exportPdf}
            >
                Export PDF…
            </button>

            <span className="toolbar-separator" />

            <div className="toolbar-segment" role="group" aria-label="View mode">
                {VIEW_MODE_SEGMENTS.map((segment) => (
                    <button
                        key={segment.mode}
                        type="button"
                        className={`toolbar-segment-button${actions.viewMode === segment.mode ? " toolbar-segment-active" : ""}`}
                        disabled={!canEditFile}
                        title={segment.title}
                        onClick={() => actions.setViewMode(segment.mode)}
                    >
                        {segment.label}
                    </button>
                ))}
            </div>

            <span className="toolbar-separator" />

            {SNIPPET_BUTTONS.map((snippet) => (
                <button
                    key={snippet.name}
                    type="button"
                    className="toolbar-button toolbar-button-snippet"
                    disabled={!canEdit}
                    title={snippet.title}
                    onClick={() => actions.insertSnippet(snippet.name)}
                >
                    {snippet.label}
                </button>
            ))}

            <span className="toolbar-spacer" />

            {statusMessage && (
                <span className={`toolbar-status toolbar-status-${statusMessage.kind}`}>
                    {statusMessage.text}
                </span>
            )}

            <button
                type="button"
                className="toolbar-button"
                title="Close this project"
                onClick={actions.exitProject}
            >
                Exit
            </button>
        </div>
    );
}
