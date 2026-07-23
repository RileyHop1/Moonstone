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

import { EditorState, Facet, StateField } from "@codemirror/state";
import type { EditorSelection, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { findMathRanges } from "./findMath";
import { findEnvironments } from "./findEnvironments";
import { findFormatRanges } from "./findFormatting";
import { findListItems } from "./findListItems";
import { findRefRanges } from "./findRefs";
import { findSections } from "./findSections";
import { findSymbolRanges } from "./symbols";
import { parseTabular } from "./parseTabular";
import {
    ListMarkerWidget,
    MathWidget,
    PreambleWidget,
    RefChipWidget,
    SymbolWidget,
    TableWidget,
} from "./MathWidget";
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
 * Whether cursor contact reveals rendered source. Live mode provides
 * `true`; read-only mode provides `false` so everything stays rendered
 * regardless of the selection. Absent (e.g. no preview), defaults to
 * revealing.
 */
const revealFacet = Facet.define<boolean, boolean>({
    combine: (values) => values[0] ?? true,
});

/**
 * Reports whether a rendered region should reveal its source: only
 * when reveal is enabled (live mode) and the selection touches it.
 *
 * @param state - The editor state (carries the reveal facet + selection).
 * @param from - Range start.
 * @param to - Range end.
 * @returns True when the region should show as raw source.
 */
function isRevealed(state: EditorState, from: number, to: number): boolean {
    if (!state.facet(revealFacet)) return false;
    const { selection } = state;
    return selectionTouches(selection, from, to);
}

/**
 * The inline layer's decoration output, split by purpose.
 *
 * Replaces are atomic (arrow keys hop over them); content marks must
 * NOT be atomic or the cursor could never enter formatted text.
 */
interface InlineDecorationSets {
    /** Everything rendered: replaces plus content marks. */
    readonly decorations: DecorationSet;
    /** Replaces only, fed to `EditorView.atomicRanges`. */
    readonly atomic: DecorationSet;
}

/**
 * Builds the inline decorations (inline math, formatting commands,
 * and special-character symbols) for the visible ranges only.
 *
 * @param view - The editor view.
 * @returns The rendered decorations and their atomic subset.
 */
function buildInlineDecorations(view: EditorView): InlineDecorationSets {
    const replaces: Range<Decoration>[] = [];
    const marks: Range<Decoration>[] = [];
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

            if (isRevealed(state, math.from, math.to)) continue;

            const source = state.doc.sliceString(math.innerFrom, math.innerTo);
            replaces.push(
                Decoration.replace({ widget: new MathWidget(source, false) }).range(
                    math.from,
                    math.to,
                ),
            );
        }

        collectFormattingDecorations(state, text, from, mathRanges, replaces, marks);

        const refRanges = findRefRanges(text, from, mathRanges);
        for (const ref of refRanges) {
            if (isRevealed(state, ref.from, ref.to)) continue;

            replaces.push(
                Decoration.replace({ widget: new RefChipWidget(ref.kind, ref.keys) }).range(
                    ref.from,
                    ref.to,
                ),
            );
        }

        // Special characters outside math and reference chips (KaTeX
        // renders math; a chip already replaces its whole command).
        for (const symbol of findSymbolRanges(text, from, [...mathRanges, ...refRanges])) {
            if (isRevealed(state, symbol.from, symbol.to)) continue;

            replaces.push(
                Decoration.replace({ widget: new SymbolWidget(symbol.symbol) }).range(
                    symbol.from,
                    symbol.to,
                ),
            );
        }
    }

    return {
        decorations: Decoration.set([...replaces, ...marks], true),
        atomic: Decoration.set(replaces, true),
    };
}

/**
 * Adds decorations for every formatting command the cursor is not
 * touching: replaces hiding the command token and closing brace, and
 * a style mark over the content (which stays editable raw text).
 *
 * @param state - The editor state.
 * @param text - The visible chunk's text.
 * @param offset - Document position of `text[0]`.
 * @param mathRanges - Math intervals to exclude (KaTeX territory).
 * @param replaces - Output list for the hidden-token replaces.
 * @param marks - Output list for the content style marks.
 */
function collectFormattingDecorations(
    state: EditorState,
    text: string,
    offset: number,
    mathRanges: readonly Interval[],
    replaces: Range<Decoration>[],
    marks: Range<Decoration>[],
): void {
    for (const format of findFormatRanges(text, offset, mathRanges)) {
        if (isRevealed(state, format.from, format.to)) continue;

        replaces.push(Decoration.replace({}).range(format.from, format.contentFrom));
        replaces.push(Decoration.replace({}).range(format.contentTo, format.to));
        marks.push(
            Decoration.mark({ class: `cm-fmt-${format.style}` }).range(
                format.contentFrom,
                format.contentTo,
            ),
        );
    }
}

/** Viewport-limited plugin rendering inline math, formatting, and symbols. */
const inlineMathPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        atomic: DecorationSet;

        constructor(view: EditorView) {
            const sets = buildInlineDecorations(view);
            this.decorations = sets.decorations;
            this.atomic = sets.atomic;
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.selectionSet || update.viewportChanged) {
                const sets = buildInlineDecorations(update.view);
                this.decorations = sets.decorations;
                this.atomic = sets.atomic;
            }
        }
    },
    {
        decorations: (value) => value.decorations,
        provide: (plugin) =>
            // Atomic ranges make arrow keys jump over rendered widgets
            // instead of stepping through the hidden source. Only the
            // replaces are atomic — content marks stay enterable.
            EditorView.atomicRanges.of(
                (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
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
    const envInfo = collectEnvironmentDecorations(state, docText, hiddenMath, decorations);
    collectHeadingDecorations(state, docText, hiddenMath, envInfo, decorations);
    collectListItemDecorations(state, docText, hiddenMath, envInfo, decorations);

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

        if (isRevealed(state, math.from, math.to)) continue;

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

/** Replaced-region bookkeeping produced by the environment pass. */
interface EnvironmentDecorationInfo {
    /** Whole tag lines hidden behind block replaces. */
    readonly hiddenLines: readonly Interval[];
    /** Regions fully replaced by widgets (tables, the preamble chip). */
    readonly replacedEnvRanges: readonly Interval[];
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
 * @returns The replaced regions, so later passes avoid overlapping
 *   replaces (which CodeMirror rejects within one decoration set).
 */
function collectEnvironmentDecorations(
    state: EditorState,
    docText: string,
    hiddenMath: readonly Interval[],
    decorations: Range<Decoration>[],
): EnvironmentDecorationInfo {
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
            isRevealed(state, beginLine.from, beginLine.to) ||
            isRevealed(state, endLine.from, endLine.to);
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
            const preamble = collapsePreamble(decorations, state, beginLine.from);
            if (preamble) replacedEnvRanges.push(preamble);
        }
    }

    const hiddenLines = [...hiddenLineNumbers].map((lineNumber) => {
        const line = state.doc.line(lineNumber);
        return { from: line.from, to: line.to };
    });

    return { hiddenLines, replacedEnvRanges };
}

/**
 * Adds heading decorations for every sectioning command: a line class
 * sizing the whole line, plus replaces hiding the `\section{` prefix
 * and closing `}` when the cursor is off the heading line.
 *
 * The line class is applied even while the heading is revealed so the
 * text keeps its size during editing (Obsidian-style).
 *
 * @param state - The editor state.
 * @param docText - The full document text.
 * @param hiddenMath - Intervals already replaced by display math.
 * @param envInfo - Replaced regions from the environment pass.
 * @param decorations - Output list decorations are pushed into.
 */
function collectHeadingDecorations(
    state: EditorState,
    docText: string,
    hiddenMath: readonly Interval[],
    envInfo: EnvironmentDecorationInfo,
    decorations: Range<Decoration>[],
): void {
    for (const section of findSections(docText)) {
        // Headings inside fully replaced regions (tables, preamble,
        // hidden tag lines, display math) must not add decorations —
        // overlapping replaces are rejected within one set.
        if (overlapsAny(envInfo.replacedEnvRanges, section.from, section.to)) continue;
        if (overlapsAny(envInfo.hiddenLines, section.from, section.to)) continue;
        if (overlapsAny(hiddenMath, section.from, section.to)) continue;

        const line = state.doc.lineAt(section.from);
        decorations.push(
            Decoration.line({ class: `cm-heading-${section.level}` }).range(line.from),
        );

        if (isRevealed(state, line.from, line.to)) continue;

        decorations.push(Decoration.replace({}).range(section.from, section.contentFrom));
        decorations.push(Decoration.replace({}).range(section.contentTo, section.to));
    }
}

/**
 * Adds a marker widget for every `\item` the cursor is not touching.
 *
 * The reveal granularity is the token only: editing the item's text
 * keeps the marker rendered, matching the env-box philosophy that
 * editing a body must not un-render its container.
 *
 * @param state - The editor state.
 * @param docText - The full document text.
 * @param hiddenMath - Intervals already replaced by display math.
 * @param envInfo - Replaced regions from the environment pass.
 * @param decorations - Output list decorations are pushed into.
 */
function collectListItemDecorations(
    state: EditorState,
    docText: string,
    hiddenMath: readonly Interval[],
    envInfo: EnvironmentDecorationInfo,
    decorations: Range<Decoration>[],
): void {
    for (const item of findListItems(docText)) {
        // Items inside fully replaced regions must not add replaces —
        // overlapping replaces are rejected within one set.
        if (overlapsAny(envInfo.replacedEnvRanges, item.from, item.to)) continue;
        if (overlapsAny(envInfo.hiddenLines, item.from, item.to)) continue;
        if (overlapsAny(hiddenMath, item.from, item.to)) continue;

        if (isRevealed(state, item.from, item.to)) continue;

        decorations.push(
            Decoration.replace({ widget: new ListMarkerWidget(item.marker) }).range(
                item.from,
                item.to,
            ),
        );
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
    if (isRevealed(state, env.from, env.to)) return false;

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
 * @returns The replaced interval, or null when the preamble stays
 *   visible (cursor inside it, or no preamble at all).
 */
function collapsePreamble(
    decorations: Range<Decoration>[],
    state: EditorState,
    documentBeginFrom: number,
): Interval | null {
    // No preamble when \begin{document} is the first line.
    if (documentBeginFrom === 0) return null;

    const preambleTo = documentBeginFrom - 1;

    if (isRevealed(state, 0, preambleTo)) return null;

    decorations.push(
        Decoration.replace({ widget: new PreambleWidget(), block: true }).range(0, preambleTo),
    );

    return { from: 0, to: preambleTo };
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

/** Options for {@link livePreview}. */
export interface LivePreviewOptions {
    /**
     * Whether cursor contact reveals rendered source (default true).
     * Read-only mode passes false so everything stays rendered.
     */
    readonly reveal?: boolean;
}

/**
 * The complete live-preview extension for the Moonstone editor.
 *
 * @param options - Rendering options (e.g. disabling cursor reveal).
 * @returns The combined inline and block preview layers.
 */
export function livePreview(options?: LivePreviewOptions): Extension {
    return [inlineMathPlugin, blockPreviewField, revealFacet.of(options?.reveal ?? true)];
}
