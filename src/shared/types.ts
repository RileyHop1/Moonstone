/**
 * Shared domain types used across Moonstone's pages and the Tauri
 * backend boundary.
 */

/**
 * Outcome of an operation that can fail, as a discriminated union so
 * callers must handle both branches.
 */
export type Result<T> =
    | { readonly ok: true; readonly data: T }
    | { readonly ok: false; readonly error: string };

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

/** Color theme of the application. */
export type Theme = "dark" | "light";

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

/** User preferences persisted by the backend. */
export interface AppSettings {
    readonly theme: Theme;
    /** Editor font size in pixels. */
    readonly editorFontSize: number;
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
