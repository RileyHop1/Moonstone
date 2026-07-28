/**
 * Pure scanner for LaTeX sectioning commands (`\section{...}` down to
 * `\subparagraph{...}`, and starred variants).
 */

import { findGroupEnd } from "./braces";

/** Heading depth, from `\section` (1) to `\subparagraph` (5). */
export type SectionLevel = 1 | 2 | 3 | 4 | 5;

/** One sectioning command found in the document. */
export interface SectionRange {
    /** Heading level: 1 = section … 5 = subparagraph. */
    readonly level: SectionLevel;
    /** Start offset of the command, including the backslash. */
    readonly from: number;
    /** End offset, just past the closing `}`. */
    readonly to: number;
    /** Start offset of the title, just past the opening `{`. */
    readonly contentFrom: number;
    /** End offset of the title, at the closing `}`. */
    readonly contentTo: number;
}

/**
 * Matches the head of a sectioning command up to its opening brace.
 *
 * Longest names first: alternation is tried left to right at the same
 * start position, so `section` listed ahead of `subsection` would still
 * be safe here (they differ at the first character after the
 * backslash), but ordering by length keeps that from being an accident
 * waiting on the next command added.
 */
const SECTION_PATTERN =
    /\\(subsubsection|subsection|section|subparagraph|paragraph)\*?\{/g;

/** Command name → heading level. */
const SECTION_LEVELS: Record<string, SectionLevel> = {
    section: 1,
    subsection: 2,
    subsubsection: 3,
    // `\paragraph` and `\subparagraph` are real sectioning commands,
    // and papers use them freely — they rendered as raw source until
    // the arXiv validation turned them up.
    paragraph: 4,
    subparagraph: 5,
};

/**
 * Finds every renderable sectioning command in the document.
 *
 * Skipped (the source stays raw): escaped commands (`\\section`),
 * unclosed braces, titles spanning a line break, and empty titles —
 * half-typed headings must stay visible as source.
 *
 * @param docText - The full document text.
 * @returns The sectioning commands found, in order of appearance.
 */
export function findSections(docText: string): readonly SectionRange[] {
    const sections: SectionRange[] = [];

    for (const match of docText.matchAll(SECTION_PATTERN)) {
        const commandName = match[1];
        const matchStart = match.index;
        if (commandName === undefined || matchStart === undefined) continue;

        const level = SECTION_LEVELS[commandName];
        if (level === undefined) continue;

        // `\\section` is a line break followed by the word "section".
        if (matchStart > 0 && docText[matchStart - 1] === "\\") continue;

        const openBrace = matchStart + match[0].length - 1;
        const closeBrace = findGroupEnd(docText, openBrace);
        if (closeBrace === -1) continue;

        const title = docText.slice(openBrace + 1, closeBrace);
        if (title.includes("\n")) continue;
        if (title.trim() === "") continue;

        sections.push({
            level,
            from: matchStart,
            to: closeBrace + 1,
            contentFrom: openBrace + 1,
            contentTo: closeBrace,
        });
    }

    return sections;
}
