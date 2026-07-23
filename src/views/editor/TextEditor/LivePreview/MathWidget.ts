/**
 * CodeMirror widgets used by the live preview: rendered math and the
 * collapsed-preamble chip.
 */

import { WidgetType } from "@codemirror/view";
import katex from "katex";
import { findMathRanges } from "./findMath";
import type { RefKind } from "./findRefs";
import type { TabularRows } from "./parseTabular";

/**
 * Replaces a math source range with its KaTeX rendering. Invalid
 * LaTeX falls back to the raw source in an error style instead of
 * crashing the editor.
 */
export class MathWidget extends WidgetType {
    /**
     * @param latex - The LaTeX source between the delimiters.
     * @param display - True renders display (block) math.
     */
    constructor(
        private readonly latex: string,
        private readonly display: boolean,
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
        return other.latex === this.latex && other.display === this.display;
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
     */
    constructor(private readonly symbol: string) {
        super();
    }

    /**
     * Compares widgets so unchanged symbols are not re-rendered.
     *
     * @param other - The widget to compare against.
     * @returns True when both render the same glyph.
     */
    override eq(other: SymbolWidget): boolean {
        return other.symbol === this.symbol;
    }

    /**
     * Renders the glyph.
     *
     * @returns The glyph element.
     */
    override toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.className = "cm-symbol";
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
 * Fills a table cell, rendering any `$...$` segments with KaTeX and
 * everything else as plain text.
 *
 * @param cell - The td element to fill.
 * @param source - The cell's LaTeX source.
 */
function renderCellContents(cell: HTMLElement, source: string): void {
    const mathRanges = findMathRanges(source, 0);

    if (mathRanges.length === 0) {
        cell.textContent = source;
        return;
    }

    let position = 0;

    for (const range of mathRanges) {
        if (range.from > position) {
            cell.appendChild(document.createTextNode(source.slice(position, range.from)));
        }

        const mathSpan = document.createElement("span");
        try {
            katex.render(source.slice(range.innerFrom, range.innerTo), mathSpan, {
                displayMode: false,
                throwOnError: false,
            });
        } catch {
            mathSpan.textContent = source.slice(range.from, range.to);
        }
        cell.appendChild(mathSpan);

        position = range.to;
    }

    if (position < source.length) {
        cell.appendChild(document.createTextNode(source.slice(position)));
    }
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
};

/**
 * Inline chip rendering a reference command (`\ref{key}` → 🔗 key).
 */
export class RefChipWidget extends WidgetType {
    /**
     * @param kind - Which reference command is rendered.
     * @param keys - The referenced keys.
     */
    constructor(
        private readonly kind: RefKind,
        private readonly keys: readonly string[],
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
        return other.kind === this.kind && other.keys.join(",") === this.keys.join(",");
    }

    /**
     * Renders the chip.
     *
     * @returns The chip element.
     */
    override toDOM(): HTMLElement {
        const chip = document.createElement("span");
        chip.className = `cm-ref-chip cm-ref-chip-${this.kind}`;
        chip.textContent = `${REF_ICONS[this.kind]} ${this.keys.join(", ")}`;
        return chip;
    }

    /**
     * Lets clicks through so clicking the chip reveals the command.
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
     * Renders the preamble chip.
     *
     * @returns The chip element.
     */
    override toDOM(): HTMLElement {
        const chip = document.createElement("div");
        chip.className = "cm-preamble-chip";
        chip.textContent = "⚙ Preamble — click to edit";
        return chip;
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
