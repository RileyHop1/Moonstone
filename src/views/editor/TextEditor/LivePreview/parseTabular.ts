/**
 * Pure parser turning a `tabular` environment's interior into a cell
 * grid. Anything it does not fully understand yields `null`, and the
 * caller falls back to the generic environment box — rendering must
 * never break editing.
 */

import { findGroupEnd } from "./braces";

/** One parsed table cell. */
export interface TabularCell {
    /** The cell's LaTeX source (multicolumn/multirow wrapper stripped). */
    readonly source: string;
    /** Number of columns the cell spans (`\multicolumn`), at least 1. */
    readonly span: number;
    /** Number of rows the cell spans (`\multirow`), at least 1. */
    readonly rowSpan: number;
    /** Alignment from a `\multicolumn` spec; null uses the column default. */
    readonly align: "left" | "center" | "right" | null;
}

/** A parsed table: rows of cells. */
export type TabularRows = readonly (readonly TabularCell[])[];

/** Constructs the parser cannot lay out; their presence aborts parsing. */
const UNSUPPORTED_PATTERN = /\\begin\{/;

/** Matches the head of a `\multicolumn{n}{spec}` command. */
const MULTICOLUMN_PATTERN = /^\\multicolumn\{(\d+)\}\{([^}]*)\}/;

/**
 * Matches the head of a `\multirow{n}{width}` command, including the
 * optional vertical-adjustment argument (`\multirow{2}{*}[-2pt]{…}`).
 */
const MULTIROW_PATTERN = /^\\multirow\*?\{(\d+)\}\{[^}]*\}(\[[^\]]*\])?/;

/**
 * Parses the text between `\begin{tabular}` and `\end{tabular}`.
 *
 * The leading column specification (and optional position argument)
 * is stripped; `\hline` rules are dropped; rows split on `\\` and
 * cells on unescaped `&`. `\multicolumn{n}{spec}{...}` cells become
 * spanning cells; any malformed multicolumn aborts the whole parse.
 *
 * @param interior - Environment interior, starting right after the
 *   `\begin{tabular}` token.
 * @returns The cell grid, or null when the content is unsupported.
 */
export function parseTabular(interior: string): TabularRows | null {
    if (UNSUPPORTED_PATTERN.test(interior)) return null;

    // Drop `[pos]` and the `{|c|c|}` column spec after \begin{tabular}.
    const body = interior.replace(/^\s*(\[[^\]]*\])?\s*\{[^}]*\}/, "");

    // `\hline` plus the booktabs rules, which take an optional
    // trimming argument (`\cmidrule(lr){2-3}`).
    const withoutRules = body.replace(
        /\\(hline|toprule|midrule|bottomrule|cmidrule|addlinespace|morecmidrules)\s*(\([^)]*\))?(\[[^\]]*\])?(\{[^}]*\})?/g,
        "",
    );

    // Struts: invisible boxes authors add to open up a row's height,
    // usually written straight after a rule (`\hline\rule{0pt}{2.0ex}`).
    // They carry no content, but left in place they sit in front of the
    // cell's real command — which is enough to stop a `\multirow` being
    // recognised and drop the whole table back to the generic box.
    const withoutStruts = withoutRules.replace(
        /\\rule\s*(\[[^\]]*\])?\{[^}]*\}\{[^}]*\}|\\strut\b/g,
        "",
    );

    const rows = withoutStruts
        .split("\\\\")
        .map((row) => row.trim())
        .filter((row) => row.length > 0);

    if (rows.length === 0) return null;

    const parsedRows: (readonly TabularCell[])[] = [];

    // How many further rows each column is still covered by a
    // `\multirow` started above it.
    const covered = new Map<number, number>();

    for (const row of rows) {
        // Columns covered *in this row*, taken before the counters are
        // spent, so a span started here is not mistaken for one that
        // reaches down into the next row.
        const coveredHere = new Set<number>();
        for (const [column, remaining] of covered) {
            if (remaining <= 0) continue;
            coveredHere.add(column);
            covered.set(column, remaining - 1);
        }

        const cell = parseRow(splitCells(row), coveredHere, covered);
        if (cell === null) return null;

        parsedRows.push(cell);
    }

    return parsedRows;
}

/**
 * Turns one row's cell sources into cells, accounting for spans
 * reaching into it from above.
 *
 * A `\multirow` in LaTeX still expects its covered rows to write a
 * placeholder for that column — usually empty, as in `& Cost` — and
 * that placeholder must be dropped, or every row under a span would
 * render one cell too wide.
 *
 * @param sources - The row's `&`-separated cell sources.
 * @param coveredHere - Columns already occupied by a span from above.
 * @param covered - Running span bookkeeping, updated for later rows.
 * @returns The row's cells, or null when a cell is malformed.
 */
function parseRow(
    sources: readonly string[],
    coveredHere: ReadonlySet<number>,
    covered: Map<number, number>,
): TabularCell[] | null {
    const cells: TabularCell[] = [];
    let sourceIndex = 0;
    let column = 0;

    while (sourceIndex < sources.length) {
        if (coveredHere.has(column)) {
            // Consume the placeholder only when it is actually blank:
            // a row that omits it entirely is still laid out correctly,
            // and one with content there is not ours to discard.
            if ((sources[sourceIndex] ?? "").trim() === "") sourceIndex += 1;
            column += 1;
            continue;
        }

        const cell = parseCell((sources[sourceIndex] ?? "").trim());
        if (cell === null) return null;

        cells.push(cell);

        if (cell.rowSpan > 1) {
            for (let spanned = column; spanned < column + cell.span; spanned++) {
                covered.set(spanned, cell.rowSpan - 1);
            }
        }

        column += cell.span;
        sourceIndex += 1;
    }

    return cells;
}

/**
 * Parses one cell, unwrapping a `\multicolumn{n}{spec}{...}` command
 * when present.
 *
 * @param cellSource - The trimmed cell source.
 * @returns The parsed cell, or null when a multicolumn is malformed
 *   (bad span, unbalanced braces, or trailing content after it).
 */
function parseCell(cellSource: string): TabularCell | null {
    if (!cellSource.includes("\\multicolumn")) {
        return parseMultirow(cellSource);
    }

    const head = MULTICOLUMN_PATTERN.exec(cellSource);
    if (!head) return null;

    const span = Number.parseInt(head[1] ?? "", 10);
    if (!Number.isInteger(span) || span < 1) return null;

    const contentOpen = head[0].length;
    const contentClose = findGroupEnd(cellSource, contentOpen);
    if (contentClose === -1) return null;

    // Anything after the content group would be silently dropped by
    // the renderer, so bail to the env box instead.
    if (cellSource.slice(contentClose + 1).trim() !== "") return null;

    // The two commands nest — `\multicolumn{2}{c}{\multirow{2}{*}{X}}`
    // spans both ways — so the inner one is unwrapped in turn.
    const inner = parseMultirow(cellSource.slice(contentOpen + 1, contentClose).trim());
    if (inner === null) return null;

    return {
        source: inner.source,
        span,
        rowSpan: inner.rowSpan,
        align: parseAlignment(head[2] ?? ""),
    };
}

/**
 * Unwraps a `\multirow{n}{width}{content}` cell.
 *
 * @param cellSource - The trimmed cell source.
 * @returns The cell, or null when the multirow is malformed.
 */
function parseMultirow(cellSource: string): TabularCell | null {
    if (!cellSource.includes("\\multirow")) {
        return { source: cellSource, span: 1, rowSpan: 1, align: null };
    }

    const head = MULTIROW_PATTERN.exec(cellSource);
    if (!head) return null;

    const rowSpan = Number.parseInt(head[1] ?? "", 10);
    if (!Number.isInteger(rowSpan) || rowSpan < 1) return null;

    const contentOpen = head[0].length;
    const contentClose = findGroupEnd(cellSource, contentOpen);
    if (contentClose === -1) return null;

    if (cellSource.slice(contentClose + 1).trim() !== "") return null;

    return {
        source: cellSource.slice(contentOpen + 1, contentClose).trim(),
        span: 1,
        rowSpan,
        align: null,
    };
}

/**
 * Extracts the alignment from a `\multicolumn` column spec.
 *
 * @param spec - The spec between the second pair of braces, e.g. `|c|`.
 * @returns The alignment of the first `l`/`c`/`r` found, or null.
 */
function parseAlignment(spec: string): TabularCell["align"] {
    for (const char of spec) {
        if (char === "l") return "left";
        if (char === "c") return "center";
        if (char === "r") return "right";
    }
    return null;
}

/**
 * Splits one table row on unescaped `&` separators.
 *
 * @param row - The row source.
 * @returns The cell sources.
 */
function splitCells(row: string): readonly string[] {
    const cells: string[] = [];
    let current = "";

    for (let index = 0; index < row.length; index++) {
        const char = row[index];

        // Keep escaped characters (e.g. \&) inside the current cell.
        if (char === "\\") {
            current += char + (row[index + 1] ?? "");
            index++;
            continue;
        }

        if (char === "&") {
            cells.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    cells.push(current);
    return cells;
}
