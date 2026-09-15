/**
 * What the editor should do with a file, decided by its extension.
 *
 * The backend accepts fourteen text formats, but the editor treated
 * every one of them as LaTeX: `latex()` was applied unconditionally, so
 * a `$` in a `.csv` became inline maths, `\alpha` in a `.txt` became α,
 * and the LaTeX linter reported on content that was never LaTeX.
 * "Editable" meant "the backend will store it", not "Moonstone
 * understands it".
 *
 * Three profiles cover all fourteen. The distinction that matters is
 * the middle one: a `.sty` or `.cls` *is* LaTeX and deserves
 * highlighting, but it is LaTeX **source** — macro definitions — so
 * rendering it is wrong. A `\textbf{...}` inside a `\newcommand` body
 * is not text to embolden, and an environment there should not be
 * boxed.
 *
 * Pure and extension-driven, so it can be tested without an editor and
 * a new file type is one table entry.
 */

/** Which of the three treatments a file gets. */
export type EditorProfileId = "latex" | "latex-source" | "plain";

/** What the editor turns on for a file. */
export interface EditorProfile {
    readonly id: EditorProfileId;
    /** LaTeX syntax highlighting, bracket closing and tooltips. */
    readonly usesLatexLanguage: boolean;
    /** The LaTeX linter. */
    readonly usesLinting: boolean;
    /** Live preview: rendered maths, environments, chips and symbols. */
    readonly usesPreview: boolean;
}

/** A LaTeX document: everything on. */
const FULL_LATEX: EditorProfile = {
    id: "latex",
    usesLatexLanguage: true,
    usesLinting: true,
    usesPreview: true,
};

/** LaTeX source — packages and classes. Highlighted, never rendered. */
const LATEX_SOURCE: EditorProfile = {
    id: "latex-source",
    usesLatexLanguage: true,
    usesLinting: true,
    usesPreview: false,
};

/** Not LaTeX at all: plain text, left entirely alone. */
const PLAIN_TEXT: EditorProfile = {
    id: "plain",
    usesLatexLanguage: false,
    usesLinting: false,
    usesPreview: false,
};

/**
 * Which profile each extension gets, lowercase and without the dot.
 *
 * `.bib` is plain text *for now*. It is structured data rather than
 * prose, and treating it as LaTeX is what made `$` in a title become
 * maths. Entry-aware highlighting and field validation are the natural
 * follow-on, and that is when it earns a profile of its own.
 */
const PROFILES: Readonly<Record<string, EditorProfile>> = {
    tex: FULL_LATEX,
    ltx: FULL_LATEX,

    sty: LATEX_SOURCE,
    cls: LATEX_SOURCE,
    bst: LATEX_SOURCE,
    dtx: LATEX_SOURCE,
    ins: LATEX_SOURCE,
    def: LATEX_SOURCE,
    cfg: LATEX_SOURCE,
    tikz: LATEX_SOURCE,

    bib: PLAIN_TEXT,
    txt: PLAIN_TEXT,
    md: PLAIN_TEXT,
    csv: PLAIN_TEXT,
};

/**
 * The profile for a file extension.
 *
 * Anything unrecognised gets plain text rather than the LaTeX
 * treatment: applying a LaTeX parser to a file nobody claimed is how
 * the original problem happened, and doing nothing is the safe default.
 *
 * @param extension - Extension without the dot; case is ignored.
 * @returns The profile to configure the editor with.
 */
export function editorProfileForExtension(extension: string): EditorProfile {
    return PROFILES[extension.toLowerCase()] ?? PLAIN_TEXT;
}

/**
 * The profile for a file path.
 *
 * @param path - The file's path, or null when no file is open.
 * @returns The profile; plain text when there is no file or no
 *   extension to go on.
 */
export function editorProfileForPath(path: string | null): EditorProfile {
    if (path === null) return PLAIN_TEXT;

    const name = path.split(/[/\\]/).pop() ?? "";
    const dot = name.lastIndexOf(".");

    // A leading dot is a hidden file, not an extension: `.gitignore`
    // has no type, it *is* the name.
    if (dot <= 0) return PLAIN_TEXT;

    return editorProfileForExtension(name.slice(dot + 1));
}

/** The profile an editor uses when the host does not say otherwise. */
export const DEFAULT_EDITOR_PROFILE = FULL_LATEX;
