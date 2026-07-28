/**
 * Collects the macros a document defines for itself, so KaTeX can
 * render maths that uses them.
 *
 * Real papers define shorthands in the preamble — `\dmodel`, `\mc`,
 * `\argmax` — and then use them everywhere. KaTeX runs with
 * `throwOnError: false`, which means an unknown command does **not**
 * fail: it is painted in KaTeX's error colour and rendering continues.
 * So without this the maths looks rendered while a red `\dmodel` sits
 * in the middle of it, and nothing anywhere reports a problem. Thirty-six
 * of them in one arXiv paper is what prompted this.
 *
 * Only the definition forms KaTeX can actually accept are collected.
 * `\newcommand` bodies are passed through verbatim, including their
 * `#1` parameters, which KaTeX understands.
 */

import { findGroupEnd } from "./braces";

/** Macro definitions, in the shape KaTeX's `macros` option expects. */
export type MacroTable = Readonly<Record<string, string>>;

/**
 * The commands that introduce a definition.
 *
 * `\def` is deliberately absent: its parameter-text syntax
 * (`\def\foo#1.#2{…}`) is not what KaTeX's macro table accepts, and a
 * half-understood definition renders worse than an unknown command.
 */
const DEFINITION_COMMANDS = ["newcommand", "renewcommand", "providecommand"] as const;

/**
 * Reads a macro name, accepting both `{\name}` and a bare `\name`.
 *
 * `\newcommand{\vec}{…}` and `\newcommand\vec{…}` are both ordinary
 * LaTeX and both appear in real preambles.
 *
 * @param text - The document text.
 * @param at - Index just past the definition command.
 * @returns The name (with backslash) and where it ended, or null.
 */
function readMacroName(text: string, at: number): { name: string; end: number } | null {
    let index = at;
    while (index < text.length && /\s/.test(text[index] ?? "")) index += 1;

    const braced = text[index] === "{";
    if (braced) index += 1;

    if (text[index] !== "\\") return null;

    const nameMatch = /^\\[a-zA-Z]+\*?/.exec(text.slice(index));
    if (!nameMatch) return null;

    let end = index + nameMatch[0].length;

    if (braced) {
        while (end < text.length && /\s/.test(text[end] ?? "")) end += 1;
        if (text[end] !== "}") return null;
        end += 1;
    }

    return { name: nameMatch[0], end };
}

/**
 * Skips the optional `[n]` and `[default]` arguments of a definition.
 *
 * @param text - The document text.
 * @param at - Index just past the macro name.
 * @returns Index of the body's opening brace, or null when absent.
 */
function skipOptionalArguments(text: string, at: number): number | null {
    let index = at;

    for (;;) {
        while (index < text.length && /\s/.test(text[index] ?? "")) index += 1;

        if (text[index] === "[") {
            const close = text.indexOf("]", index);
            if (close < 0) return null;
            index = close + 1;
            continue;
        }

        return text[index] === "{" ? index : null;
    }
}

/**
 * Finds every macro a document defines.
 *
 * Later definitions win, which mirrors `\renewcommand` overriding an
 * earlier `\newcommand`.
 *
 * @param text - The document text, ideally with comments masked.
 * @returns The macros, keyed by name including the backslash.
 */
export function findMacros(text: string): MacroTable {
    const macros: Record<string, string> = {};

    // One pass over all the definition forms, so they are applied in
    // the order the document writes them — which is what makes
    // `\renewcommand` overriding an earlier definition work.
    const pattern = new RegExp(
        `\\\\(${DEFINITION_COMMANDS.join("|")}|DeclareMathOperator)(\\*?)`,
        "g",
    );

    for (const match of text.matchAll(pattern)) {
        const isOperator = match[1] === "DeclareMathOperator";
        const starred = match[2] === "*";

        const name = readMacroName(text, (match.index ?? 0) + match[0].length);
        if (!name) continue;

        const bodyStart = skipOptionalArguments(text, name.end);
        if (bodyStart === null) continue;

        // Brace matching rather than a regex: bodies routinely nest,
        // as in `\newcommand{\dmodel}{d_{\text{model}}}`.
        const bodyEnd = findGroupEnd(text, bodyStart);
        if (bodyEnd < 0) continue;

        const body = text.slice(bodyStart + 1, bodyEnd);

        // `\DeclareMathOperator{\argmax}{arg\,max}` declares an
        // operator, which KaTeX spells `\operatorname`.
        macros[name.name] = isOperator
            ? `\\operatorname${starred ? "*" : ""}{${body}}`
            : body;
    }

    return macros;
}
