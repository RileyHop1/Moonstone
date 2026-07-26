/**
 * Absolute, relative and mixed line numbering.
 *
 * The numbers themselves come from `basicSetup`'s line-number gutter.
 * Rather than replace that gutter, this supplies **markers** through
 * the `lineNumberMarkers` facet, which the gutter renders in place of
 * the plain numbers. That matters for more than tidiness: the facet is
 * computed from the state, so the gutter re-renders as the cursor
 * moves. Overriding `formatNumber` instead would look correct on the
 * first paint and then never update, because the built-in gutter only
 * re-renders when its *config* changes, not on selection.
 */

import { Compartment, RangeSet } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { GutterMarker, lineNumberMarkers } from "@codemirror/view";
import type { LineNumberMode, ModalMode } from "../../../../shared/types";
import { formatLineNumber, usesRelativeNumbers } from "./formatLineNumber";
import { insertModeField, insertModeTracker } from "./insertMode";

/** Compartment holding the current numbering, swapped at runtime. */
export const lineNumbersCompartment = new Compartment();

/** Plain absolute numbers, as most editors show. */
export const DEFAULT_LINE_NUMBER_MODE: LineNumberMode = "absolute";

/** One line's number as the gutter should render it. */
class LineNumberMarker extends GutterMarker {
    /**
     * @param text - The number to display.
     */
    constructor(readonly text: string) {
        super();
    }

    /**
     * Compares markers so unchanged lines are not re-rendered.
     *
     * @param other - The marker being compared against.
     * @returns True when both show the same text.
     */
    override eq(other: LineNumberMarker): boolean {
        return other.text === this.text;
    }

    /**
     * @returns The gutter content for this line.
     */
    override toDOM(): Text {
        return document.createTextNode(this.text);
    }
}

/**
 * Builds the marker set for a document.
 *
 * @param state - The editor state to number.
 * @param mode - The configured numbering mode.
 * @returns A marker per line, or an empty set when the built-in
 *   absolute numbers are already correct.
 */
function buildMarkers(state: EditorState, mode: LineNumberMode): RangeSet<GutterMarker> {
    // Absolute numbering is what the gutter does unaided, so it needs
    // no markers at all — and costs nothing per keystroke.
    if (!usesRelativeNumbers(mode, state.field(insertModeField, false) ?? true)) {
        return RangeSet.empty;
    }

    const cursorLine = state.doc.lineAt(state.selection.main.head).number;
    const markers = [];

    for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
        const line = state.doc.line(lineNumber);
        const text = formatLineNumber(lineNumber, cursorLine, mode, false);

        markers.push(new LineNumberMarker(text).range(line.from));
    }

    return RangeSet.of(markers);
}

/**
 * Builds the line-numbering extension for a mode.
 *
 * @param mode - The configured numbering mode.
 * @param modalMode - Which modal system is active, which decides what
 *   "insert mode" means for `mixed`.
 * @returns The extension to place in {@link lineNumbersCompartment}.
 */
export function lineNumbersExtensionForMode(
    mode: LineNumberMode,
    modalMode: ModalMode,
): Extension {
    // Counting from the cursor is for jumping — `5j`, `d3k` — so it
    // only earns its place under modal editing. Without it the stored
    // preference is ignored rather than cleared, so turning Vim or
    // Helix back on restores the numbering the user chose.
    if (modalMode === "none") return [];

    // Absolute numbering is the gutter's own behaviour: no markers, no
    // mode tracking, nothing recomputed as the cursor moves.
    if (mode === "absolute") return [];

    return [
        insertModeTracker(modalMode),
        lineNumberMarkers.compute(["doc", "selection", insertModeField], (state) =>
            buildMarkers(state, mode),
        ),
    ];
}
