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
import type { DecorationSet, ViewUpdate, WidgetType } from "@codemirror/view";
import { findMathRanges } from "./findMath";
import type { MathRange } from "./findMath";
import { findEnvironments } from "./findEnvironments";
import type { EnvRange } from "./findEnvironments";
import { findInertRegions, maskChunk } from "./inertRegions";
import type { InertRegions } from "./inertRegions";
import { findFormatRanges } from "./findFormatting";
import { findListItems } from "./findListItems";
import type { ListItem } from "./findListItems";
import { findGraphicsRanges } from "./findGraphics";
import { findRefRanges } from "./findRefs";
import { findTextReplacements } from "./findTextReplacements";
import { findSections } from "./findSections";
import type { SectionRange } from "./findSections";
import { findSymbolRanges } from "./symbols";
import { parseTabular } from "./parseTabular";
import {
    GraphicsWidget,
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
 * Turns an image path as written in LaTeX into a URL the webview can
 * load, or null when it cannot be resolved.
 *
 * Injected rather than imported so the preview stays independent of
 * Tauri: the host knows where the document lives and which protocol
 * serves local files, and the preview only needs the answer. Without
 * one (plain browser, tests) images render as placeholders.
 */
export type ImageSourceResolver = (path: string) => string | null;

/** Holds the host's image resolver, if it supplied one. */
const imageResolverFacet = Facet.define<ImageSourceResolver, ImageSourceResolver | null>({
    combine: (values) => values[0] ?? null,
});

/**
 * Opens a `\url`/`\href` target outside the editor.
 *
 * Injected for the same reason as the image resolver: a desktop shell
 * and a browser open links differently, and the preview should know
 * about neither. Without one, link chips render without an open
 * affordance rather than offering something that cannot work.
 */
export type LinkOpener = (url: string) => void;

/** Holds the host's link opener, if it supplied one. */
const linkOpenerFacet = Facet.define<LinkOpener, LinkOpener | undefined>({
    combine: (values) => values[0],
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
    const { inertRegions } = state.field(documentScanField);

    // Visible ranges are expanded to whole lines so a `$...$` pair is
    // never split by a range edge; the clamp keeps expanded ranges
    // from overlapping each other.
    let lastProcessedEnd = -1;

    for (const range of view.visibleRanges) {
        const from = Math.max(state.doc.lineAt(range.from).from, lastProcessedEnd + 1);
        const to = state.doc.lineAt(range.to).to;

        if (to <= lastProcessedEnd) continue;
        lastProcessedEnd = to;

        // Only the visible chunk is masked, so nothing inside a comment
        // or a verbatim body is ever rendered and the cost tracks the
        // viewport. Widget content is still read from the real
        // document below.
        const text = maskChunk(state.doc.sliceString(from, to), from, inertRegions);
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
        const openLink = state.facet(linkOpenerFacet);
        for (const ref of refRanges) {
            if (isRevealed(state, ref.from, ref.to)) continue;

            replaces.push(
                Decoration.replace({
                    widget: new RefChipWidget(
                        ref.kind,
                        ref.keys,
                        ref.note,
                        ref.target,
                        openLink,
                    ),
                }).range(ref.from, ref.to),
            );
        }

        const graphicsRanges = findGraphicsRanges(text, from, mathRanges);
        for (const graphics of graphicsRanges) {
            if (isRevealed(state, graphics.from, graphics.to)) continue;

            const resolveImageSource = state.facet(imageResolverFacet);
            replaces.push(
                Decoration.replace({
                    widget: new GraphicsWidget(
                        graphics.path,
                        resolveImageSource?.(graphics.path) ?? null,
                    ),
                }).range(graphics.from, graphics.to),
            );
        }

        // Everything already claimed by a widget: those commands are
        // replaced wholesale, so their interiors must not be scanned
        // again. Math is excluded too — KaTeX owns its source.
        const claimedInline = [...mathRanges, ...refRanges, ...graphicsRanges];

        for (const symbol of findSymbolRanges(text, from, claimedInline)) {
            if (isRevealed(state, symbol.from, symbol.to)) continue;

            replaces.push(
                Decoration.replace({ widget: new SymbolWidget(symbol.symbol) }).range(
                    symbol.from,
                    symbol.to,
                ),
            );
        }

        for (const replacement of findTextReplacements(text, from, claimedInline)) {
            if (isRevealed(state, replacement.from, replacement.to)) continue;

            replaces.push(
                Decoration.replace({
                    widget: new SymbolWidget(replacement.text, "cm-text-replacement"),
                }).range(replacement.from, replacement.to),
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
 * Everything the block layer scans out of the document, plus the two
 * views of its text.
 *
 * The block layer renders across the whole file, so its scans are
 * whole-document by nature. What they are *not* is selection-
 * dependent: moving the cursor cannot change where the math or the
 * environments are, only which of them are revealed. Caching the scan
 * separately is what keeps a cursor move from re-running four regex
 * passes and rebuilding two full copies of the document.
 */
interface DocumentScan {
    /** The real document text; supplies the content widgets render. */
    readonly docText: string;
    /** Masked text; every scan below was run against it. */
    readonly scanText: string;
    /** Comment and verbatim regions, for the inline layer's chunks. */
    readonly inertRegions: InertRegions;
    readonly math: readonly MathRange[];
    readonly environments: readonly EnvRange[];
    readonly sections: readonly SectionRange[];
    readonly listItems: readonly ListItem[];
}

/**
 * Scans a document once, producing everything both layers need.
 *
 * @param docText - The full document text.
 * @returns The cached scan.
 */
function scanDocument(docText: string): DocumentScan {
    const inertRegions = findInertRegions(docText);
    const scanText = maskChunk(docText, 0, inertRegions);

    return {
        docText,
        scanText,
        inertRegions,
        math: findMathRanges(scanText, 0),
        environments: findEnvironments(scanText),
        sections: findSections(scanText),
        listItems: findListItems(scanText),
    };
}

/**
 * The document scan, recomputed only when the document changes.
 *
 * Exported so tests can assert that identity: a cursor move must hand
 * back the very same scan object, or the preview is rescanning the
 * whole document on every arrow key.
 */
export const documentScanField = StateField.define<DocumentScan>({
    create: (state) => scanDocument(state.doc.toString()),

    update(scan, transaction) {
        if (!transaction.docChanged) return scan;
        return scanDocument(transaction.newDoc.toString());
    },
});

/**
 * Regions already consumed by a replacing decoration.
 *
 * CodeMirror rejects overlapping replaces within one decoration set,
 * so every pass checks this before adding its own. Kept sorted so the
 * check is a binary search rather than a scan of every prior claim —
 * the passes run over the whole document, so a linear check made the
 * whole build quadratic in the number of rendered constructs.
 */
export class ClaimedRanges {
    /**
     * Disjoint and sorted. Overlapping additions are merged, which is
     * what makes the ends ascending too — and therefore what makes the
     * overlap query a single binary search instead of a walk back over
     * earlier claims that might still span the query.
     */
    private ranges: Interval[] = [];

    /**
     * Records a region as claimed, merging it with any it touches.
     *
     * @param from - Region start.
     * @param to - Region end.
     */
    add(from: number, to: number): void {
        const first = this.firstReaching(from);

        let index = first;
        let mergedFrom = from;
        let mergedTo = to;

        // Absorb every existing claim this one touches.
        while (index < this.ranges.length) {
            const range = this.ranges[index];
            if (!range || range.from > to) break;

            mergedFrom = Math.min(mergedFrom, range.from);
            mergedTo = Math.max(mergedTo, range.to);
            index += 1;
        }

        this.ranges.splice(first, index - first, { from: mergedFrom, to: mergedTo });
    }

    /**
     * Reports whether a region intersects anything already claimed.
     *
     * @param from - Region start.
     * @param to - Region end.
     * @returns True on any intersection.
     */
    overlaps(from: number, to: number): boolean {
        const candidate = this.ranges[this.firstReaching(from)];
        return candidate !== undefined && candidate.from <= to;
    }

    /**
     * Finds the first claim whose end reaches `position`.
     *
     * Relies on the claims being disjoint, so their ends ascend.
     *
     * @param position - The position to reach.
     * @returns The index of that claim, or the array length.
     */
    private firstReaching(position: number): number {
        let low = 0;
        let high = this.ranges.length;

        while (low < high) {
            const middle = (low + high) >> 1;
            if ((this.ranges[middle]?.to ?? 0) < position) low = middle + 1;
            else high = middle;
        }

        return low;
    }
}

/**
 * The block layer's output, split so replaces can also be published as
 * atomic ranges.
 */
interface BlockDecorationSets {
    /** Everything the layer renders. */
    readonly decorations: DecorationSet;
    /** The subset arrow keys should skip over. */
    readonly atomic: DecorationSet;
}

/**
 * Working state threaded through the block-layer passes.
 */
interface BlockBuild {
    readonly state: EditorState;
    readonly scan: DocumentScan;
    /** Decorations produced so far. */
    readonly decorations: Range<Decoration>[];
    /**
     * Replaces that should be atomic. Whole-line and block replaces are
     * deliberately excluded: the only way to reveal a hidden tag line is
     * to put the cursor on it, which atomic ranges would prevent.
     */
    readonly atomic: Range<Decoration>[];
    /** Regions already replaced, which later passes must not overlap. */
    readonly claimed: ClaimedRanges;
}

/**
 * Builds the whole-document block decorations: display math widgets,
 * environment boxes, headings, list markers and the collapsed preamble.
 *
 * Runs on selection changes as well as edits, since the cursor decides
 * what is revealed — but it reads the cached scan rather than
 * rescanning, so a cursor move costs decoration building alone.
 *
 * @param state - The editor state.
 * @returns The sorted block-layer decoration sets.
 */
function buildBlockDecorations(state: EditorState): BlockDecorationSets {
    const build: BlockBuild = {
        state,
        scan: state.field(documentScanField),
        decorations: [],
        atomic: [],
        claimed: new ClaimedRanges(),
    };

    collectDisplayMathDecorations(build);
    collectEnvironmentDecorations(build);
    collectHeadingDecorations(build);
    collectListItemDecorations(build);

    return {
        decorations: Decoration.set(build.decorations, true),
        atomic: Decoration.set(build.atomic, true),
    };
}

/**
 * Adds a replace decoration (widget) for each display math segment the
 * cursor is not touching.
 *
 * @param build - The block-layer working state.
 */
function collectDisplayMathDecorations(build: BlockBuild): void {
    const { state, scan } = build;

    for (const math of scan.math) {
        if (!math.display) continue;

        if (isRevealed(state, math.from, math.to)) continue;

        const source = scan.docText.slice(math.innerFrom, math.innerTo);
        const startLine = state.doc.lineAt(math.from);
        const endLine = state.doc.lineAt(math.to);

        // Math occupying whole lines becomes a block widget; math
        // embedded in a line of text stays inline (but still rendered
        // in display style).
        const coversFullLines = math.from === startLine.from && math.to === endLine.to;

        build.decorations.push(
            Decoration.replace({
                widget: new MathWidget(source, true),
                block: coversFullLines,
            }).range(math.from, math.to),
        );

        build.claimed.add(math.from, math.to);
    }
}

/**
 * Adds decorations for every environment the cursor is outside of:
 * hidden `\begin`/`\end` lines, box styling on interior lines, and
 * (for `document`) the collapsed preamble chip.
 *
 * @param build - The block-layer working state.
 */
function collectEnvironmentDecorations(build: BlockBuild): void {
    const { state, scan } = build;

    // Dedupe hidden lines: nested `\begin`s on one line would otherwise
    // produce overlapping block replaces, which CodeMirror rejects.
    const hiddenLineNumbers = new Set<number>();

    for (const env of scan.environments) {
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

        // Nested inside an environment already replaced wholesale, or
        // sharing a tag line with a display-math widget: either way an
        // overlapping replace, which CodeMirror rejects.
        if (build.claimed.overlaps(env.from, env.to)) continue;
        if (build.claimed.overlaps(beginLine.from, beginLine.to)) continue;
        if (build.claimed.overlaps(endLine.from, endLine.to)) continue;

        if (tryReplaceEnvironment(build, env)) continue;

        hideLine(build, hiddenLineNumbers, beginLine.number);
        hideLine(build, hiddenLineNumbers, endLine.number);

        boxInteriorLines(build.decorations, state, beginLine.number, endLine.number);

        if (env.name === "document") collapsePreamble(build, beginLine.from);
    }
}

/**
 * Adds heading decorations for every sectioning command: a line class
 * sizing the whole line, plus replaces hiding the `\section{` prefix
 * and closing `}` when the cursor is off the heading line.
 *
 * The line class is applied even while the heading is revealed so the
 * text keeps its size during editing (Obsidian-style).
 *
 * @param build - The block-layer working state.
 */
function collectHeadingDecorations(build: BlockBuild): void {
    const { state } = build;

    for (const section of build.scan.sections) {
        // Headings inside fully replaced regions (tables, preamble,
        // hidden tag lines, display math) must not add decorations —
        // overlapping replaces are rejected within one set.
        if (build.claimed.overlaps(section.from, section.to)) continue;

        const line = state.doc.lineAt(section.from);
        build.decorations.push(
            Decoration.line({ class: `cm-heading-${section.level}` }).range(line.from),
        );

        if (isRevealed(state, line.from, line.to)) continue;

        // Atomic: arrow keys skip the invisible `\section{` and `}`
        // instead of taking several presses to cross them. The cursor
        // can still land on the heading's text, which is what reveals
        // it, so nothing becomes unreachable.
        addReplace(build, section.from, section.contentFrom, true);
        addReplace(build, section.contentTo, section.to, true);
    }
}

/**
 * Adds a marker widget for every `\item` the cursor is not touching.
 *
 * The reveal granularity is the token only: editing the item's text
 * keeps the marker rendered, matching the env-box philosophy that
 * editing a body must not un-render its container.
 *
 * @param build - The block-layer working state.
 */
function collectListItemDecorations(build: BlockBuild): void {
    const { state } = build;

    for (const item of build.scan.listItems) {
        // Items inside fully replaced regions must not add replaces —
        // overlapping replaces are rejected within one set.
        if (build.claimed.overlaps(item.from, item.to)) continue;

        if (isRevealed(state, item.from, item.to)) continue;

        // Atomic: one arrow press crosses the marker rather than
        // stepping through the hidden `\item`. Clicking it still
        // reveals the token.
        addReplace(
            build,
            item.from,
            item.to,
            true,
            new ListMarkerWidget(item.marker),
        );
    }
}

/**
 * Environments handed to KaTeX as display math.
 *
 * Only *outer* display-math environments are listed. Inner ones
 * (`split`, `matrix`, `array`, …) are not valid on their own and
 * appear inside these, so they render as part of the whole — KaTeX
 * receives the environment tags too, which is what drives its
 * alignment and equation numbering.
 *
 * The list is exactly what KaTeX implements, verified by rendering
 * each one: `multline`, `flalign`, `eqnarray` and `displaymath` are
 * absent because KaTeX rejects them outright ("No such environment"),
 * and an error-styled widget is worse than the generic box.
 */
export const MATH_ENVIRONMENTS: ReadonlySet<string> = new Set([
    "equation",
    "equation*",
    "align",
    "align*",
    "alignat",
    "alignat*",
    "gather",
    "gather*",
    "cases",
    "dcases",
    "rcases",
    "aligned",
    "alignedat",
    "gathered",
    "split",
]);

/**
 * Builds the widget that should stand in for a whole environment, or
 * null when the environment has no special rendering and should fall
 * back to the generic box.
 *
 * @param env - The environment under consideration.
 * @param docText - The real document text.
 * @returns The widget to render, or null to use the box treatment.
 */
function buildEnvironmentWidget(env: EnvRange, docText: string): WidgetType | null {
    if (env.name === "tabular" || env.name === "tabular*") {
        const parsed = parseTabular(docText.slice(env.beginTo, env.endFrom));
        return parsed ? new TableWidget(parsed) : null;
    }

    if (MATH_ENVIRONMENTS.has(env.name)) {
        return new MathWidget(docText.slice(env.from, env.to), true);
    }

    return null;
}

/**
 * Replaces a whole environment with a rendered block widget when it
 * has one and occupies its lines cleanly.
 *
 * Falls back (returns false) when the environment has no widget, its
 * content cannot be rendered, its tag lines share content with other
 * text, or the range collides with a display-math widget — the caller
 * then applies the generic box treatment instead.
 *
 * @param build - The block-layer working state.
 * @param env - The environment under consideration.
 * @returns True when the environment was replaced by a widget.
 */
function tryReplaceEnvironment(build: BlockBuild, env: EnvRange): boolean {
    const { state, scan } = build;

    // A replaced environment is rendered wholesale, so any cursor
    // contact reveals the source (the generic box then applies while
    // editing inside).
    if (isRevealed(state, env.from, env.to)) return false;

    const beginLine = state.doc.lineAt(env.from);
    const endLine = state.doc.lineAt(env.endFrom);

    // The block replace spans whole lines; other content on the tag
    // lines would be swallowed, so bail to the box treatment.
    const tagLinesClean =
        scan.docText.slice(beginLine.from, env.from).trim() === "" &&
        scan.docText.slice(env.to, endLine.to).trim() === "";
    if (!tagLinesClean) return false;

    if (build.claimed.overlaps(beginLine.from, endLine.to)) return false;

    // Built last: the cheap rejections above avoid parsing work.
    const widget = buildEnvironmentWidget(env, scan.docText);
    if (!widget) return false;

    // Not atomic: the cursor must be able to reach the region to
    // reveal the source for editing.
    addReplace(build, beginLine.from, endLine.to, false, widget, true);

    return true;
}

/**
 * Adds a replacing decoration and records the region as claimed.
 *
 * @param build - The block-layer working state.
 * @param from - Region start.
 * @param to - Region end.
 * @param atomic - Whether arrow keys should skip the region. Never set
 *   for regions whose only reveal path is placing the cursor in them.
 * @param widget - Widget to render, or undefined to hide the region.
 * @param block - Whether the replace spans whole lines.
 */
function addReplace(
    build: BlockBuild,
    from: number,
    to: number,
    atomic: boolean,
    widget?: WidgetType,
    block = false,
): void {
    const decoration = Decoration.replace(
        widget ? { widget, block } : { block },
    ).range(from, to);

    build.decorations.push(decoration);
    if (atomic) build.atomic.push(decoration);

    build.claimed.add(from, to);
}

/**
 * Replaces a whole line with nothing (hiding it), once per line.
 *
 * @param build - The block-layer working state.
 * @param hiddenLineNumbers - Lines already hidden.
 * @param lineNumber - The 1-based line to hide.
 */
function hideLine(
    build: BlockBuild,
    hiddenLineNumbers: Set<number>,
    lineNumber: number,
): void {
    if (hiddenLineNumbers.has(lineNumber)) return;
    hiddenLineNumbers.add(lineNumber);

    const line = build.state.doc.line(lineNumber);

    // Never atomic: putting the cursor on a hidden tag line is the only
    // way to reveal it, so skipping over it would make `\begin{...}`
    // permanently uneditable by keyboard.
    addReplace(build, line.from, line.to, false, undefined, true);
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
 * @param build - The block-layer working state.
 * @param documentBeginFrom - Start position of the `\begin{document}` line.
 */
function collapsePreamble(build: BlockBuild, documentBeginFrom: number): void {
    // No preamble when \begin{document} is the first line.
    if (documentBeginFrom === 0) return;

    const preambleTo = documentBeginFrom - 1;

    if (isRevealed(build.state, 0, preambleTo)) return;

    // Not atomic: the cursor must be able to enter the preamble, which
    // is what expands it for editing.
    addReplace(build, 0, preambleTo, false, new PreambleWidget(), true);
}

/**
 * Whole-document field rendering block math, env boxes, headings, list
 * markers and the preamble chip.
 *
 * Rebuilds on selection as well as document changes, because the
 * cursor decides what is revealed — but the underlying scan is cached
 * in {@link documentScanField}, so a cursor move rebuilds decorations
 * without rescanning or re-masking the document.
 */
const blockPreviewField = StateField.define<BlockDecorationSets>({
    create: buildBlockDecorations,

    update(sets, transaction) {
        if (transaction.docChanged || transaction.selection) {
            return buildBlockDecorations(transaction.state);
        }
        return sets;
    },

    provide: (field) => [
        EditorView.decorations.from(field, (sets) => sets.decorations),
        // Block-layer replaces that arrow keys should skip. Whole-line
        // replaces are excluded — see `addReplace`.
        EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
    ],
});

/** Options for {@link livePreview}. */
export interface LivePreviewOptions {
    /**
     * Whether cursor contact reveals rendered source (default true).
     * Read-only mode passes false so everything stays rendered.
     */
    readonly reveal?: boolean;
    /**
     * Resolves `\includegraphics` paths to loadable URLs. Omitted
     * (plain browser, tests), images render as placeholders.
     */
    readonly resolveImageSource?: ImageSourceResolver;
    /**
     * Opens a `\url`/`\href` target. Omitted, link chips render
     * without an open affordance.
     */
    readonly openLink?: LinkOpener;
}

/**
 * The complete live-preview extension for the Moonstone editor.
 *
 * @param options - Rendering options (e.g. disabling cursor reveal).
 * @returns The combined inline and block preview layers.
 */
export function livePreview(options?: LivePreviewOptions): Extension {
    return [
        // Must precede the layers that read it: a StateField's `create`
        // may only access fields initialized before it.
        documentScanField,
        inlineMathPlugin,
        blockPreviewField,
        revealFacet.of(options?.reveal ?? true),
        ...(options?.resolveImageSource
            ? [imageResolverFacet.of(options.resolveImageSource)]
            : []),
        ...(options?.openLink ? [linkOpenerFacet.of(options.openLink)] : []),
    ];
}
