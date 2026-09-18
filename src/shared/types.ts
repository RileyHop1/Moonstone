/**
 * Shared domain types used across Moonstone's pages and the Tauri
 * backend boundary.
 */

/**
 * Outcome of an operation that can fail, as a discriminated union so
 * callers must handle both branches.
 */
export type Result<T> =
    { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** Metadata for one project, as returned by the `list_projects` command. */
export interface ProjectInfo {
    readonly name: string;
    readonly path: string;
    /** RFC3339 timestamp of the last filesystem modification. */
    readonly lastModified: string;
    /** Number of entries directly inside the project directory. */
    readonly fileCount: number;
}

/**
 * Settings as the backend stores them, straight off the IPC boundary.
 *
 * Every field is `unknown` on purpose. These values come from a JSON
 * file on disk that an older build — or the user with a text editor —
 * may have written, so the only honest type for them is "no idea yet".
 * `normalizeSettings` is what turns them into a usable
 * {@link AppSettings}; declaring them as `string`/`boolean` here would
 * make its guards look redundant and invite someone to delete them.
 */
export interface StoredSettings {
    readonly theme: unknown;
    readonly editorFontSize: unknown;
    readonly modalMode: unknown;
    readonly spellCheckEnabled: unknown;
    readonly lineNumberMode: unknown;
    readonly showDiagnostics: unknown;
    readonly openPdfAfterCompile: unknown;
}

/**
 * A starting point offered by the new-project dialog, as returned by
 * the `list_templates` command.
 */
export interface TemplateInfo {
    /** Identifier passed back to `create_project`. */
    readonly id: string;
    /** Name shown in the dialog. */
    readonly name: string;
    /** One line on what the template is for. */
    readonly description: string;
    /** How many files the template creates. */
    readonly fileCount: number;
}

/**
 * One citable entry from the project's `.bib` files, as returned by
 * the `list_references` command.
 */
export interface Reference {
    /** Citation key, as written in `\cite{…}`. */
    readonly key: string;
    /** Entry type (`article`, `book`, …), lowercased. */
    readonly entryType: string;
    /** Title, or empty when the entry has none. */
    readonly title: string;
    /** Authors as written in the entry, one per name. */
    readonly authors: readonly string[];
    /** Publication year, or empty when absent. */
    readonly year: string;
    /** Absolute path of the `.bib` file the entry came from. */
    readonly sourcePath: string;
    /** File name of that `.bib` file, for display. */
    readonly sourceName: string;
}

/**
 * One node of a project's file tree, discriminated on `kind` to match
 * the backend's serde `tag = "kind"` serialization.
 */
export type FileNode =
    | {
          readonly kind: "file";
          readonly name: string;
          readonly path: string;
      }
    | {
          readonly kind: "directory";
          readonly name: string;
          readonly path: string;
          readonly children: readonly FileNode[];
      };

// Themes live in their own module: the list is runtime data (labels,
// and whether each palette is dark), not just a type. Re-exported here
// so `AppSettings` below and existing importers keep working.
import type { Theme } from "./themes";

export type { Theme };

/**
 * How the editor renders its document:
 * - `source` — raw LaTeX, nothing rendered, editable.
 * - `live` — Obsidian-style preview that reveals source at the cursor.
 * - `readonly` — everything rendered, no reveal, not editable.
 */
export type ViewMode = "source" | "live" | "readonly";

/**
 * Modal editing style layered over the editor. Mutually exclusive:
 * - `none` — ordinary editing.
 * - `vim` — Vim keybindings.
 * - `helix` — Helix (selection-first) keybindings.
 */
export type ModalMode = "none" | "vim" | "helix";

/**
 * How the gutter numbers lines:
 * - `absolute` — the line's own number.
 * - `relative` — distance from the cursor, which the cursor's own line
 *   still shows absolutely.
 * - `mixed` — absolute while inserting text, relative otherwise.
 */
export type LineNumberMode = "absolute" | "relative" | "mixed";

/** User preferences persisted by the backend. */
export interface AppSettings {
    readonly theme: Theme;
    /** Editor font size in pixels. */
    readonly editorFontSize: number;
    /** Modal editing style applied to the editor. */
    readonly modalMode: ModalMode;
    /** Whether prose is spell checked. */
    readonly spellCheckEnabled: boolean;
    /** How the gutter numbers lines. */
    readonly lineNumberMode: LineNumberMode;
    /** Whether the editor's diagnostic overlay is shown. */
    readonly showDiagnostics: boolean;
    /** Whether compiling opens the PDF in a pane beside the source. */
    readonly openPdfAfterCompile: boolean;
}

/** How serious a problem the LaTeX engine reported is. */
export type DiagnosticSeverity = "error" | "warning";

/** One problem the LaTeX engine reported while compiling. */
export interface CompileDiagnostic {
    readonly severity: DiagnosticSeverity;
    /**
     * The file the engine named, relative to the project, or empty when
     * it reported no location.
     *
     * **May lack an extension.** TeX reports the name as written, so
     * `\input{chapters/one}` yields `chapters/one`. Resolving that to a
     * real file is the reader's job.
     */
    readonly file: string;
    /** 1-based line, or null when the engine reported none. */
    readonly line: number | null;
    readonly message: string;
}

/** What one compilation produced. */
export interface CompileOutcome {
    /**
     * Absolute path of the PDF, or null when none was produced.
     *
     * A PDF and errors are not mutually exclusive: the engine carries on
     * past a recoverable error, so a broken document usually yields a
     * best-effort PDF *and* a list of what is wrong.
     */
    readonly pdfPath: string | null;
    readonly diagnostics: readonly CompileDiagnostic[];
    /** Absolute path of the engine log, for what the parser could not
     * turn into a diagnostic. */
    readonly logPath: string | null;
}

/** What exporting a PDF did. */
export interface ExportOutcome {
    /** Where the PDF was copied, or null when the user cancelled. */
    readonly exportedTo: string | null;
}

/**
 * Lifecycle of asynchronously loaded data, so components render
 * loading/error/ready states exhaustively instead of juggling flags.
 */
export type LoadState<T> =
    | { readonly status: "loading" }
    | { readonly status: "error"; readonly message: string }
    | { readonly status: "ready"; readonly data: T };

/**
 * Compile-time exhaustiveness check for discriminated unions.
 *
 * @param value - The value that should be unreachable.
 * @returns Never returns; always throws.
 */
export function assertNever(value: never): never {
    throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
