/**
 * Test suite for the spell checker's word extraction.
 *
 * The value of a spell checker in a LaTeX document is almost entirely
 * in what it declines to flag, so most of these assert absence.
 */

import { describe, it, expect } from "vitest";
import { findProseWords } from "../views/editor/TextEditor/SpellCheck/findProseWords";

/**
 * Extracts just the words, for readable assertions.
 *
 * @param text - The text to scan.
 * @returns The checkable words in order.
 */
function words(text: string): readonly string[] {
    return findProseWords(text, 0, []).map((word) => word.text);
}

describe("findProseWords", () => {
    it("finds ordinary prose", () => {
        expect(words("The quick brown fox")).toEqual(["The", "quick", "brown", "fox"]);
    });

    it("reports document positions", () => {
        expect(findProseWords("aa bbb cc", 100, [])).toEqual([
            { from: 103, to: 106, text: "bbb" },
        ]);
    });

    it("keeps an apostrophe inside a word", () => {
        expect(words("don't stop")).toEqual(["don't", "stop"]);
    });

    it("does not swallow a trailing quote as part of a word", () => {
        expect(words("the cats' toys")).toEqual(["the", "cats", "toys"]);
    });
});

describe("what it declines to check", () => {
    it("skips commands", () => {
        expect(words("\\textbf and \\emph here")).toEqual(["and", "here"]);
    });

    it("skips identifier arguments", () => {
        expect(words("see \\ref{sec:intro} now")).toEqual(["see", "now"]);
        expect(words("\\begin{itemize} body")).toEqual(["body"]);
        expect(words("\\includegraphics[width=5cm]{figs/plot.png} caption")).toEqual([
            "caption",
        ]);
    });

    it("checks prose arguments of formatting commands", () => {
        // The command is skipped but its content is real prose.
        expect(words("\\textbf{important words}")).toEqual(["important", "words"]);
    });

    it("skips a texttt argument, which is code", () => {
        expect(words("\\texttt{getElementById} here")).toEqual(["here"]);
    });

    it("skips inline and display math", () => {
        expect(words("before $x_{ij} \\alpha$ after")).toEqual(["before", "after"]);
        expect(words("before $$\\sum_k a_k$$ after")).toEqual(["before", "after"]);
    });

    it("skips short words, numbers and acronyms", () => {
        expect(words("a an the HTML PDF x2 h2o")).toEqual(["the"]);
    });

    it("skips excluded regions", () => {
        // Comments and verbatim bodies arrive pre-masked in practice;
        // the exclusion list is the general mechanism.
        const text = "keep dropped";

        expect(findProseWords(text, 0, [{ from: 5, to: 12 }]).map((w) => w.text)).toEqual([
            "keep",
        ]);
    });

    it("does not run past an unclosed argument", () => {
        // A missing brace must not swallow the rest of the document.
        expect(words("\\ref{unclosed and more prose")).toContain("prose");
    });

    it("keeps checking past an unclosed math delimiter", () => {
        // Matching the preview, a `$` with no partner is not math. The
        // alternative — treating the rest of the file as math — would
        // silently stop checking everything after a stray dollar.
        expect(words("text $unclosed math")).toEqual(["text", "unclosed", "math"]);
    });
});

describe("accented and non-ascii words", () => {
    it("treats accented letters as word characters", () => {
        expect(words("café naïve")).toEqual(["café", "naïve"]);
    });
});
