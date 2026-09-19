/**
 * Validators for everything the backend sends back.
 *
 * `invoke<T>()` is an unchecked cast. Every response — file trees,
 * project lists, bibliographies — was trusted to match its TypeScript
 * declaration at runtime purely because someone wrote a type parameter
 * at the call site. Nothing enforced it, so a malformed or
 * version-skewed response surfaced as `undefined.children` deep inside
 * a React render, a long way from the boundary it crossed.
 *
 * These are hand-written predicates rather than a schema library: the
 * shapes are few and small, and `Result` already exists to carry the
 * failure, so a dependency would buy nothing.
 *
 * Each returns `null` for anything it does not recognise. The caller
 * turns that into an ordinary, displayable error.
 */

import type {
    CompileDiagnostic,
    CompileOutcome,
    ExportOutcome,
    FileNode,
    PdfLocation,
    ProjectInfo,
    ProjectSettings,
    Reference,
    SourceLocation,
    StoredSettings,
    TemplateInfo,
} from "./types";

/** Turns unknown JSON into a value of a known shape, or null. */
export type Parser<T> = (value: unknown) => T | null;

/**
 * Whether a value is a plain object worth reading fields off.
 *
 * @param value - The value to test.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a string field.
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @returns The string, or null when absent or the wrong type.
 */
function stringField(source: Record<string, unknown>, key: string): string | null {
    const value = source[key];

    return typeof value === "string" ? value : null;
}

/**
 * Reads a finite-number field.
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @returns The number, or null when absent or not finite.
 */
function numberField(source: Record<string, unknown>, key: string): number | null {
    const value = source[key];

    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Applies a parser across an array.
 *
 * One bad entry fails the whole list rather than being skipped: a
 * silently shortened file tree or project list is harder to notice — and
 * harder to explain — than an error message.
 *
 * @param parse - The parser for one element.
 * @returns A parser for a readonly array of them.
 */
export function parseArrayOf<T>(parse: Parser<T>): Parser<readonly T[]> {
    return (value) => {
        if (!Array.isArray(value)) return null;

        const parsed: T[] = [];
        for (const entry of value as readonly unknown[]) {
            const item = parse(entry);
            if (item === null) return null;

            parsed.push(item);
        }

        return parsed;
    };
}

/** Accepts any value; for commands whose result is not inspected. */
export const parseUnknown: Parser<unknown> = (value) => value;

/**
 * Parses a command's `null` result.
 *
 * Tauri sends `null` for a command returning `()`, so anything else
 * means the backend and the frontend disagree about the command.
 *
 * @param value - The raw response.
 * @returns null on success — which is also the failure value, so this
 *   never reports a failure; the shape carries no information to check.
 */
export const parseNothing: Parser<null> = () => null;

/**
 * Parses a string response.
 *
 * @param value - The raw response.
 * @returns The string, or null.
 */
export const parseString: Parser<string> = (value) =>
    typeof value === "string" ? value : null;

/**
 * Parses one project's metadata.
 *
 * @param value - The raw response.
 * @returns The project, or null when the shape is wrong.
 */
export const parseProjectInfo: Parser<ProjectInfo> = (value) => {
    if (!isRecord(value)) return null;

    const name = stringField(value, "name");
    const path = stringField(value, "path");
    const lastModified = stringField(value, "lastModified");
    const fileCount = numberField(value, "fileCount");

    if (name === null || path === null || lastModified === null || fileCount === null) {
        return null;
    }

    return { name, path, lastModified, fileCount };
};

/**
 * Parses one template's metadata.
 *
 * @param value - The raw response.
 * @returns The template, or null when the shape is wrong.
 */
export const parseTemplateInfo: Parser<TemplateInfo> = (value) => {
    if (!isRecord(value)) return null;

    const id = stringField(value, "id");
    const name = stringField(value, "name");
    const description = stringField(value, "description");
    const fileCount = numberField(value, "fileCount");

    if (id === null || name === null || description === null || fileCount === null) {
        return null;
    }

    return { id, name, description, fileCount };
};

/**
 * Parses one bibliography entry.
 *
 * @param value - The raw response.
 * @returns The reference, or null when the shape is wrong.
 */
export const parseReference: Parser<Reference> = (value) => {
    if (!isRecord(value)) return null;

    const key = stringField(value, "key");
    const entryType = stringField(value, "entryType");
    const title = stringField(value, "title");
    const year = stringField(value, "year");
    const sourcePath = stringField(value, "sourcePath");
    const sourceName = stringField(value, "sourceName");
    const authors = parseArrayOf(parseString)(value.authors);

    if (
        key === null ||
        entryType === null ||
        title === null ||
        year === null ||
        sourcePath === null ||
        sourceName === null ||
        authors === null
    ) {
        return null;
    }

    return { key, entryType, title, authors, year, sourcePath, sourceName };
};

/**
 * Parses a file tree, recursively.
 *
 * @param value - The raw response.
 * @returns The node, or null when any part of the tree is malformed.
 */
export const parseFileNode: Parser<FileNode> = (value) => {
    if (!isRecord(value)) return null;

    const name = stringField(value, "name");
    const path = stringField(value, "path");
    const kind = value.kind;

    if (name === null || path === null) return null;

    if (kind === "file") return { kind, name, path };

    if (kind === "directory") {
        const children = parseArrayOf(parseFileNode)(value.children);
        if (children === null) return null;

        return { kind, name, path, children };
    }

    return null;
};

/**
 * Parses stored settings.
 *
 * Only the object-ness is checked here: every field is `unknown` by
 * design, and `normalizeSettings` does the narrowing — a settings file
 * written by an older build should load with the fields it does have,
 * not be rejected wholesale.
 *
 * @param value - The raw response.
 * @returns The stored settings, or null when it is not an object.
 */
export const parseStoredSettings: Parser<StoredSettings> = (value) => {
    if (!isRecord(value)) return null;

    return {
        theme: value.theme,
        editorFontSize: value.editorFontSize,
        modalMode: value.modalMode,
        spellCheckEnabled: value.spellCheckEnabled,
        lineNumberMode: value.lineNumberMode,
        showDiagnostics: value.showDiagnostics,
        openPdfAfterCompile: value.openPdfAfterCompile,
        compileOnSave: value.compileOnSave,
    };
};

/**
 * Parses a project's settings.
 *
 * @param value - The raw response.
 * @returns The settings, or null when the shape is wrong.
 */
export const parseProjectSettings: Parser<ProjectSettings> = (value) => {
    if (!isRecord(value)) return null;

    const mainFile = nullableStringField(value, "mainFile");

    return mainFile === undefined ? null : { mainFile };
};

/**
 * Parses a source location from a PDF click.
 *
 * @param value - The raw response.
 * @returns The location, or null when the shape is wrong.
 */
export const parseSourceLocation: Parser<SourceLocation> = (value) => {
    if (!isRecord(value)) return null;

    const file = stringField(value, "file");
    const line = numberField(value, "line");

    return file === null || line === null ? null : { file, line };
};

/**
 * Parses a location in a PDF.
 *
 * @param value - The raw response.
 * @returns The location, or null when the shape is wrong.
 */
export const parsePdfLocation: Parser<PdfLocation> = (value) => {
    if (!isRecord(value)) return null;

    const page = numberField(value, "page");
    const x = numberField(value, "x");
    const y = numberField(value, "y");

    return page === null || x === null || y === null ? null : { page, x, y };
};

/**
 * Reads a field that is either a string or explicitly null.
 *
 * Distinct from {@link stringField}: an absent field is a shape
 * mismatch, whereas `null` is a real answer the backend gives — "no PDF
 * was produced", "there is no log".
 *
 * @param source - The object to read from.
 * @param key - The field name.
 * @returns The string, null when the backend sent null, or `undefined`
 *   when the field is missing or the wrong type.
 */
function nullableStringField(
    source: Record<string, unknown>,
    key: string,
): string | null | undefined {
    const value = source[key];

    if (value === null) return null;

    return typeof value === "string" ? value : undefined;
}

/**
 * Parses one compile diagnostic.
 *
 * @param value - The raw response.
 * @returns The diagnostic, or null when the shape is wrong.
 */
export const parseCompileDiagnostic: Parser<CompileDiagnostic> = (value) => {
    if (!isRecord(value)) return null;

    const severity = value.severity;
    const file = stringField(value, "file");
    const message = stringField(value, "message");
    const rawLine = value.line;

    if (severity !== "error" && severity !== "warning") return null;
    if (file === null || message === null) return null;

    // The engine reports no line for its own failures, which is a real
    // answer rather than a malformed one.
    const line =
        rawLine === null
            ? null
            : typeof rawLine === "number" && Number.isFinite(rawLine)
              ? rawLine
              : undefined;

    if (line === undefined) return null;

    return { severity, file, line, message };
};

/**
 * Parses the result of a compilation.
 *
 * @param value - The raw response.
 * @returns The outcome, or null when the shape is wrong.
 */
export const parseCompileOutcome: Parser<CompileOutcome> = (value) => {
    if (!isRecord(value)) return null;

    const pdfPath = nullableStringField(value, "pdfPath");
    const logPath = nullableStringField(value, "logPath");
    const diagnostics = parseArrayOf(parseCompileDiagnostic)(value.diagnostics);

    if (pdfPath === undefined || logPath === undefined || diagnostics === null) {
        return null;
    }

    return { pdfPath, logPath, diagnostics };
};

/**
 * Parses the result of exporting a PDF.
 *
 * @param value - The raw response.
 * @returns The outcome, or null when the shape is wrong.
 */
export const parseExportOutcome: Parser<ExportOutcome> = (value) => {
    if (!isRecord(value)) return null;

    const exportedTo = nullableStringField(value, "exportedTo");

    return exportedTo === undefined ? null : { exportedTo };
};
