/**
 * Obsidian-style live preview for LaTeX, assembled from two layers.
 *
 * Layer 1 (ViewPlugin, viewport-limited): inline `$...$` math. This is
 * where per-keystroke KaTeX cost lives, bounded to visible ranges.
 *
 * Layer 2 (StateField, whole document): display `$$...$$` math,
 * environment boxes, and preamble hiding. Block-level replacing
 * decorations MUST come from a StateField in CodeMirror — they affect
 * vertical layout, which a ViewPlugin is not allowed to do. Scanning
 * the whole document is a cheap regex pass, and widget `toDOM` is only
 * invoked for the rendered viewport anyway, so KaTeX work stays lazy.
 *
 * Both layers follow the same reveal rule: when any selection range
 * touches a rendered region, that region's decorations are skipped so
 * the raw source shows — clicking a widget places the cursor inside
 * it, which reveals it on the next update.
 */

import { EditorState, StateField } from "@codemirror/state";
import type { EditorSelection, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { findMathRanges } from "./findMath";
import { findEnvironments } from "./findEnvironments";
import { findSymbolRanges } from "./symbols";
import { parseTabular } from "./parseTabular";
import { MathWidget, PreambleWidget, SymbolWidget, TableWidget } from "./MathWidget";
import "katex/dist/katex.min.css";
import "./livePreview.css";

/**
 * Reports whether any selection range touches `[from, to]`.
 *
 * @param selection - The editor selection.
 * @param from - Range start.
 * @param to - Range end.
 * @returns True when the region should be revealed as source.
 */
function selectionTouches(selection: EditorSelection, from: number, to: number): boolean {
    return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Builds the inline decorations (inline math + special-character
 * symbols) for the visible ranges only.
 *
 * @param view - The editor view.
 * @returns Replace decorations for every rendered inline segment.
 */
function buildInlineDecorations(view: EditorView): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const { state } = view;

    // Visible ranges are expanded to whole lines so a `$...$` pair is
    // never split by a range edge; the clamp keeps expanded ranges
    // from overlapping each other.
    let lastProcessedEnd = -1;

    for (const range of view.visibleRanges) {
        const from = Math.max(state.doc.lineAt(range.from).from, lastProcessedEnd + 1);
        const to = state.doc.lineAt(range.to).to;

        if (to <= lastProcessedEnd) continue;
        lastProcessedEnd = to;

        const text = state.doc.sliceString(from, to);
        const mathRanges = findMathRanges(text, from);

        for (const math of mathRanges) {
            // Display math is the block layer's responsibility.
            if (math.display) continue;

            if (selectionTouches(state.selection, math.from, math.to)) continue;

            const source = state.doc.sliceString(math.innerFrom, math.innerTo);
            decorations.push(
                Decoration.replace({ widget: new MathWidget(source, false) }).range(
                    math.from,
                    math.to,
                ),
            );
        }

        // Special characters outside math (KaTeX renders those itself).
        for (const symbol of findSymbolRanges(text, from, mathRanges)) {
            if (selectionTouches(state.selection, symbol.from, symbol.to)) continue;

            decorations.push(
                Decoration.replace({ widget: new SymbolWidget(symbol.symbol) }).range(
                    symbol.from,
                    symbol.to,
                ),
            );
        }
    }

    return Decoration.set(decorations, true);
}

/** Viewport-limited plugin rendering inline math. */
const inlineMathPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildInlineDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
                this.decorations = buildInlineDecorations(update.view);
            }
        }
    },
    {
        decorations: (value) => value.decorations,
        provide: (plugin) =>
            // Atomic ranges make arrow keys jump over rendered math
            // instead of stepping through the hidden source.
            EditorView.atomicRanges.of(
                (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
            ),
    },
);

/** A half-open interval used for overlap bookkeeping. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Reports whether `[from, to]` intersects any interval in `intervals`.
 *
 * @param intervals - The intervals to test against.
 * @param from - Range start.
 * @param to - Range end.
 * @returns True on any intersection.
 */
function overlapsAny(intervals: readonly Interval[], from: number, to: number): boolean {
    return intervals.some((interval) => interval.from <= to && interval.to >= from);
}

/**
 * Builds the whole-document block decorations: display math widgets,
 * environment boxes, and the collapsed preamble.
 *
 * @param state - The editor state.
 * @returns The sorted block-layer decoration set.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
    const docText = state.doc.toString();
    const decorations: Range<Decoration>[] = [];

    const hiddenMath = collectDisplayMathDecorations(state, docText, decorations);
    collectEnvironmentDecorations(state, docText, hiddenMath, decorations);

    return Decoration.set(decorations, true);
}

/**
 * Adds a replace decoration (widget) for each display math segment the
 * cursor is not touching.
 *
 * @param state - The editor state.
 * @param docText - The full document text.
 * @param decorations - Output list decorations are pushed into.
 * @returns The intervals that were replaced, for overlap avoidance.
 */
function collectDisplayMathDecorations(
    state: EditorState,
    docText: string,
    decorations: Range<Decoration>[],
): readonly Interval[] {
    const hidden: Interval[] = [];

    for (const math of findMathRanges(docText, 0)) {
        if (!math.display) continue;

        if (selectionTouches(state.selection, math.from, math.to)) continue;

        const source = docText.slice(math.innerFrom, math.innerTo);
        const startLine = state.doc.lineAt(math.from);
        const endLine = state.doc.lineAt(math.to);

        // Math occupying whole lines becomes a block widget; math
        // embedded in a line of text stays inline (but still rendered
        // in display style).
        const coversFullLines = math.from === startLine.from && math.to === endLine.to;

        decorations.push(
            Decoration.replace({
                widget: new MathWidget(source, true),
                block: coversFullLines,
            }).range(math.from, math.to),
        );

        hidden.push({ from: math.from, to: math.to });
    }

    return hidden;
}

/**
 * Adds decorations for every environment the cursor is outside of:
 * hidden `\begin`/`\end` lines, box styling on interior lines, and
 * (for `document`) the collapsed preamble chip.
 *
 * @param state - The editor state.
 * @param docText - The full document text.
 * @param hiddenMath - Intervals already replaced by display math.
 * @param decorations - Output list decorations are pushed into.
 */
function collectEnvironmentDecorations(
    state: EditorState,
    docText: string,
    hiddenMath: readonly Interval[],
    decorations: Range<Decoration>[],
): void {
    // Dedupe hidden lines: nested `\begin`s on one line would otherwise
    // produce overlapping block replaces, which CodeMirror rejects.
    const hiddenLineNumbers = new Set<number>();

    // Environments fully replaced by a widget (tables); anything
    // nested inside them must not add decorations of its own.
    const replacedEnvRanges: Interval[] = [];

    for (const env of findEnvironments(docText)) {
        const beginLine = state.doc.lineAt(env.from);
        const endLine = state.doc.lineAt(env.endFrom);

        // Single-line environments stay as plain source.
        if (endLine.number <= beginLine.number) continue;

        // Reveal the tags only when the cursor touches the hidden tag
        // lines themselves — the cursor is usually *inside* the
        // environment (especially `document`), and editing the body
        // must not un-box it.
        const tagsRevealed =
            selectionTouches(state.selection, beginLine.from, beginLine.to) ||
            selectionTouches(state.selection, endLine.from, endLine.to);
        if (tagsRevealed) continue;

        if (overlapsAny(replacedEnvRanges, env.from, env.to)) continue;

        // Skip environments whose tag lines are already consumed by a
        // display-math widget — overlapping replaces are not allowed
        // within one decoration set.
        const tagsCollide =
            overlapsAny(hiddenMath, beginLine.from, beginLine.to) ||
            overlapsAny(hiddenMath, endLine.from, endLine.to);
        if (tagsCollide) continue;

        if (tryReplaceTabular(decorations, state, docText, env, hiddenMath, replacedEnvRanges)) {
            continue;
        }

        hideLine(decorations, hiddenLineNumbers, beginLine.number, state);
        hideLine(decorations, hiddenLineNumbers, endLine.number, state);

        boxInteriorLines(decorations, state, beginLine.number, endLine.number);

        if (env.name === "document") {
            collapsePreamble(decorations, state, beginLine.from);
        }
    }
}

/**
 * Replaces a `tabular` environment with a rendered table widget when
 * possible.
 *
 * Falls back (returns false) when the environment is not a tabular,
 * its content cannot be parsed, its tag lines share content with
 * other text, or the range collides with a display-math widget — the
 * caller then applies the generic box treatment instead.
 *
 * @param decorations - Output list decorations are pushed into.
 * @param state - The editor state.
 * @param docText - The full document text.
 * @param env - The environment under consideration.
 * @param hiddenMath - Intervals already replaced by display math.
 * @param replacedEnvRanges - Output list of fully replaced env ranges.
 * @returns True when the environment was replaced by a table.
 */
function tryReplaceTabular(
    decorations: Range<Decoration>[],
    state: EditorState,
    docText: string,
    env: { readonly name: string; readonly from: number; readonly to: number; readonly beginTo: number; readonly endFrom: number },
    hiddenMath: readonly Interval[],
    replacedEnvRanges: Interval[],
): boolean {
    if (env.name !== "tabular" && env.name !== "tabular*") return false;

    // A table is replaced wholesale, so any cursor contact reveals the
    // source (the generic box then applies while editing inside).
    if (selectionTouches(state.selection, env.from, env.to)) return false;

    const parsed = parseTabular(docText.slice(env.beginTo, env.endFrom));
    if (!parsed) return false;

    const beginLine = state.doc.lineAt(env.from);
    const endLine = state.doc.lineAt(env.endFrom);

    // The block replace spans whole lines; other content on the tag
    // lines would be swallowed, so bail to the box treatment.
    const tagLinesClean =
        docText.slice(beginLine.from, env.from).trim() === "" &&
        docText.slice(env.to, endLine.to).trim() === "";
    if (!tagLinesClean) return false;

    if (overlapsAny(hiddenMath, beginLine.from, endLine.to)) return false;

    decorations.push(
        Decoration.replace({ widget: new TableWidget(parsed), block: true }).range(
            beginLine.from,
            endLine.to,
        ),
    );
    replacedEnvRanges.push({ from: beginLine.from, to: endLine.to });

    return true;
}

/**
 * Replaces a whole line with nothing (hiding it), once per line.
 *
 * @param decorations - Output list decorations are pushed into.
 * @param hiddenLineNumbers - Lines already hidden.
 * @param lineNumber - The 1-based line to hide.
 * @param state - The editor state.
 */
function hideLine(
    decorations: Range<Decoration>[],
    hiddenLineNumbers: Set<number>,
    lineNumber: number,
    state: EditorState,
): void {
    if (hiddenLineNumbers.has(lineNumber)) return;
    hiddenLineNumbers.add(lineNumber);

    const line = state.doc.line(lineNumber);
    decorations.push(Decoration.replace({ block: true }).range(line.from, line.to));
}

/**
 * Applies box styling to the lines between an environment's tags.
 * Contiguous line decorations visually form one rounded box via CSS.
 *
 * @param decorations - Output list decorations are pushed into.
 * @param state - The editor state.
 * @param beginLineNumber - Line of the `\begin` tag.
 * @param endLineNumber - Line of the `\end` tag.
 */
function boxInteriorLines(
    decorations: Range<Decoration>[],
    state: EditorState,
    beginLineNumber: number,
    endLineNumber: number,
): void {
    for (let lineNumber = beginLineNumber + 1; lineNumber < endLineNumber; lineNumber++) {
        const line = state.doc.line(lineNumber);

        let className = "cm-env-line";
        if (lineNumber === beginLineNumber + 1) className += " cm-env-first";
        if (lineNumber === endLineNumber - 1) className += " cm-env-last";

        decorations.push(Decoration.line({ class: className }).range(line.from));
    }
}

/**
 * Collapses everything above `\begin{document}` behind a preamble
 * chip, unless the cursor is inside the preamble.
 *
 * @param decorations - Output list decorations are pushed into.
 * @param state - The editor state.
 * @param documentBeginFrom - Start position of the `\begin{document}` line.
 */
function collapsePreamble(
    decorations: Range<Decoration>[],
    state: EditorState,
    documentBeginFrom: number,
): void {
    // No preamble when \begin{document} is the first line.
    if (documentBeginFrom === 0) return;

    const preambleTo = documentBeginFrom - 1;

    if (selectionTouches(state.selection, 0, preambleTo)) return;

    decorations.push(
        Decoration.replace({ widget: new PreambleWidget(), block: true }).range(0, preambleTo),
    );
}

/** Whole-document field rendering block math, env boxes, and preamble. */
const blockPreviewField = StateField.define<DecorationSet>({
    create: buildBlockDecorations,

    update(decorations, transaction) {
        if (transaction.docChanged || transaction.selection) {
            return buildBlockDecorations(transaction.state);
        }
        return decorations;
    },

    provide: (field) => EditorView.decorations.from(field),
});

/**
 * The complete live-preview extension for the Moonstone editor.
 *
 * @returns The combined inline and block preview layers.
 */
export function livePreview(): Extension {
    return [inlineMathPlugin, blockPreviewField];
}
