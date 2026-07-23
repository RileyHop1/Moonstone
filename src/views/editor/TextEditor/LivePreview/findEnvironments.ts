/**
 * Pure scanner for LaTeX `\begin{...}` / `\end{...}` environment pairs.
 */

/** One matched environment in the document. */
export interface EnvRange {
    /** The environment name, e.g. `document` or `equation`. */
    readonly name: string;
    /** Start offset of the `\begin{...}` token. */
    readonly from: number;
    /** End offset of the `\end{...}` token. */
    readonly to: number;
    /** End offset of the `\begin{...}` token itself. */
    readonly beginTo: number;
    /** Start offset of the `\end{...}` token itself. */
    readonly endFrom: number;
}

/** Matches `\begin{name}` and `\end{name}` tokens. */
const ENV_TOKEN_PATTERN = /\\(begin|end)\{([a-zA-Z*]+)\}/g;

/** A `\begin` token waiting for its matching `\end`. */
interface OpenEnvironment {
    readonly name: string;
    readonly from: number;
    readonly beginTo: number;
}

/**
 * Finds every properly nested environment pair in the document.
 *
 * Malformed input degrades gracefully: an `\end` that does not match
 * the innermost open `\begin` is ignored, and unclosed `\begin`s are
 * dropped — their source simply stays visible.
 *
 * @param docText - The full document text.
 * @returns All matched environments, sorted by start position.
 */
export function findEnvironments(docText: string): readonly EnvRange[] {
    const environments: EnvRange[] = [];
    const openStack: OpenEnvironment[] = [];

    for (const match of docText.matchAll(ENV_TOKEN_PATTERN)) {
        const [token, keyword, name] = match;
        const tokenStart = match.index;
        if (keyword === undefined || name === undefined || tokenStart === undefined) continue;

        if (keyword === "begin") {
            openStack.push({
                name,
                from: tokenStart,
                beginTo: tokenStart + token.length,
            });
            continue;
        }

        const innermost = openStack[openStack.length - 1];

        // An \end must close the innermost open environment; anything
        // else is malformed LaTeX and is left un-rendered.
        if (!innermost || innermost.name !== name) continue;

        openStack.pop();
        environments.push({
            name,
            from: innermost.from,
            to: tokenStart + token.length,
            beginTo: innermost.beginTo,
            endFrom: tokenStart,
        });
    }

    return environments.sort((a, b) => a.from - b.from);
}
