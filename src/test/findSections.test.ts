/**
 * Test suite for the live preview's section-command scanner.
 */

import { describe, it, expect } from "vitest";
import { findSections } from "../views/editor/TextEditor/LivePreview/findSections";

describe("findSections", () => {
    it("finds all three levels with correct offsets", () => {
        const doc = "\\section{One}\n\\subsection{Two}\n\\subsubsection{Three}\n";

        expect(findSections(doc)).toEqual([
            { level: 1, from: 0, to: 13, contentFrom: 9, contentTo: 12 },
            { level: 2, from: 14, to: 30, contentFrom: 26, contentTo: 29 },
            { level: 3, from: 31, to: 52, contentFrom: 46, contentTo: 51 },
        ]);
    });

    it("finds starred variants", () => {
        const doc = "\\section*{Intro}";

        expect(findSections(doc)).toEqual([
            { level: 1, from: 0, to: 16, contentFrom: 10, contentTo: 15 },
        ]);
    });

    it("brace-matches titles containing nested groups", () => {
        const doc = "\\section{a \\textbf{b}}";

        expect(findSections(doc)).toEqual([
            { level: 1, from: 0, to: 22, contentFrom: 9, contentTo: 21 },
        ]);
    });

    it("finds a command that is not at the start of a line", () => {
        const doc = "intro \\subsection{Here}";

        expect(findSections(doc)).toEqual([
            { level: 2, from: 6, to: 23, contentFrom: 18, contentTo: 22 },
        ]);
    });

    it("skips unclosed titles", () => {
        expect(findSections("\\section{oops")).toEqual([]);
    });

    it("skips titles spanning a line break", () => {
        expect(findSections("\\section{a\nb}")).toEqual([]);
    });

    it("skips empty and whitespace-only titles", () => {
        expect(findSections("\\section{}")).toEqual([]);
        expect(findSections("\\section{   }")).toEqual([]);
    });

    it("skips escaped commands", () => {
        expect(findSections("\\\\section{not a heading}")).toEqual([]);
    });
});
