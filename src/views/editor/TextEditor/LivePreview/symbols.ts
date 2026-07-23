/**
 * Special-character rendering: maps LaTeX commands (`\alpha`, `\leq`,
 * …) to their unicode glyphs and scans text for occurrences.
 */

/** LaTeX command name (no backslash) → unicode glyph. */
export const SYMBOLS: Readonly<Record<string, string>> = {
    // Greek (lowercase)
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    epsilon: "ε",
    zeta: "ζ",
    eta: "η",
    theta: "θ",
    iota: "ι",
    kappa: "κ",
    lambda: "λ",
    mu: "μ",
    nu: "ν",
    xi: "ξ",
    pi: "π",
    rho: "ρ",
    sigma: "σ",
    tau: "τ",
    upsilon: "υ",
    phi: "φ",
    chi: "χ",
    psi: "ψ",
    omega: "ω",
    // Greek (uppercase)
    Gamma: "Γ",
    Delta: "Δ",
    Theta: "Θ",
    Lambda: "Λ",
    Xi: "Ξ",
    Pi: "Π",
    Sigma: "Σ",
    Upsilon: "Υ",
    Phi: "Φ",
    Psi: "Ψ",
    Omega: "Ω",
    // Operators & relations
    times: "×",
    div: "÷",
    pm: "±",
    mp: "∓",
    cdot: "·",
    infty: "∞",
    leq: "≤",
    geq: "≥",
    neq: "≠",
    approx: "≈",
    equiv: "≡",
    sim: "∼",
    propto: "∝",
    // Arrows
    rightarrow: "→",
    leftarrow: "←",
    leftrightarrow: "↔",
    Rightarrow: "⇒",
    Leftarrow: "⇐",
    Leftrightarrow: "⇔",
    // Sets & logic
    forall: "∀",
    exists: "∃",
    in: "∈",
    notin: "∉",
    subset: "⊂",
    supset: "⊃",
    subseteq: "⊆",
    supseteq: "⊇",
    cup: "∪",
    cap: "∩",
    emptyset: "∅",
    // Misc
    nabla: "∇",
    partial: "∂",
    dots: "…",
    ldots: "…",
    cdots: "⋯",
    degree: "°",
};

/** One symbol occurrence found in the scanned text. */
export interface SymbolRange {
    /** Start of the command, including the backslash. */
    readonly from: number;
    /** End of the command. */
    readonly to: number;
    /** The unicode glyph to render. */
    readonly symbol: string;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/** Matches a backslash command made of letters. */
const COMMAND_PATTERN = /\\([a-zA-Z]+)/g;

/**
 * Scans text for renderable symbol commands.
 *
 * Commands inside `exclude` intervals (math segments — KaTeX renders
 * those itself) and commands preceded by a backslash (`\\alpha` is a
 * line break plus text) are skipped. Longer commands that merely start
 * with a known name (`\alphabet`) never match because the regex is
 * greedy.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip (math ranges).
 * @returns The symbol occurrences found, in order of appearance.
 */
export function findSymbolRanges(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly SymbolRange[] {
    const ranges: SymbolRange[] = [];

    for (const match of text.matchAll(COMMAND_PATTERN)) {
        const commandName = match[1];
        const matchStart = match.index;
        if (commandName === undefined || matchStart === undefined) continue;

        const symbol = SYMBOLS[commandName];
        if (symbol === undefined) continue;

        // `\\alpha` is a line break followed by the word "alpha".
        if (matchStart > 0 && text[matchStart - 1] === "\\") continue;

        const from = offset + matchStart;
        const to = from + match[0].length;

        if (exclude.some((interval) => interval.from < to && interval.to > from)) continue;

        ranges.push({ from, to, symbol });
    }

    return ranges;
}
