/**
 * Math-only commands written in running text, such as a bare `\alpha`.
 *
 * The live preview happily draws these as glyphs, but LaTeX refuses to
 * compile them ("Missing $ inserted"), so a document could look finished
 * and still fail to build. This finds them so the editor can say so.
 *
 * Deliberately narrow: only commands from the preview's own symbol table,
 * and only in the document body. The preamble is full of macro
 * definitions whose bodies are math, and flagging those would be noise.
 */

import { findEnvironments } from "./findEnvironments";
import type { EnvRange } from "./findEnvironments";
import { findMathRanges } from "./findMath";
import type { MathRange } from "./findMath";
import { findInertRegions, maskChunk } from "./inertRegions";
import type { Interval } from "./interval";
import { findSymbolRanges, TEXT_MODE_SYMBOLS } from "./symbols";

/** Environments whose whole body is math, starred forms included. */
const MATH_MODE_ENVIRONMENTS: ReadonlySet<string> = new Set(
    [
        "equation",
        "align",
        "alignat",
        "gather",
        "multline",
        "flalign",
        "eqnarray",
        "displaymath",
        "math",
    ].flatMap((name) => [name, `${name}*`]),
);

/** `\(…\)` and `\[…\]`, which {@link findMathRanges} does not look for. */
const BRACKET_MATH_PATTERN = /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;

/** One math-only command found outside math. */
export interface TextModeMathCommand extends Interval {
    /** The command name, without its backslash. */
    readonly name: string;
}

/**
 * Finds math-only commands in text mode, given scans already made.
 *
 * @param scanText - The document with comments and verbatim masked.
 * @param math - Its `$…$` and `$$…$$` ranges.
 * @param environments - Its environments.
 * @returns The offending commands, in document order.
 */
export function findTextModeMathIn(
    scanText: string,
    math: readonly MathRange[],
    environments: readonly EnvRange[],
): readonly TextModeMathCommand[] {
    const bodyStart = /\\begin\{document\}/.exec(scanText)?.index ?? 0;
    const excluded: readonly Interval[] = [
        ...math,
        ...environments.filter((environment) => MATH_MODE_ENVIRONMENTS.has(environment.name)),
        ...Array.from(scanText.matchAll(BRACKET_MATH_PATTERN), (match) => ({
            from: match.index,
            to: match.index + match[0].length,
        })),
    ];

    return findSymbolRanges(scanText.slice(bodyStart), bodyStart, excluded)
        .map(({ from, to }) => ({ from, to, name: scanText.slice(from + 1, to) }))
        .filter(({ name }) => !TEXT_MODE_SYMBOLS.has(name));
}

/**
 * Finds math-only commands in text mode.
 *
 * @param docText - The whole document.
 * @returns The offending commands, in document order.
 */
export function findTextModeMath(docText: string): readonly TextModeMathCommand[] {
    const scanText = maskChunk(docText, 0, findInertRegions(docText));

    return findTextModeMathIn(
        scanText,
        findMathRanges(scanText, 0),
        findEnvironments(scanText),
    );
}
