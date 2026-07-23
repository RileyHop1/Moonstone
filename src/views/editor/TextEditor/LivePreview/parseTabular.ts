/**
 * Pure parser turning a `tabular` environment's interior into a cell
 * grid. Anything it does not fully understand yields `null`, and the
 * caller falls back to the generic environment box — rendering must
 * never break editing.
 */

/** A parsed table: rows of cell source strings. */
export type TabularRows = readonly (readonly string[])[];

/** Constructs the parser cannot lay out; their presence aborts parsing. */
const UNSUPPORTED_PATTERN = /\\multicolumn|\\multirow|\\begin\{/;

/**
 * Parses the text between `\begin{tabular}` and `\end{tabular}`.
 *
 * The leading column specification (and optional position argument)
 * is stripped; `\hline` rules are dropped; rows split on `\\` and
 * cells on unescaped `&`.
 *
 * @param interior - Environment interior, starting right after the
 *   `\begin{tabular}` token.
 * @returns The cell grid, or null when the content is unsupported.
 */
export function parseTabular(interior: string): TabularRows | null {
    if (UNSUPPORTED_PATTERN.test(interior)) return null;

    // Drop `[pos]` and the `{|c|c|}` column spec after \begin{tabular}.
    const body = interior.replace(/^\s*(\[[^\]]*\])?\s*\{[^}]*\}/, "");

    const withoutRules = body.replace(/\\hline/g, "");

    const rows = withoutRules
        .split("\\\\")
        .map((row) => row.trim())
        .filter((row) => row.length > 0);

    if (rows.length === 0) return null;

    return rows.map((row) => splitCells(row).map((cell) => cell.trim()));
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
