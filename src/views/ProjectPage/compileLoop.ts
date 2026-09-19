/**
 * The pure half of the compile loop: which file a compile builds, which
 * file a diagnostic means, and how a compile's problems are summed up.
 *
 * Everything here works in **project-relative paths with `/`**, the
 * form the engine reports and the project settings store, so nothing
 * has to care which platform's separator the project path uses.
 */

import { dirname, join, relativeTo, segmentsOf } from "../../shared/paths";
import type { CompileDiagnostic, FileNode } from "../../shared/types";

/** `% !TEX root = path`, the magic comment every TeX editor honours. */
const MAGIC_ROOT_PATTERN = /^[ \t]*%[ \t]*!TEX[ \t]+root[ \t]*=[ \t]*(\S.*?)[ \t]*$/im;

/** Anything that can say whether a relative path is a project file. */
export type FileLookup = Pick<ReadonlySet<string>, "has">;

/** What deciding the root document needs to know. */
export interface RootDocumentInput {
    readonly projectName: string;
    /** Every file in the project, relative with `/`. */
    readonly files: FileLookup;
    /** The main file stored with the project, if the user chose one. */
    readonly storedMainFile: string | null;
    /** The document the author is looking at, if any. */
    readonly active: { readonly file: string; readonly text: string } | null;
}

/**
 * Lists a project's files relative to it.
 *
 * @param tree - The project's file tree.
 * @param projectPath - Absolute path of the project directory.
 * @returns Every file's path relative with `/`, mapped to its path in
 *   the tree.
 */
export function projectFiles(tree: FileNode, projectPath: string): ReadonlyMap<string, string> {
    const files = new Map<string, string>();

    const visit = (node: FileNode): void => {
        if (node.kind === "directory") {
            node.children.forEach(visit);
            return;
        }

        const relative = relativeTo(projectPath, node.path);
        if (relative !== null) files.set(relative, node.path);
    };

    visit(tree);
    return files;
}

/**
 * Resolves `.` and `..` in a relative path.
 *
 * @param path - A relative path, with either separator.
 * @returns The normalised path with `/`, or null when it climbs out of
 *   the project.
 */
export function normalizeRelative(path: string): string | null {
    const segments: string[] = [];

    for (const segment of segmentsOf(path)) {
        if (segment === "" || segment === ".") continue;

        if (segment !== "..") segments.push(segment);
        else if (segments.pop() === undefined) return null;
    }

    return segments.join("/");
}

/**
 * Decides which file a compile builds.
 *
 * In order: the active file's `% !TEX root` comment, the main file
 * stored with the project, the active file when it is a whole document
 * (`\documentclass`), `<project>.tex`, `main.tex`, and finally the
 * active file anyway — so compiling always does *something*, and a
 * chapter with no way back to its root reports why it failed.
 *
 * @param input - The project's files, stored choice and active file.
 * @returns The root document, relative with `/`, or null when nothing
 *   in the project can be compiled.
 */
export function resolveRootDocument({
    projectName,
    files,
    storedMainFile,
    active,
}: RootDocumentInput): string | null {
    const magic = active ? MAGIC_ROOT_PATTERN.exec(active.text)?.[1] : undefined;
    const candidates = [
        active && magic !== undefined
            ? normalizeRelative(join(dirname(active.file), magic))
            : null,
        storedMainFile,
        active && /\\documentclass\b/.test(active.text) ? active.file : null,
        `${projectName}.tex`,
        "main.tex",
        active?.file.endsWith(".tex") ? active.file : null,
    ];

    return (
        candidates.find(
            (candidate): candidate is string => candidate !== null && files.has(candidate),
        ) ?? null
    );
}

/**
 * Works out which project file a diagnostic names.
 *
 * TeX reports names as the document wrote them: relative to the root
 * document's folder, and without `.tex` when `\input` left it off.
 *
 * @param file - The name the engine reported.
 * @param rootFile - The root document that was compiled.
 * @param files - Every file in the project.
 * @returns The file, relative with `/`, or null when none matches.
 */
export function resolveDiagnosticFile(
    file: string,
    rootFile: string,
    files: FileLookup,
): string | null {
    if (file === "") return null;

    for (const base of [dirname(rootFile), ""]) {
        for (const name of [file, `${file}.tex`]) {
            const candidate = normalizeRelative(join(base, name));
            if (candidate !== null && files.has(candidate)) return candidate;
        }
    }

    return null;
}

/**
 * Sums up a compile's problems, e.g. "2 errors, 1 warning".
 *
 * @param diagnostics - What the compile reported.
 * @returns The summary, or "No problems" for an empty list.
 */
export function summarizeDiagnostics(diagnostics: readonly CompileDiagnostic[]): string {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
    const warnings = diagnostics.length - errors;
    const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

    const parts = [
        errors > 0 ? count(errors, "error") : null,
        warnings > 0 ? count(warnings, "warning") : null,
    ].filter((part) => part !== null);

    return parts.length > 0 ? parts.join(", ") : "No problems";
}
