/**
 * Guards for the names Moonstone lets a user type: projects, files and
 * folders.
 *
 * Mirrors the backend's `validate_name` (src-tauri/src/paths.rs) so a
 * mistake is reported next to the field instead of arriving as a
 * command failure. The backend stays the authority — every rule here
 * exists there too, and the frontend never widens what is accepted.
 */

/** Characters rejected in names (path separators / Windows-reserved). */
const FORBIDDEN_NAME_CHARS = /[/\\:*?"<>|]/;

/**
 * Characters that are invisible in the field and rejected by
 * filesystems. Covers C0 and C1, matching Rust's `char::is_control`.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;

/** Device names Windows reserves at every directory level. */
const RESERVED_DEVICE_NAMES = new Set([
    "con",
    "prn",
    "aux",
    "nul",
    ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** Longest name accepted, leaving room for an extension. */
const MAX_NAME_LENGTH = 200;

/**
 * Validates a candidate name for a project, file or folder.
 *
 * @param name - The candidate name.
 * @returns An error message, or null when the name is acceptable.
 */
export function validateEntryName(name: string): string | null {
    if (name.trim().length === 0) return "Name can't be empty";

    if (name.length > MAX_NAME_LENGTH) {
        return `Name can't be longer than ${MAX_NAME_LENGTH} characters`;
    }

    if (FORBIDDEN_NAME_CHARS.test(name)) {
        return 'Name can\'t contain / \\ : * ? " < > |';
    }

    if (CONTROL_CHARS.test(name)) return "Name can't contain control characters";

    if (name.startsWith(".")) return "Name can't start with a dot";

    if (name.endsWith(".") || name.endsWith(" ")) {
        return "Name can't end with a dot or a space";
    }

    const stem = name.split(".")[0]?.toLowerCase() ?? "";
    if (RESERVED_DEVICE_NAMES.has(stem)) {
        return `${name} is a reserved name on Windows`;
    }

    return null;
}
