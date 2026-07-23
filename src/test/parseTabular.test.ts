/**
 * Test suite for the live preview's tabular parser.
 */

import { describe, it, expect } from "vitest";
import { parseTabular } from "../views/editor/TextEditor/LivePreview/parseTabular";

describe("parseTabular", () => {
    it("parses a simple two-column table", () => {
        const interior = "{|c|c|}\n\\hline\na & b \\\\\n\\hline\nc & d \\\\\n\\hline\n";

        expect(parseTabular(interior)).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    it("strips the column spec and optional position argument", () => {
        const interior = "[t]{cc}\nx & y \\\\\n";

        expect(parseTabular(interior)).toEqual([["x", "y"]]);
    });

    it("keeps escaped ampersands inside cells", () => {
        const interior = "{cc}\na \\& b & c \\\\\n";

        expect(parseTabular(interior)).toEqual([["a \\& b", "c"]]);
    });

    it("handles a final row without a trailing row separator", () => {
        const interior = "{cc}\na & b \\\\\nc & d\n";

        expect(parseTabular(interior)).toEqual([
            ["a", "b"],
            ["c", "d"],
        ]);
    });

    it("returns null for unsupported constructs", () => {
        expect(parseTabular("{cc}\n\\multicolumn{2}{c}{x} \\\\\n")).toBeNull();
        expect(parseTabular("{cc}\n\\begin{tabular}{c}\nnested\n\\end{tabular} \\\\\n")).toBeNull();
    });

    it("returns null for an empty body", () => {
        expect(parseTabular("{|c|}\n\\hline\n")).toBeNull();
    });
});
