/**
 * Test suite for the `\includegraphics` scanner.
 */

import { describe, it, expect } from "vitest";
import { findGraphicsRanges } from "../views/editor/TextEditor/LivePreview/findGraphics";

describe("findGraphicsRanges", () => {
    it("finds a bare command", () => {
        const ranges = findGraphicsRanges("\\includegraphics{plot.png}", 0, []);

        expect(ranges).toEqual([
            { from: 0, to: 26, path: "plot.png", options: null },
        ]);
    });

    it("captures the optional argument", () => {
        const ranges = findGraphicsRanges("\\includegraphics[width=5cm]{a.pdf}", 0, []);

        expect(ranges[0]?.options).toBe("width=5cm");
        expect(ranges[0]?.path).toBe("a.pdf");
    });

    it("offsets positions into the document", () => {
        const ranges = findGraphicsRanges("\\includegraphics{a.png}", 100, []);

        expect(ranges[0]?.from).toBe(100);
    });

    it("finds subdirectory paths", () => {
        const ranges = findGraphicsRanges("\\includegraphics{figures/plot.png}", 0, []);

        expect(ranges[0]?.path).toBe("figures/plot.png");
    });

    it("trims surrounding whitespace from the path", () => {
        const ranges = findGraphicsRanges("\\includegraphics{ a.png }", 0, []);

        expect(ranges[0]?.path).toBe("a.png");
    });

    it("ignores an escaped command", () => {
        expect(findGraphicsRanges("\\\\includegraphics{a.png}", 0, [])).toEqual([]);
    });

    it("ignores an empty path", () => {
        expect(findGraphicsRanges("\\includegraphics{}", 0, [])).toEqual([]);
        expect(findGraphicsRanges("\\includegraphics{   }", 0, [])).toEqual([]);
    });

    it("ignores commands inside excluded ranges", () => {
        const text = "\\includegraphics{a.png}";

        expect(findGraphicsRanges(text, 0, [{ from: 0, to: 23 }])).toEqual([]);
    });

    it("ignores a path spanning a line break", () => {
        expect(findGraphicsRanges("\\includegraphics{a\n.png}", 0, [])).toEqual([]);
    });

    it("finds several commands in order", () => {
        const ranges = findGraphicsRanges(
            "\\includegraphics{a.png} and \\includegraphics{b.png}",
            0,
            [],
        );

        expect(ranges.map((range) => range.path)).toEqual(["a.png", "b.png"]);
    });
});
