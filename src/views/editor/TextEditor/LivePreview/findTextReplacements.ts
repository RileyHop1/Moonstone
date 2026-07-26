/**
 * Pure scanner for LaTeX's text-mode spellings: escaped punctuation
 * (`\&`), ligature dashes (`---`), quote pairs (` `` `), tie spaces
 * (`~`) and accents (`\"o`).
 *
 * These are the least glamorous part of the preview and the most
 * pervasive — ordinary prose is full of them, and leaving them as
 * source is what makes a live preview still look like source.
 *
 * Scanned in one left-to-right pass rather than by regex alternation,
 * because precedence between these forms is positional: `---` must
 * beat `--`, and a backslash must consume whatever follows it before
 * `~` can be read as a tie.
 */

/** One span of source that renders as different text. */
export interface TextReplacement {
    /** Start offset of the source span. */
    readonly from: number;
    /** End offset of the source span. */
    readonly to: number;
    /** The text to display in its place. */
    readonly text: string;
}

/** A half-open interval used for exclusion. */
interface Interval {
    readonly from: number;
    readonly to: number;
}

/**
 * Punctuation that LaTeX requires be escaped, rendering as itself.
 */
const ESCAPED_CHARACTERS: Readonly<Record<string, string>> = {
    "&": "&",
    "%": "%",
    $: "$",
    _: "_",
    "#": "#",
    "{": "{",
    "}": "}",
};

/**
 * Accent commands written directly against their letter (`\"o`) or
 * braced (`\"{o}`), mapped to the combining mark they apply.
 */
const SYMBOL_ACCENTS: Readonly<Record<string, string>> = {
    "'": "́", // acute
    "`": "̀", // grave
    '"': "̈", // diaeresis
    "^": "̂", // circumflex
    "~": "̃", // tilde
    "=": "̄", // macron
    ".": "̇", // dot above
};

/**
 * Accent commands named with a letter, which must be braced (`\c{c}`)
 * so they cannot be confused with longer commands — `\verb` is not a
 * caron, and `\ref` is not a ring.
 */
const LETTER_ACCENTS: Readonly<Record<string, string>> = {
    c: "̧", // cedilla
    v: "̌", // caron
    u: "̆", // breve
    H: "̋", // double acute
    r: "̊", // ring above
    d: "̣", // dot below
    b: "̱", // macron below
    k: "̨", // ogonek
};

/** A match starting at the current index. */
interface Match {
    /** How many source characters it consumes. */
    readonly length: number;
    /** The text to render. */
    readonly text: string;
}

/**
 * Scans text for renderable text-mode spellings.
 *
 * Matches inside `exclude` (math, where KaTeX owns the source) are
 * skipped, as is anything the scanner does not recognise — an unknown
 * command's letters are consumed so `\alpha` is never mistaken for an
 * accent.
 *
 * @param text - The text to scan.
 * @param offset - Document position of `text[0]`.
 * @param exclude - Document-position intervals to skip.
 * @returns The replacements found, in order of appearance.
 */
export function findTextReplacements(
    text: string,
    offset: number,
    exclude: readonly Interval[],
): readonly TextReplacement[] {
    const replacements: TextReplacement[] = [];
    let index = 0;

    while (index < text.length) {
        const match = matchAt(text, index);

        if (!match) {
            index += 1;
            continue;
        }

        const from = offset + index;
        const to = from + match.length;

        if (!overlapsExcluded(exclude, from, to)) {
            replacements.push({ from, to, text: match.text });
        }

        index += match.length;
    }

    return replacements;
}

/**
 * Applies every replacement to a string.
 *
 * For text a widget renders itself rather than decorates — a chip's
 * locator, a table cell — where the decoration pipeline cannot reach
 * but the author still expects `p.~3` to read as "p. 3".
 *
 * @param source - The text to convert.
 * @returns The text as it should be displayed.
 */
export function applyTextReplacements(source: string): string {
    let result = "";
    let cursor = 0;

    for (const replacement of findTextReplacements(source, 0, [])) {
        result += source.slice(cursor, replacement.from) + replacement.text;
        cursor = replacement.to;
    }

    return result + source.slice(cursor);
}

/**
 * Reports whether a span intersects any excluded interval.
 *
 * @param exclude - The intervals to test against.
 * @param from - Span start.
 * @param to - Span end.
 * @returns True on any intersection.
 */
function overlapsExcluded(
    exclude: readonly Interval[],
    from: number,
    to: number,
): boolean {
    return exclude.some((interval) => interval.from < to && interval.to > from);
}

/**
 * Matches whatever renderable spelling starts at `index`.
 *
 * @param text - The text being scanned.
 * @param index - Where to match.
 * @returns The match, or null when nothing renderable starts here.
 */
function matchAt(text: string, index: number): Match | null {
    const char = text[index];

    if (char === "\\") return matchCommand(text, index);

    // `---` must be tried before `--`, longest first.
    if (char === "-") {
        if (text.startsWith("---", index)) return { length: 3, text: "—" };
        if (text.startsWith("--", index)) return { length: 2, text: "–" };
        return null;
    }

    if (text.startsWith("``", index)) return { length: 2, text: "“" };
    if (text.startsWith("''", index)) return { length: 2, text: "”" };

    // A tie is a non-breaking space; rendering it as one is the whole
    // point — the author should see the spacing they wrote.
    if (char === "~") return { length: 1, text: " " };

    return null;
}

/**
 * Matches a backslash command at `index`.
 *
 * Always returns a match or null having decided the whole command, so
 * the caller never re-reads a command's letters as something else.
 *
 * @param text - The text being scanned.
 * @param index - Position of the backslash.
 * @returns The match, or null.
 */
function matchCommand(text: string, index: number): Match | null {
    const next = text[index + 1];
    if (next === undefined) return null;

    // `\\` is a line break; consuming both stops the second backslash
    // from being read as the start of a command.
    if (next === "\\") return null;

    const escaped = ESCAPED_CHARACTERS[next];
    if (escaped !== undefined) return { length: 2, text: escaped };

    const symbolAccent = SYMBOL_ACCENTS[next];
    if (symbolAccent !== undefined) return matchAccent(text, index, 2, symbolAccent, true);

    const letterAccent = LETTER_ACCENTS[next];
    if (letterAccent !== undefined) return matchAccent(text, index, 2, letterAccent, false);

    return null;
}

/**
 * Matches an accent's argument, braced or bare.
 *
 * @param text - The text being scanned.
 * @param index - Position of the backslash.
 * @param headLength - Length of the command itself.
 * @param mark - The combining mark to apply.
 * @param allowBare - Whether the letter may follow without braces.
 * @returns The match, or null when no single letter follows.
 */
function matchAccent(
    text: string,
    index: number,
    headLength: number,
    mark: string,
    allowBare: boolean,
): Match | null {
    const afterHead = index + headLength;

    if (text[afterHead] === "{" && text[afterHead + 2] === "}") {
        const letter = text[afterHead + 1];
        if (letter && isLetter(letter)) {
            return { length: headLength + 3, text: compose(letter, mark) };
        }
        return null;
    }

    if (!allowBare) return null;

    const letter = text[afterHead];
    if (letter && isLetter(letter)) {
        return { length: headLength + 1, text: compose(letter, mark) };
    }

    return null;
}

/**
 * Reports whether a character is an ASCII letter.
 *
 * @param char - The character to test.
 * @returns True for A-Z or a-z.
 */
function isLetter(char: string): boolean {
    return /^[a-zA-Z]$/.test(char);
}

/**
 * Applies a combining mark to a base letter.
 *
 * Normalized so the result is a single precomposed character wherever
 * Unicode has one, which renders far better than a combining pair.
 *
 * @param letter - The base letter.
 * @param mark - The combining mark.
 * @returns The accented character.
 */
function compose(letter: string, mark: string): string {
    return `${letter}${mark}`.normalize("NFC");
}
