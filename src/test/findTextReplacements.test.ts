/**
 * Test suite for LaTeX's text-mode spellings: escaped punctuation,
 * dashes, quote pairs, ties and accents.
 */

import { describe, it, expect } from "vitest";
import {
    applyTextReplacements as render,
    findTextReplacements,
} from "../views/editor/TextEditor/LivePreview/findTextReplacements";

describe("escaped punctuation", () => {
    it("renders escaped characters as themselves", () => {
        expect(render("100\\% of A\\&B costs \\$5")).toBe("100% of A&B costs $5");
    });

    it("renders escaped underscores, hashes and braces", () => {
        expect(render("a\\_b \\#1 \\{x\\}")).toBe("a_b #1 {x}");
    });

    it("leaves a line break alone", () => {
        // `\\` is a line break, not an escaped backslash.
        expect(render("line\\\\next")).toBe("line\\\\next");
    });

    it("leaves unknown commands alone", () => {
        expect(render("\\alpha and \\textbf{x}")).toBe("\\alpha and \\textbf{x}");
    });
});

describe("dashes and quotes", () => {
    it("renders an em dash before an en dash", () => {
        expect(render("a---b")).toBe("a—b");
    });

    it("renders an en dash", () => {
        expect(render("pages 1--10")).toBe("pages 1–10");
    });

    it("leaves a single hyphen alone", () => {
        expect(render("well-known")).toBe("well-known");
    });

    it("renders paired quotes", () => {
        expect(render("``quoted''")).toBe("“quoted”");
    });

    it("leaves a lone apostrophe alone", () => {
        // Rendering single quotes would mangle every apostrophe in
        // ordinary prose for no visible gain.
        expect(render("don't")).toBe("don't");
    });

    it("renders a tie as a non-breaking space", () => {
        // U+00A0, not a plain space — the tie's whole purpose is that
        // the line cannot break there.
        expect(render("Fig.~1")).toBe("Fig. 1");
    });
});

describe("accents", () => {
    it("renders bare accents", () => {
        expect(render("na\\\"ive")).toBe("naïve");
        expect(render("caf\\'e")).toBe("café");
        expect(render("\\`a la carte")).toBe("à la carte");
    });

    it("renders braced accents", () => {
        expect(render("na\\\"{i}ve")).toBe("naïve");
        expect(render("\\^{o}")).toBe("ô");
    });

    it("renders tilde and macron accents", () => {
        expect(render("ma\\~nana")).toBe("mañana");
        expect(render("\\=o")).toBe("ō");
    });

    it("renders letter-named accents when braced", () => {
        expect(render("fa\\c{c}ade")).toBe("façade");
        expect(render("\\v{s}")).toBe("š");
    });

    it("does not read a longer command as a letter accent", () => {
        // `\verb` starts with `\v` but is not a caron, and `\ref` is
        // not a ring — the brace requirement is what separates them.
        expect(render("\\verb|x|")).toBe("\\verb|x|");
        expect(render("\\ref{a}")).toBe("\\ref{a}");
    });

    it("composes to a single precomposed character", () => {
        // Combining pairs render poorly; NFC gives the real letter.
        expect(render("\\'e")).toHaveLength(1);
    });

    it("leaves an accent with no letter alone", () => {
        expect(render("\\' ")).toBe("\\' ");
    });
});

describe("offsets and exclusions", () => {
    it("reports document positions", () => {
        const replacements = findTextReplacements("ab---cd", 100, []);

        expect(replacements).toEqual([{ from: 102, to: 105, text: "—" }]);
    });

    it("skips replacements inside excluded ranges", () => {
        // Math is KaTeX's territory; `a--b` there is not an en dash.
        const source = "$a--b$ and c--d";

        const replacements = findTextReplacements(source, 0, [{ from: 0, to: 6 }]);

        expect(replacements).toHaveLength(1);
        expect(replacements[0]?.from).toBe(12);
    });

    it("finds several replacements in order", () => {
        expect(render("\\&---``x''")).toBe("&—“x”");
    });
});
