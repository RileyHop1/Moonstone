/**
 * Test suite for the live preview's tabular parser.
 */

import { describe, it, expect } from "vitest";
import { parseTabular } from "../views/editor/TextEditor/LivePreview/parseTabular";
import type { TabularCell } from "../views/editor/TextEditor/LivePreview/parseTabular";

/** Builds a plain single-span cell, the common case in expectations. */
function cell(source: string): TabularCell {
    return { source, span: 1, align: null };
}

describe("parseTabular", () => {
    it("parses a simple two-column table", () => {
        const interior = "{|c|c|}\n\\hline\na & b \\\\\n\\hline\nc & d \\\\\n\\hline\n";

        expect(parseTabular(interior)).toEqual([
            [cell("a"), cell("b")],
            [cell("c"), cell("d")],
        ]);
    });

    it("strips the column spec and optional position argument", () => {
        const interior = "[t]{cc}\nx & y \\\\\n";

        expect(parseTabular(interior)).toEqual([[cell("x"), cell("y")]]);
    });

    it("keeps escaped ampersands inside cells", () => {
        const interior = "{cc}\na \\& b & c \\\\\n";

        expect(parseTabular(interior)).toEqual([[cell("a \\& b"), cell("c")]]);
    });

    it("handles a final row without a trailing row separator", () => {
        const interior = "{cc}\na & b \\\\\nc & d\n";

        expect(parseTabular(interior)).toEqual([
            [cell("a"), cell("b")],
            [cell("c"), cell("d")],
        ]);
    });

    it("parses a multicolumn cell with span and alignment", () => {
        const interior = "{cc}\n\\multicolumn{2}{c}{header} \\\\\na & b \\\\\n";

        expect(parseTabular(interior)).toEqual([
            [{ source: "header", span: 2, align: "center" }],
            [cell("a"), cell("b")],
        ]);
    });

    it("reads alignment through vertical rules in the spec", () => {
        const interior = "{cc}\n\\multicolumn{2}{|r|}{x} \\\\\n";

        expect(parseTabular(interior)).toEqual([[{ source: "x", span: 2, align: "right" }]]);
    });

    it("keeps nested braces inside multicolumn content", () => {
        const interior = "{cc}\n\\multicolumn{2}{c}{\\textbf{x}} \\\\\n";

        expect(parseTabular(interior)).toEqual([
            [{ source: "\\textbf{x}", span: 2, align: "center" }],
        ]);
    });

    it("returns null for malformed multicolumn cells", () => {
        // Zero span.
        expect(parseTabular("{cc}\n\\multicolumn{0}{c}{x} \\\\\n")).toBeNull();
        // Unbalanced content group.
        expect(parseTabular("{cc}\n\\multicolumn{2}{c}{x \\\\\n")).toBeNull();
        // Multicolumn not at the start of the cell.
        expect(parseTabular("{cc}\ny \\multicolumn{2}{c}{x} \\\\\n")).toBeNull();
        // Trailing content after the group.
        expect(parseTabular("{cc}\n\\multicolumn{2}{c}{x} y \\\\\n")).toBeNull();
    });

    it("returns null for unsupported constructs", () => {
        expect(parseTabular("{cc}\n\\multirow{2}{*}{x} & y \\\\\n")).toBeNull();
        expect(parseTabular("{cc}\n\\begin{tabular}{c}\nnested\n\\end{tabular} \\\\\n")).toBeNull();
    });

    it("returns null for an empty body", () => {
        expect(parseTabular("{|c|}\n\\hline\n")).toBeNull();
    });
});
