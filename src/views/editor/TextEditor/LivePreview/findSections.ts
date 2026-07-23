/**
 * Pure scanner for LaTeX sectioning commands (`\section{...}`,
 * `\subsection{...}`, `\subsubsection{...}` and starred variants).
 */

import { findGroupEnd } from "./braces";

/** One sectioning command found in the document. */
export interface SectionRange {
    /** Heading level: 1 = section, 2 = subsection, 3 = subsubsection. */
    readonly level: 1 | 2 | 3;
    /** Start offset of the command, including the backslash. */
    readonly from: number;
    /** End offset, just past the closing `}`. */
    readonly to: number;
    /** Start offset of the title, just past the opening `{`. */
    readonly contentFrom: number;
    /** End offset of the title, at the closing `}`. */
    readonly contentTo: number;
}

/** Matches the head of a sectioning command up to its opening brace. */
const SECTION_PATTERN = /\\(section|subsection|subsubsection)\*?\{/g;

/** Command name → heading level. */
const SECTION_LEVELS: Record<string, 1 | 2 | 3> = {
    section: 1,
    subsection: 2,
    subsubsection: 3,
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
