/**
 * The file types Moonstone can create, open and save.
 *
 * Mirrors `EDITABLE_EXTENSIONS` in `src-tauri/src/file_manager.rs`,
 * which is the authority — this list drives the new-file dialog and
 * lets a bad choice be caught before a round trip.
 */

import { basename, join } from "./paths";

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

/**
 * Reports whether a path names a PDF, which panes show in a viewer
 * rather than an editor.
 *
 * @param path - Any file path.
 * @returns True for a `.pdf` file, in any letter case.
 */
export function isPdfPath(path: string): boolean {
    return path.toLowerCase().endsWith(".pdf");
}

/**
 * Names the PDF a document compiles to: the document's stem, at the
 * project root — even for a document in a subdirectory.
 *
 * Mirrors `publish_pdf` in `src-tauri/src/compiler.rs`, which is where
 * the file actually gets written.
 *
 * @param projectPath - Absolute path of the project directory.
 * @param documentPath - Absolute path of the source document.
 * @returns The path its compiled PDF lands at.
 */
export function compiledPdfPath(projectPath: string, documentPath: string): string {
    const name = basename(documentPath);
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;

    return join(projectPath, `${stem}.pdf`);
}
