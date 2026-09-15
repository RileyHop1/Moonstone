/**
 * The payload Moonstone puts on a drag, and how to read it back safely.
 *
 * A `DataTransfer` is a public channel. Anything can be dropped onto the
 * app — a text selection dragged inside an editor, a file from the
 * desktop, a link from a browser window — and all of it arrives as
 * `text/plain`. The file browser used to write a bare path on
 * `text/plain` and consumers read it straight back, so a dragged
 * paragraph of prose was indistinguishable from a file path, and
 * dropping one asked the backend to open it as a file.
 *
 * So drags Moonstone starts are marked with a private MIME type that
 * nothing else writes, carry the node's kind alongside its path, and are
 * validated on the way back in. `text/plain` is still written so a drag
 * *out* of the app produces something sensible, but nothing inside the
 * app trusts it.
 */

/**
 * Private MIME type identifying a drag that started in Moonstone's file
 * browser. Deliberately not a standard type: no other application will
 * write it, which is the whole point.
 */
export const MOONSTONE_PATH_MIME = "application/x-moonstone-path";

/** What kind of entry is being dragged. */
export type DragPayloadKind = "file" | "directory";

/** An entry from the project's file tree, being dragged. */
export interface FileDragPayload {
    readonly kind: DragPayloadKind;
    readonly path: string;
}

/** The kinds a payload is allowed to name. */
const PAYLOAD_KINDS: readonly DragPayloadKind[] = ["file", "directory"];

/**
 * Marks a drag as carrying one of the project's entries.
 *
 * Sets `effectAllowed` to `"copyMove"` because the two drop targets
 * want different things: the file browser *moves* an entry between
 * folders, while an editor pane *opens* it and leaves the tree alone.
 * Declaring only one of those makes the browser reject the other — a
 * `dragover` whose `dropEffect` is incompatible resolves to `"none"`,
 * and then no `drop` event fires at all.
 *
 * @param dataTransfer - The drag's data transfer.
 * @param payload - The entry being dragged.
 */
export function writeFileDragPayload(
    dataTransfer: DataTransfer,
    payload: FileDragPayload,
): void {
    dataTransfer.setData(MOONSTONE_PATH_MIME, JSON.stringify(payload));

    // A secondary, untrusted convenience for drags that leave the app.
    dataTransfer.setData("text/plain", payload.path);

    dataTransfer.effectAllowed = "copyMove";
}

/**
 * Whether a drag carries one of our entries.
 *
 * Used during `dragover`, where the payload's *contents* are
 * deliberately unreadable — browsers withhold `getData` until the drop
 * to stop pages snooping on drags passing over them — but the list of
 * types is available.
 *
 * @param dataTransfer - The drag's data transfer.
 * @returns True when this drag started in Moonstone's file browser.
 */
export function hasFileDragPayload(dataTransfer: DataTransfer): boolean {
    return Array.from(dataTransfer.types).includes(MOONSTONE_PATH_MIME);
}

/**
 * Reads and validates the payload from a dropped drag.
 *
 * @param dataTransfer - The drag's data transfer.
 * @returns The entry dragged, or null when this drag did not come from
 *   the file browser or its payload is malformed.
 */
export function readFileDragPayload(dataTransfer: DataTransfer): FileDragPayload | null {
    const raw = dataTransfer.getData(MOONSTONE_PATH_MIME);
    if (raw === "") return null;

    return parseFileDragPayload(raw);
}

/**
 * Parses the serialised payload.
 *
 * Separate from {@link readFileDragPayload} so the validation can be
 * tested without constructing a `DataTransfer`, and because a malformed
 * payload must fail the same way whatever produced it.
 *
 * @param raw - The serialised payload.
 * @returns The entry, or null when the text is not a valid payload.
 */
export function parseFileDragPayload(raw: string): FileDragPayload | null {
    const parsed: unknown = tryParseJson(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const { kind, path } = parsed as Partial<Record<keyof FileDragPayload, unknown>>;

    if (typeof path !== "string" || path === "") return null;
    if (!PAYLOAD_KINDS.some((allowed) => allowed === kind)) return null;

    // `kind` is one of PAYLOAD_KINDS, which the check above established.
    return { kind: kind as DragPayloadKind, path };
}

/**
 * Parses JSON without throwing.
 *
 * @param raw - Text that may or may not be JSON.
 * @returns The parsed value, or undefined when it does not parse.
 */
function tryParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        // A drag carrying our MIME type but not our payload is not an
        // error worth reporting — it is simply not something we accept.
        return undefined;
    }
}
