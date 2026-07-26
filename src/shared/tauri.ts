/**
 * Typed wrappers around Tauri's `invoke` for every Moonstone backend
 * command.
 *
 * Each wrapper returns a {@link Result} instead of throwing, so pages
 * handle failures through the type system rather than try/catch.
 */

import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
    AppSettings,
    FileNode,
    ProjectInfo,
    Reference,
    Result,
    TemplateInfo,
} from "./types";

/**
 * Opens a URL in the user's default browser.
 *
 * Only `http` and `https` are followed: a document is untrusted input,
 * and `file:` or shell-adjacent schemes must never be handed to the
 * OS opener on its say-so.
 *
 * @param url - The address written in the document.
 */
export function openExternalLink(url: string): void {
    if (!isTauri()) return;

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

    void openUrl(parsed.href).catch((error: unknown) => {
        console.error("Could not open link", { url: parsed.href, error });
    });
}

/**
 * Builds a resolver that turns an `\includegraphics` path into a URL
 * the webview can load, for images sitting beside a given document.
 *
 * Relative paths resolve against the document's own directory, as
 * LaTeX does. Returns null — meaning "show a placeholder" — outside
 * Tauri, when no document is open, or for a path that tries to escape
 * its project with `..`. The asset protocol's scope is the real
 * boundary; this is a cheap first check.
 *
 * Paths must carry a file extension. LaTeX lets authors omit it and
 * probes for one, which would require filesystem access here; those
 * render as placeholders instead.
 *
 * @param documentPath - Absolute path of the open document, or null.
 * @returns A resolver producing a loadable URL, or null when it cannot.
 */
export function createImageSourceResolver(
    documentPath: string | null,
): (imagePath: string) => string | null {
    if (!isTauri() || documentPath === null) return () => null;

    const separator = documentPath.includes("\\") ? "\\" : "/";
    const documentDirectory = documentPath.slice(
        0,
        Math.max(documentPath.lastIndexOf("/"), documentPath.lastIndexOf("\\")),
    );

    return (imagePath: string): string | null => {
        const segments = imagePath.split(/[/\\]/);
        if (segments.includes("..")) return null;

        // No extension means LaTeX would go looking for one; we cannot.
        const fileName = segments[segments.length - 1] ?? "";
        if (!fileName.includes(".")) return null;

        const isAbsolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(imagePath);
        const fullPath = isAbsolute
            ? imagePath
            : `${documentDirectory}${separator}${segments.join(separator)}`;

        return convertFileSrc(fullPath);
    };
}

/**
 * Settings as the backend stores them: the theme arrives as a plain
 * string and is narrowed to {@link AppSettings} by the settings
 * provider.
 */
export interface StoredSettings {
    readonly theme: string;
    readonly editorFontSize: number;
}

/**
 * Converts an unknown thrown value into a human-readable message.
 *
 * Tauri commands reject with the `Err` string from Rust, but other
 * failures (serialization, missing command) can be `Error`s.
 *
 * @param error - The caught value.
 * @returns A displayable error message.
 */
function toErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;

    if (error instanceof Error) return error.message;

    return String(error);
}

/**
 * Invokes a Tauri command and wraps the outcome in a {@link Result}.
 *
 * @param command - The registered command name.
 * @param args - Arguments passed to the command (camelCase keys).
 * @returns The command's data on success, or an error message.
 */
async function invokeCommand<T>(
    command: string,
    args?: Record<string, unknown>,
): Promise<Result<T>> {
    // Running in a plain browser (`npm run dev`) leaves the Tauri bridge
    // undefined, which otherwise surfaces as a cryptic "reading 'invoke'"
    // error — fail with an actionable message instead.
    if (!isTauri()) {
        return {
            ok: false,
            error:
                "Moonstone's backend isn't available in a plain browser. " +
                "Launch the app with `npm run tauri dev` instead of `npm run dev`.",
        };
    }

    try {
        const data = await invoke<T>(command, args);
        return { ok: true, data };
    } catch (error: unknown) {
        return { ok: false, error: toErrorMessage(error) };
    }
}

/**
 * Lists every project under the Moonstone root.
 *
 * @returns All projects, sorted by name.
 */
export function listProjects(): Promise<Result<readonly ProjectInfo[]>> {
    return invokeCommand("list_projects");
}

/**
 * Creates a new project, seeded from a template.
 *
 * @param name - Name of the new project.
 * @param templateId - Identifier from {@link listTemplates}.
 * @returns Metadata of the created project.
 */
export function createProject(
    name: string,
    templateId: string,
): Promise<Result<ProjectInfo>> {
    return invokeCommand("create_project", { name, templateId });
}

/**
 * Lists the templates a new project can start from.
 *
 * @returns The available templates, in the order they are offered.
 */
export function listTemplates(): Promise<Result<readonly TemplateInfo[]>> {
    return invokeCommand("list_templates", {});
}

/**
 * Lists every reference defined in the project's `.bib` files, merged
 * into one key-sorted list.
 *
 * @param projectPath - Absolute path of the project directory.
 * @returns The project's references.
 */
export function listReferences(projectPath: string): Promise<Result<readonly Reference[]>> {
    return invokeCommand("list_references", { projectPath });
}

/**
 * Deletes a whole project (to the system recycle bin).
 *
 * @param projectPath - Absolute path of the project directory.
 * @returns Nothing on success.
 */
export function deleteProject(projectPath: string): Promise<Result<null>> {
    return invokeCommand("delete_project", { projectPath });
}

/**
 * Lists the full file tree of a project.
 *
 * @param projectPath - Absolute path of the project directory.
 * @returns The root directory node of the project.
 */
export function listProjectFiles(projectPath: string): Promise<Result<FileNode>> {
    return invokeCommand("list_project_files", { projectPath });
}

/**
 * Reads the contents of a `.tex` file.
 *
 * @param filePath - Absolute path of the file.
 * @returns The file contents.
 */
export function readFile(filePath: string): Promise<Result<string>> {
    return invokeCommand("read_file", { filePath });
}

/**
 * Overwrites a `.tex` file with new contents.
 *
 * @param filePath - Absolute path of the file.
 * @param contents - Full new contents of the file.
 * @returns Nothing on success.
 */
export function saveFile(filePath: string, contents: string): Promise<Result<null>> {
    return invokeCommand("save_file", { filePath, contents });
}

/**
 * Creates an empty `.tex` file.
 *
 * @param parentDirectory - Directory to create the file in.
 * @param fileName - Bare file name without extension.
 * @param fileExtension - Extension without the dot; the backend
 *   rejects anything it cannot also open and save.
 * @returns The full path of the created file.
 */
export function createFile(
    parentDirectory: string,
    fileName: string,
    fileExtension: string,
): Promise<Result<string>> {
    return invokeCommand("create_file", {
        parentDirectory,
        fileName,
        fileExtension,
    });
}

/**
 * Renames a project, keeping its `<project>.tex` main file in step.
 *
 * @param projectPath - Path of the project directory.
 * @param newName - The new project name.
 * @returns The renamed project's path.
 */
export function renameProject(
    projectPath: string,
    newName: string,
): Promise<Result<string>> {
    return invokeCommand("rename_project", { projectPath, newName });
}

/**
 * Creates a directory.
 *
 * @param parentDirectory - Directory to create the new directory in.
 * @param dirName - Name of the new directory.
 * @returns The full path of the created directory.
 */
export function createDirectory(parentDirectory: string, dirName: string): Promise<Result<string>> {
    return invokeCommand("create_directory", { parentDirectory, dirName });
}

/**
 * Renames a file or directory.
 *
 * @param path - Current path of the entry.
 * @param newName - The new bare name.
 * @returns The full path of the renamed entry.
 */
export function renameEntry(path: string, newName: string): Promise<Result<string>> {
    return invokeCommand("rename_entry", { path, newName });
}

/**
 * Moves a file or directory into another directory.
 *
 * @param sourcePath - The entry to move.
 * @param destinationDir - The target directory.
 * @returns The entry's full path at its new location.
 */
export function moveEntry(sourcePath: string, destinationDir: string): Promise<Result<string>> {
    return invokeCommand("move_entry", { sourcePath, destinationDir });
}

/**
 * Deletes a file or directory (to the system recycle bin).
 *
 * @param path - Path of the entry to delete.
 * @returns Nothing on success.
 */
export function deleteEntry(path: string): Promise<Result<null>> {
    return invokeCommand("delete_entry", { path });
}

/**
 * Loads the persisted user settings.
 *
 * @returns The stored settings (theme not yet narrowed).
 */
export function getSettings(): Promise<Result<StoredSettings>> {
    return invokeCommand("get_settings");
}

/**
 * Persists the user settings.
 *
 * @param settings - The settings to store.
 * @returns Nothing on success.
 */
export function saveSettings(settings: AppSettings): Promise<Result<null>> {
    return invokeCommand("save_settings", { settings });
}
