/**
 * The file types Moonstone can create, open and save.
 *
 * Mirrors `EDITABLE_EXTENSIONS` in `src-tauri/src/file_manager.rs`,
 * which is the authority — this list drives the new-file dialog and
 * lets a bad choice be caught before a round trip.
 */

/** One selectable file type. */
export interface FileType {
    /** Extension without the dot, as the backend expects it. */
    readonly extension: string;
    /** What the type is for, shown in the dialog. */
    readonly label: string;
}

/**
 * Selectable types, most commonly used first so the default is the
 * right answer nearly always.
 */
export const FILE_TYPES: readonly FileType[] = [
    { extension: "tex", label: "LaTeX document (.tex)" },
    { extension: "bib", label: "Bibliography (.bib)" },
    { extension: "sty", label: "Package (.sty)" },
    { extension: "cls", label: "Document class (.cls)" },
    { extension: "bst", label: "Bibliography style (.bst)" },
    { extension: "tikz", label: "TikZ picture (.tikz)" },
    { extension: "txt", label: "Plain text (.txt)" },
    { extension: "md", label: "Markdown (.md)" },
    { extension: "csv", label: "Table data (.csv)" },
    { extension: "ltx", label: "LaTeX document (.ltx)" },
    { extension: "def", label: "Package definitions (.def)" },
    { extension: "cfg", label: "Package configuration (.cfg)" },
    { extension: "dtx", label: "Documented source (.dtx)" },
    { extension: "ins", label: "Package installer (.ins)" },
];

/** The type a new file gets unless the user picks another. */
export const DEFAULT_FILE_EXTENSION = "tex";

/**
 * Reports whether an extension is one Moonstone handles.
 *
 * @param extension - Extension without the dot.
 * @returns True when the extension is supported.
 */
export function isEditableExtension(extension: string): boolean {
    const normalized = extension.toLowerCase();
    return FILE_TYPES.some((type) => type.extension === normalized);
}
