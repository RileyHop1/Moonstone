/**
 * CodeMirror widgets used by the live preview: rendered math and the
 * collapsed-preamble chip.
 */

import { WidgetType } from "@codemirror/view";
import katex from "katex";
import { findMathRanges } from "./findMath";
import type { MathRange } from "./findMath";
import { findFormatRanges } from "./findFormatting";
import type { FormatRange } from "./findFormatting";
import { findSymbolRanges } from "./symbols";
import { applyTextReplacements, findTextReplacements } from "./findTextReplacements";
import { findRefRanges } from "./findRefs";
import type { RefKind } from "./findRefs";
import type { TabularRows } from "./parseTabular";
import type { MacroTable } from "./findMacros";

/**
 * Replaces a math source range with its KaTeX rendering. Invalid
 * LaTeX falls back to the raw source in an error style instead of
 * crashing the editor.
 */
export class MathWidget extends WidgetType {
    /**
     * @param latex - The LaTeX source between the delimiters.
     * @param display - True renders display (block) math.
     * @param macros - Macros the document defines; without them, a
     *   command like `\dmodel` renders as red error text.
     * @param macroKey - Stable identity for `macros`, so {@link eq} can
     *   tell tables apart without walking them.
     */
    constructor(
        private readonly latex: string,
        private readonly display: boolean,
        private readonly macros: MacroTable = {},
        private readonly macroKey = "",
    ) {
        super();
    }

    /**
     * Compares widgets so unchanged math is not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both would render identically.
     */
    override eq(other: MathWidget): boolean {
        return (
            other.latex === this.latex &&
            other.display === this.display &&
            // Editing a macro's definition changes what its uses
            // render as, so identical source is not enough.
            other.macroKey === this.macroKey
        );
    }

    /**
     * Renders the math into a DOM element.
     *
     * @returns The rendered element (or an error fallback).
     */
    override toDOM(): HTMLElement {
        const container = document.createElement(this.display ? "div" : "span");
        container.className = this.display ? "cm-math-block" : "cm-inline-math";

        try {
            katex.render(this.latex, container, {
                displayMode: this.display,
                throwOnError: false,
                // A copy, because KaTeX writes into this object when
                // the source uses `\gdef` — sharing it would let one
                // expression's definitions leak into every other.
                macros: { ...this.macros },
            });
        } catch {
            // KaTeX only throws for internal errors with throwOnError
            // off; show the raw source rather than losing content.
            container.className = "cm-math-error";
            container.textContent = this.latex;
        }

        return container;
    }

    /**
     * Lets clicks through to the editor so clicking rendered math
     * places the cursor inside it and reveals the source.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Inline widget rendering a special character (`\alpha` → α).
 */
export class SymbolWidget extends WidgetType {
    /**
     * @param symbol - The unicode glyph to display.
     * @param className - Style hook; text-mode replacements use their
     *   own so escapes and dashes can be styled apart from symbols.
     */
    constructor(
        private readonly symbol: string,
        private readonly className: string = "cm-symbol",
    ) {
        super();
    }

    /**
     * Compares widgets so unchanged symbols are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same glyph.
     */
    override eq(other: SymbolWidget): boolean {
        return other.symbol === this.symbol && other.className === this.className;
    }

    /**
     * Renders the glyph.
     *
     * @returns The glyph element.
     */
    override toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.className = this.className;
        span.textContent = this.symbol;
        return span;
    }

    /**
     * Lets clicks through so clicking the glyph reveals the command.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Block widget rendering a parsed `tabular` environment as an HTML
 * table. Cell contents containing `$...$` math render with KaTeX.
 */
export class TableWidget extends WidgetType {
    /**
     * @param rows - The parsed cell grid.
     */
    constructor(private readonly rows: TabularRows) {
        super();
    }

    /**
     * Compares widgets so unchanged tables are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same grid.
     */
    override eq(other: TableWidget): boolean {
        return JSON.stringify(other.rows) === JSON.stringify(this.rows);
    }

    /**
     * Renders the table.
     *
     * @returns The table wrapper element.
     */
    override toDOM(): HTMLElement {
        const wrapper = document.createElement("div");
        wrapper.className = "cm-table-widget";

        const table = document.createElement("table");

        for (const row of this.rows) {
            const tableRow = document.createElement("tr");

            for (const cell of row) {
                const tableCell = document.createElement("td");
                if (cell.span > 1) tableCell.colSpan = cell.span;
                if (cell.rowSpan > 1) tableCell.rowSpan = cell.rowSpan;
                if (cell.align !== null) tableCell.style.textAlign = cell.align;
                renderCellContents(tableCell, cell.source);
                tableRow.appendChild(tableCell);
            }

            table.appendChild(tableRow);
        }

        wrapper.appendChild(table);
        return wrapper;
    }

    /**
     * Lets clicks through so clicking the table reveals the source.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Fills a table cell, rendering the same constructs the editor would
 * render outside a table: `$...$` math, formatting commands, symbols
 * and text-mode spellings.
 *
 * Cells are rendered wholesale rather than decorated, so this cannot
 * reuse the decoration pipeline — but it reuses the same scanners, so
 * a cell shows what its content means everywhere else.
 *
 * @param cell - The td element to fill.
 * @param source - The cell's LaTeX source.
 */
function renderCellContents(cell: HTMLElement, source: string): void {
    const mathRanges = findMathRanges(source, 0);
    const refRanges = findRefRanges(source, 0, mathRanges);
    const formatRanges = findFormatRanges(source, 0, [...mathRanges, ...refRanges]);
    const claimed = [...mathRanges, ...refRanges, ...formatRanges];
    const symbolRanges = findSymbolRanges(source, 0, claimed);
    const textRanges = findTextReplacements(source, 0, claimed);

    const pieces = [
        ...mathRanges.map((range) => ({ range, render: () => renderMath(source, range) })),
        // Chips render inside a cell exactly as they do outside one —
        // a citation in a table is still a citation. No opener is
        // passed: a link inside a rendered table is not clickable, and
        // offering an affordance that does nothing would be worse.
        ...refRanges.map((range) => ({
            range,
            render: () =>
                new RefChipWidget(range.kind, range.keys, range.note, range.target).toDOM(),
        })),
        ...formatRanges.map((range) => ({
            range,
            render: () => renderFormatted(source, range),
        })),
        ...symbolRanges.map((range) => ({ range, render: () => textNode(range.symbol) })),
        ...textRanges.map((range) => ({ range, render: () => textNode(range.text) })),
    ].sort((left, right) => left.range.from - right.range.from);

    let position = 0;

    for (const piece of pieces) {
        // Scanners can still overlap each other; first match wins.
        if (piece.range.from < position) continue;

        if (piece.range.from > position) {
            cell.appendChild(document.createTextNode(source.slice(position, piece.range.from)));
        }

        cell.appendChild(piece.render());
        position = piece.range.to;
    }

    if (position < source.length) {
        cell.appendChild(document.createTextNode(source.slice(position)));
    }
}

/**
 * Wraps text in a span so every rendered piece is an element.
 *
 * @param text - The text to wrap.
 * @returns The span.
 */
function textNode(text: string): HTMLElement {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
}

/**
 * Renders one math segment of a cell.
 *
 * @param source - The cell's source.
 * @param range - The math segment.
 * @returns The rendered element.
 */
function renderMath(source: string, range: MathRange): HTMLElement {
    const span = document.createElement("span");

    try {
        katex.render(source.slice(range.innerFrom, range.innerTo), span, {
            displayMode: false,
            throwOnError: false,
        });
    } catch {
        span.textContent = source.slice(range.from, range.to);
    }

    return span;
}

/**
 * Renders one formatting command of a cell, hiding its tokens.
 *
 * @param source - The cell's source.
 * @param range - The formatting command.
 * @returns The styled element.
 */
function renderFormatted(source: string, range: FormatRange): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-fmt-${range.style}`;
    span.textContent = source.slice(range.contentFrom, range.contentTo);
    return span;
}

/**
 * Inline widget rendering a list-item marker (`\item` → `•` or `1.`).
 */
export class ListMarkerWidget extends WidgetType {
    /**
     * @param marker - The rendered marker text.
     */
    constructor(private readonly marker: string) {
        super();
    }

    /**
     * Compares widgets so unchanged markers are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same marker.
     */
    override eq(other: ListMarkerWidget): boolean {
        return other.marker === this.marker;
    }

    /**
     * Renders the marker.
     *
     * @returns The marker element.
     */
    override toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.className = "cm-list-marker";
        span.textContent = this.marker;
        return span;
    }

    /**
     * Lets clicks through so clicking the marker reveals `\item`.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}

/** Reference kind → chip icon. */
const REF_ICONS: Record<RefKind, string> = {
    ref: "🔗",
    eqref: "🔗",
    cite: "📖",
    label: "🏷",
    url: "🌐",
    href: "🌐",
    footnote: "†",
};

/**
 * Inline chip rendering a reference command (`\ref{key}` → 🔗 key).
 *
 * Link chips (`\url`, `\href`) carry an "open" affordance; clicking
 * the chip body still reveals the source like every other chip, so
 * following a link cannot be confused with editing it.
 */
export class RefChipWidget extends WidgetType {
    /** Marks the open affordance, so clicks on it can be told apart. */
    private static readonly OPEN_CLASS = "cm-ref-chip-open";

    /**
     * @param kind - Which reference command is rendered.
     * @param keys - The referenced keys.
     * @param note - Optional locator or link text, or null.
     * @param target - Address for link kinds, or null.
     * @param openLink - Opens a link target, or undefined when the
     *   host provides no way to (plain browser, tests).
     */
    constructor(
        private readonly kind: RefKind,
        private readonly keys: readonly string[],
        private readonly note: string | null = null,
        private readonly target: string | null = null,
        private readonly openLink?: (url: string) => void,
    ) {
        super();
    }

    /**
     * Compares widgets so unchanged chips are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same chip.
     */
    override eq(other: RefChipWidget): boolean {
        return (
            other.kind === this.kind &&
            other.keys.join(",") === this.keys.join(",") &&
            other.note === this.note &&
            other.target === this.target
        );
    }

    /**
     * Renders the chip.
     *
     * @returns The chip element.
     */
    override toDOM(): HTMLElement {
        const chip = document.createElement("span");
        chip.className = `cm-ref-chip cm-ref-chip-${this.kind}`;

        const label = document.createElement("span");
        label.textContent = `${REF_ICONS[this.kind]} ${this.label()}`;
        chip.appendChild(label);

        if (this.canOpen()) chip.appendChild(this.renderOpenButton());

        return chip;
    }

    /**
     * Builds the chip's text.
     *
     * @returns The label, including any locator.
     */
    private label(): string {
        const body = this.kind === "href" && this.note ? this.note : this.keys.join(", ");
        const text = this.kind === "href" || !this.note ? body : `${body}, ${this.note}`;

        // A locator like `p.~3` is prose and should read as prose;
        // the chip renders its own text, so the decoration pipeline
        // never sees it.
        return applyTextReplacements(text);
    }

    /**
     * Reports whether this chip can offer to open its target.
     *
     * @returns True for link kinds with a handler available.
     */
    private canOpen(): boolean {
        return this.target !== null && this.openLink !== undefined;
    }

    /**
     * Builds the affordance that opens the link.
     *
     * @returns The button element.
     */
    private renderOpenButton(): HTMLElement {
        const button = document.createElement("span");
        button.className = RefChipWidget.OPEN_CLASS;
        button.textContent = "↗";
        button.title = this.target ?? "";

        button.addEventListener("mousedown", (event) => {
            // Stop CodeMirror from moving the cursor here, which would
            // reveal the source instead of following the link.
            event.preventDefault();
            event.stopPropagation();
            if (this.target) this.openLink?.(this.target);
        });

        return button;
    }

    /**
     * Lets clicks through so clicking the chip reveals the command —
     * except on the open affordance, which handles its own.
     *
     * @param event - The DOM event.
     * @returns True only for events the affordance owns.
     */
    override ignoreEvent(event: Event): boolean {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return false;

        return target.classList.contains(RefChipWidget.OPEN_CLASS);
    }
}

/**
 * Inline widget rendering an `\includegraphics` command.
 *
 * Shows the image itself when the host supplied a resolver that can
 * turn the LaTeX path into a loadable URL, and a labelled placeholder
 * otherwise — an unresolvable path (missing file, no project context,
 * plain browser) must still show the author *what* was referenced.
 */
export class GraphicsWidget extends WidgetType {
    /**
     * @param path - The image path as written in the source.
     * @param source - Loadable URL for the image, or null.
     */
    constructor(
        private readonly path: string,
        private readonly source: string | null,
    ) {
        super();
    }

    /**
     * Compares widgets so unchanged images are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same image.
     */
    override eq(other: GraphicsWidget): boolean {
        return other.path === this.path && other.source === this.source;
    }

    /**
     * Renders the image, or a placeholder chip.
     *
     * @returns The image or placeholder element.
     */
    override toDOM(): HTMLElement {
        if (this.source === null) return this.renderPlaceholder("🖼", this.path);

        const container = document.createElement("span");
        container.className = "cm-graphics";

        const image = document.createElement("img");
        image.src = this.source;
        // The path is author-supplied text, so it goes in as an
        // attribute value only — never interpreted as markup.
        image.alt = this.path;

        // A broken path must not leave an empty box with no
        // explanation of what failed to load.
        image.addEventListener("error", () => {
            container.replaceWith(this.renderPlaceholder("⚠", this.path));
        });

        container.appendChild(image);
        return container;
    }

    /**
     * Builds the stand-in shown when an image cannot be displayed.
     *
     * @param icon - Leading glyph.
     * @param label - Text to show, normally the path.
     * @returns The placeholder element.
     */
    private renderPlaceholder(icon: string, label: string): HTMLElement {
        const chip = document.createElement("span");
        chip.className = "cm-graphics-placeholder";
        chip.textContent = `${icon} ${label}`;
        return chip;
    }

    /**
     * Lets clicks through so clicking the image reveals the command.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}

/**
 * Block widget standing in for the hidden document preamble.
 * Clicking it moves the cursor into the preamble, revealing it.
 */
export class PreambleWidget extends WidgetType {
    /**
     * Compares widgets; all preamble chips render identically.
     *
     * @returns Always true.
     */
    override eq(): boolean {
        return true;
    }

    /**
     * Renders the preamble chip inside a row that carries its vertical
     * spacing.
     *
     * The wrapper is not decoration. CodeMirror measures a block
     * widget with `getBoundingClientRect().height`, which **excludes
     * margins** — so spacing the chip with a margin leaves the height
     * map short by that much, and every coordinate-to-position lookup
     * below the preamble resolves to the wrong line. The visible
     * symptom was the spell-check popup dismissing itself. Padding on
     * an outer block is inside the measured box, so it keeps the same
     * spacing and the geometry stays honest.
     *
     * @returns The chip's row element.
     */
    override toDOM(): HTMLElement {
        const row = document.createElement("div");
        row.className = "cm-preamble-row";

        const chip = document.createElement("div");
        chip.className = "cm-preamble-chip";
        chip.textContent = "⚙ Preamble — click to edit";
        row.appendChild(chip);

        return row;
    }

    /**
     * Lets clicks through so the cursor lands in the preamble.
     *
     * @returns Always false.
     */
    override ignoreEvent(): boolean {
        return false;
    }
}
