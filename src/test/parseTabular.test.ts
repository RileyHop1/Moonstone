/**
 * Test suite for the live preview's tabular parser.
 */

import { describe, it, expect } from "vitest";
import { parseTabular } from "../views/editor/TextEditor/LivePreview/parseTabular";
import type { TabularCell } from "../views/editor/TextEditor/LivePreview/parseTabular";

/** Builds a plain single-span cell, the common case in expectations. */
function cell(source: string): TabularCell {
    return { source, span: 1, rowSpan: 1, align: null };
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
            [{ source: "header", span: 2, rowSpan: 1, align: "center" }],
            [cell("a"), cell("b")],
        ]);
    });

    it("reads alignment through vertical rules in the spec", () => {
        const interior = "{cc}\n\\multicolumn{2}{|r|}{x} \\\\\n";

        expect(parseTabular(interior)).toEqual([[{ source: "x", span: 2, rowSpan: 1, align: "right" }]]);
    });

    it("keeps nested braces inside multicolumn content", () => {
        const interior = "{cc}\n\\multicolumn{2}{c}{\\textbf{x}} \\\\\n";

        expect(parseTabular(interior)).toEqual([
            [{ source: "\\textbf{x}", span: 2, rowSpan: 1, align: "center" }],
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
        expect(parseTabular("{cc}\n\\begin{tabular}{c}\nnested\n\\end{tabular} \\\\\n")).toBeNull();
    });

    describe("multirow", () => {
        /** Builds a cell spanning several rows. */
        function spanning(source: string, rowSpan: number): TabularCell {
            return { source, span: 1, rowSpan, align: null };
        }

        it("spans a cell down and drops the placeholder beneath it", () => {
            // LaTeX still writes the covered column in the next row —
            // usually blank, as the leading `&` here. Rendering that
            // placeholder would push the row one cell too wide.
            const interior = "{ll}\n\\multirow{2}{*}{Model} & BLEU \\\\\n & Cost \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("Model", 2), cell("BLEU")],
                [cell("Cost")],
            ]);
        });

        it("stops covering once the span is used up", () => {
            const interior =
                "{ll}\n\\multirow{2}{*}{A} & one \\\\\n & two \\\\\nB & three \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("A", 2), cell("one")],
                [cell("two")],
                [cell("B"), cell("three")],
            ]);
        });

        it("handles a span of three", () => {
            const interior = "{ll}\n\\multirow{3}{*}{A} & 1 \\\\\n & 2 \\\\\n & 3 \\\\\nB & 4 \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("A", 3), cell("1")],
                [cell("2")],
                [cell("3")],
                [cell("B"), cell("4")],
            ]);
        });

        it("spans a column that is not the first", () => {
            const interior = "{lll}\na & \\multirow{2}{*}{M} & x \\\\\nb & & y \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [cell("a"), spanning("M", 2), cell("x")],
                [cell("b"), cell("y")],
            ]);
        });

        it("keeps nested braces in the content", () => {
            const interior = "{ll}\n\\multirow{2}{*}{\\textbf{M}} & x \\\\\n & y \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("\\textbf{M}", 2), cell("x")],
                [cell("y")],
            ]);
        });

        it("accepts the optional vertical-adjustment argument", () => {
            const interior = "{ll}\n\\multirow{2}{*}[-2pt]{M} & x \\\\\n & y \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("M", 2), cell("x")],
                [cell("y")],
            ]);
        });

        it("combines with multicolumn", () => {
            const interior =
                "{lll}\n\\multicolumn{2}{c}{\\multirow{2}{*}{M}} & x \\\\\n & & y \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [{ source: "M", span: 2, rowSpan: 2, align: "center" }, cell("x")],
                [cell("y")],
            ]);
        });

        it("sees through a strut written in front of the command", () => {
            // Straight from the arXiv paper: a strut glued to the rule
            // sits in front of the cell's real command, which stopped
            // the multirow being recognised and dropped the table.
            const interior =
                "{ll}\n\\hline\\rule{0pt}{2.0ex}\n\\multirow{2}{*}{A} & one \\\\\n & two \\\\\n";

            expect(parseTabular(interior)).toEqual([
                [spanning("A", 2), cell("one")],
                [cell("two")],
            ]);
        });

        it("returns null for a malformed multirow", () => {
            // Zero span.
            expect(parseTabular("{cc}\n\\multirow{0}{*}{x} & y \\\\\n")).toBeNull();
            // Unbalanced content group.
            expect(parseTabular("{cc}\n\\multirow{2}{*}{x & y \\\\\n")).toBeNull();
            // Trailing content after the group.
            expect(parseTabular("{cc}\n\\multirow{2}{*}{x} y & z \\\\\n")).toBeNull();
        });
    });

    it("returns null for an empty body", () => {
        expect(parseTabular("{|c|}\n\\hline\n")).toBeNull();
    });
});
