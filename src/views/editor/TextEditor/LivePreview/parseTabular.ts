/**
 * Pure parser turning a `tabular` environment's interior into a cell
 * grid. Anything it does not fully understand yields `null`, and the
 * caller falls back to the generic environment box — rendering must
 * never break editing.
 */

import { findGroupEnd } from "./braces";

/** One parsed table cell. */
export interface TabularCell {
    /** The cell's LaTeX source (multicolumn wrapper stripped). */
    readonly source: string;
    /** Number of columns the cell spans (`\multicolumn`), at least 1. */
    readonly span: number;
    /** Alignment from a `\multicolumn` spec; null uses the column default. */
    readonly align: "left" | "center" | "right" | null;
}

/** A parsed table: rows of cells. */
export type TabularRows = readonly (readonly TabularCell[])[];

/** Constructs the parser cannot lay out; their presence aborts parsing. */
const UNSUPPORTED_PATTERN = /\\multirow|\\begin\{/;

/** Matches the head of a `\multicolumn{n}{spec}` command. */
const MULTICOLUMN_PATTERN = /^\\multicolumn\{(\d+)\}\{([^}]*)\}/;

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

    const rows = withoutRules
        .split("\\\\")
        .map((row) => row.trim())
        .filter((row) => row.length > 0);

    if (rows.length === 0) return null;

    const parsedRows: (readonly TabularCell[])[] = [];

    for (const row of rows) {
        const cells: TabularCell[] = [];

        for (const cellSource of splitCells(row)) {
            const cell = parseCell(cellSource.trim());
            if (cell === null) return null;
            cells.push(cell);
        }

        parsedRows.push(cells);
    }

    return parsedRows;
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
        return { source: cellSource, span: 1, align: null };
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

    return {
        source: cellSource.slice(contentOpen + 1, contentClose).trim(),
        span,
        align: parseAlignment(head[2] ?? ""),
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
