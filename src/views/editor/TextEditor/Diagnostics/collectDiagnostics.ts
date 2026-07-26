/**
 * Pure diagnostic collection: turns editor state into the structured
 * report the diagnostic panel renders.
 *
 * Kept free of DOM and of `EditorView` so it can be unit tested against
 * a plain `EditorState`; the panel supplies the viewport separately.
 */

import type { EditorState } from "@codemirror/state";
import { viewModeFacet } from "../viewMode";
import { modalModeFacet } from "../modalMode";

/** One labelled reading in the report. */
export interface DiagnosticField {
    readonly label: string;
    readonly value: string;
}

/** A titled group of related readings. */
export interface DiagnosticSection {
    readonly title: string;
    readonly fields: readonly DiagnosticField[];
}

/** The full report, rendered top to bottom. */
export type DiagnosticReport = readonly DiagnosticSection[];

/** The document range currently rendered by the editor. */
export interface ViewportRange {
    readonly from: number;
    readonly to: number;
}

/**
 * Builds the diagnostic report for the current editor state.
 *
 * @param state - The editor state to inspect.
 * @param viewport - The rendered document range, or null when no view
 *   is attached (tests, headless state).
 * @returns The sections to display, in order.
 */
export function collectDiagnostics(
    state: EditorState,
    viewport: ViewportRange | null,
): DiagnosticReport {
    return [
        describeModes(state),
        describeDocument(state),
        describeSelection(state),
        describeViewport(state, viewport),
    ];
}

/**
 * Reports which rendering and editing modes are active — the settings
 * most likely to explain surprising preview behaviour.
 *
 * @param state - The editor state to inspect.
 * @returns The modes section.
 */
function describeModes(state: EditorState): DiagnosticSection {
    return {
        title: "Modes",
        fields: [
            { label: "View", value: state.facet(viewModeFacet) },
            { label: "Modal", value: state.facet(modalModeFacet) },
            { label: "Editable", value: formatBoolean(!state.readOnly) },
        ],
    };
}

/**
 * Reports document size, which sets the scale for every whole-document
 * scan the preview performs.
 *
 * @param state - The editor state to inspect.
 * @returns The document section.
 */
function describeDocument(state: EditorState): DiagnosticSection {
    return {
        title: "Document",
        fields: [
            { label: "Lines", value: String(state.doc.lines) },
            { label: "Characters", value: String(state.doc.length) },
        ],
    };
}

/**
 * Reports the cursor position and selection extent. The preview
 * reveals source wherever the selection lands, so this is the first
 * thing to check when a region renders (or fails to).
 *
 * @param state - The editor state to inspect.
 * @returns The selection section.
 */
function describeSelection(state: EditorState): DiagnosticSection {
    const { main, ranges } = state.selection;
    const line = state.doc.lineAt(main.head);
    const column = main.head - line.from + 1;

    const selectedCharacters = ranges.reduce(
        (total, range) => total + (range.to - range.from),
        0,
    );

    return {
        title: "Selection",
        fields: [
            { label: "Cursor", value: `line ${line.number}, col ${column}` },
            { label: "Offset", value: String(main.head) },
            { label: "Ranges", value: String(ranges.length) },
            { label: "Selected", value: `${selectedCharacters} chars` },
        ],
    };
}

/**
 * Reports how much of the document is actually rendered. The inline
 * preview layer only scans this range, so a mismatch between what is
 * visible and what is rendered shows up here first.
 *
 * @param state - The editor state to inspect.
 * @param viewport - The rendered document range, or null when headless.
 * @returns The viewport section.
 */
function describeViewport(
    state: EditorState,
    viewport: ViewportRange | null,
): DiagnosticSection {
    if (!viewport) {
        return {
            title: "Viewport",
            fields: [{ label: "Rendered", value: "no view attached" }],
        };
    }

    const firstLine = state.doc.lineAt(viewport.from).number;
    const lastLine = state.doc.lineAt(viewport.to).number;
    const renderedLines = lastLine - firstLine + 1;

    return {
        title: "Viewport",
        fields: [
            { label: "Lines", value: `${firstLine}–${lastLine}` },
            {
                label: "Rendered",
                value: `${renderedLines} of ${state.doc.lines} (${formatPercent(
                    renderedLines,
                    state.doc.lines,
                )})`,
            },
        ],
    };
}

/**
 * Formats a boolean for display.
 *
 * @param value - The flag to format.
 * @returns "yes" or "no".
 */
function formatBoolean(value: boolean): string {
    return value ? "yes" : "no";
}

/**
 * Formats a ratio as a whole percentage.
 *
 * @param part - The numerator.
 * @param total - The denominator; zero yields "0%".
 * @returns The percentage, e.g. "42%".
 */
function formatPercent(part: number, total: number): string {
    if (total === 0) return "0%";
    return `${Math.round((part / total) * 100)}%`;
}
