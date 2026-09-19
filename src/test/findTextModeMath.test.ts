/**
 * Tests for the text-mode math lint: `\alpha` in running text renders in
 * the preview but fails to compile, so it must be found — and nothing
 * that LaTeX accepts may be.
 */

import { describe, expect, it } from "vitest";
import { findTextModeMath } from "../views/editor/TextEditor/latex";

/**
 * Wraps a body in a minimal document.
 *
 * @param body - The document body.
 * @returns The full source.
 */
function inDocument(body: string): string {
    return (
        String.raw`\documentclass{article}
\newcommand{\angle}{\alpha}
\begin{document}
` +
        body +
        String.raw`
\end{document}`
    );
}

/**
 * The names of the commands flagged in a body.
 *
 * @param body - The document body.
 * @returns The flagged command names.
 */
function flagged(body: string): readonly string[] {
    return findTextModeMath(inDocument(body)).map((command) => command.name);
}

describe("findTextModeMath", () => {
    it("flags a math-only command in running text", () => {
        expect(flagged(String.raw`The angle \alpha is small, and \leq holds.`)).toEqual([
            "alpha",
            "leq",
        ]);
    });

    it("gives the command's exact position", () => {
        const source = inDocument(String.raw`Take \beta.`);
        const [command] = findTextModeMath(source);

        expect(source.slice(command?.from, command?.to)).toBe(String.raw`\beta`);
    });

    it("accepts every way of writing math", () => {
        const body = String.raw`$\alpha$ and $$\beta$$ and \(\gamma\) and \[\delta\]
\begin{equation}\epsilon\end{equation}
\begin{align*}\zeta &= \eta\end{align*}`;

        expect(flagged(body)).toEqual([]);
    });

    it("accepts symbols LaTeX also allows in text", () => {
        expect(flagged(String.raw`Wait\ldots see \S 2, \copyright\ 2026.`)).toEqual([]);
    });

    it("ignores the preamble, where macro bodies are math", () => {
        // `\newcommand{\angle}{\alpha}` sits in the preamble of every
        // document here and is never reported.
        expect(flagged("Plain text.")).toEqual([]);
    });

    it("ignores comments and verbatim", () => {
        const body = String.raw`% \alpha in a comment
\verb|\beta| and \begin{verbatim}
\gamma
\end{verbatim}`;

        expect(flagged(body)).toEqual([]);
    });

    it("checks a whole file that has no document environment", () => {
        // A chapter pulled in with \input has no \begin{document}.
        expect(
            findTextModeMath(String.raw`\section{One} Let \pi be`).map((c) => c.name),
        ).toEqual(["pi"]);
    });
});
