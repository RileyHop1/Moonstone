/**
 * Path arithmetic on the strings the backend hands us.
 *
 * Moonstone runs on Windows, where the backend returns paths with
 * backslashes but the user (and LaTeX) may write forward slashes, so
 * every one of these accepts either separator. Four places had grown
 * their own copy of the same `\` / `/` dance, and they disagreed about
 * the edge cases — `dirname` on a path with no separator at all used to
 * truncate its last character instead of returning empty.
 *
 * These are string operations, not filesystem ones: nothing here
 * touches disk, resolves symlinks, or normalises `.` and `..`.
 * `src-tauri/src/paths.rs` is the authority for anything that must be
 * true of the real filesystem; this is for deciding what to display and
 * which pane to update.
 */

/**
 * The separator a path uses, for building new paths in its style.
 *
 * @param path - The path to inspect.
 * @returns A backslash when the path contains one, else a slash.
 */
export function separatorOf(path: string): string {
    return path.includes("\\") ? "\\" : "/";
}

/**
 * The last segment of a path — the file or folder's own name.
 *
 * @param path - The path to inspect.
 * @returns The final segment, or the whole path when it has no
 *   separator. Empty for an empty path.
 */
export function basename(path: string): string {
    const index = lastSeparatorIndex(path);

    return index === -1 ? path : path.slice(index + 1);
}

/**
 * Everything above a path's last segment.
 *
 * @param path - The path to inspect.
 * @returns The parent directory, or the empty string when the path has
 *   no separator at all. A bare name has no parent to name, and
 *   returning part of the name instead — which `slice(0, -1)` on a
 *   `lastIndexOf` of -1 quietly does — corrupts every path built from
 *   the result.
 */
export function dirname(path: string): string {
    const index = lastSeparatorIndex(path);

    return index === -1 ? "" : path.slice(0, index);
}

/**
 * Joins a directory and a name in the directory's own separator style.
 *
 * @param directory - The containing directory.
 * @param name - The entry's name.
 * @returns The joined path; just `name` when the directory is empty.
 */
export function join(directory: string, name: string): string {
    if (directory === "") return name;

    return `${directory}${separatorOf(directory)}${name}`;
}

/**
 * Whether one path lies inside another.
 *
 * A path is not inside itself, and a separator is required after the
 * parent — so `C:\project-notes` is not inside `C:\project`, which a
 * bare `startsWith` would get wrong.
 *
 * Separators are normalised before comparing, so a path written with
 * slashes still matches a parent written with backslashes. Case is
 * *not* normalised: Windows would treat `C:\Project` and `C:\project`
 * as the same directory, but every path here comes from the backend's
 * own tree and is cased consistently, and lowercasing would introduce
 * false matches on the platforms where case does count.
 *
 * @param parent - The containing directory.
 * @param candidate - The path that may be inside it.
 * @returns True when `candidate` is a descendant of `parent`.
 */
export function isInside(parent: string, candidate: string): boolean {
    return normaliseSeparators(candidate).startsWith(`${normaliseSeparators(parent)}/`);
}

/**
 * Whether a path is a directory itself or something inside it.
 *
 * The question asked when an entry is deleted or renamed: is the file
 * I have open affected?
 *
 * @param parent - The entry that moved or went away.
 * @param candidate - The path to test.
 * @returns True when `candidate` is `parent` or lies inside it.
 */
export function isAtOrInside(parent: string, candidate: string): boolean {
    return (
        normaliseSeparators(candidate) === normaliseSeparators(parent) ||
        isInside(parent, candidate)
    );
}

/**
 * Expresses a path relative to a directory that contains it.
 *
 * The inverse of {@link join}, and the form the backend and the LaTeX
 * engine both speak: a compile takes the main file relative to its
 * project, and the engine reports diagnostics against project-relative
 * names.
 *
 * Always returns forward slashes. That is the separator LaTeX writes
 * and the one the engine reports back, so a relative path is compared
 * against engine output more often than it is joined onto a Windows
 * path.
 *
 * @param parent - The containing directory.
 * @param path - A path inside it.
 * @returns The relative path, or null when `path` is not inside
 *   `parent`.
 */
export function relativeTo(parent: string, path: string): string | null {
    if (!isInside(parent, path)) return null;

    return normaliseSeparators(path).slice(normaliseSeparators(parent).length + 1);
}

/**
 * Rewrites a path after the entry it lives under has moved.
 *
 * @param path - The path to rewrite.
 * @param from - The entry's old path.
 * @param to - The entry's new path.
 * @returns The updated path, or null when `path` was not affected.
 */
export function reparent(path: string, from: string, to: string): string | null {
    const normalisedPath = normaliseSeparators(path);
    const normalisedFrom = normaliseSeparators(from);

    if (normalisedPath === normalisedFrom) return to;

    const prefix = `${normalisedFrom}/`;
    if (!normalisedPath.startsWith(prefix)) return null;

    // Sliced from the original so the tail keeps whatever style it was
    // written in; normalising is one-for-one, so the indices line up.
    return join(to, path.slice(prefix.length));
}

/**
 * Splits a path into its segments, on either separator.
 *
 * @param path - The path to split.
 * @returns The segments, in order.
 */
export function segmentsOf(path: string): readonly string[] {
    return path.split(/[/\\]/);
}

/**
 * Rewrites a path to use one separator throughout.
 *
 * Needed where a path is handed to something outside the app: a LaTeX
 * author may write `figures/plot.png` on Windows, and the asset
 * protocol wants a path in the platform's own style rather than a
 * mixture.
 *
 * @param path - The path to rewrite.
 * @param separator - The separator to use.
 * @returns The path with that separator between every segment.
 */
export function withSeparator(path: string, separator: string): string {
    return segmentsOf(path).join(separator);
}

/**
 * Whether a path is absolute, in Windows or POSIX form.
 *
 * @param path - The path to test.
 * @returns True for `C:\…`, `C:/…`, `\…` or `/…`.
 */
export function isAbsolute(path: string): boolean {
    return /^([a-zA-Z]:[\\/]|[\\/])/.test(path);
}

/**
 * Index of the last separator of either kind.
 *
 * @param path - The path to inspect.
 * @returns The index, or -1 when the path has no separator.
 */
function lastSeparatorIndex(path: string): number {
    return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/**
 * Rewrites every separator as a slash, for comparison only.
 *
 * The result is the same length as the input, so an index into it is
 * also an index into the original.
 *
 * @param path - The path to normalise.
 * @returns The path with slashes throughout.
 */
function normaliseSeparators(path: string): string {
    return path.split("\\").join("/");
}
