/**
 * Tests for the drag payload written by the file browser.
 *
 * The behaviour under test is a security boundary, not a convenience:
 * a `DataTransfer` carries whatever the user happened to drag, and the
 * app must not treat arbitrary dropped text as a path to hand to the
 * backend (finding A-2). Everything here is about what gets *rejected*.
 */

import { describe, expect, it } from "vitest";
import {
    MOONSTONE_PATH_MIME,
    hasFileDragPayload,
    parseFileDragPayload,
    readFileDragPayload,
    writeFileDragPayload,
} from "../shared/dragPayload";
import type { FileDragPayload } from "../shared/dragPayload";
import { makeDataTransfer } from "./dataTransfer";

const FILE: FileDragPayload = { kind: "file", path: "C:\\project\\main.tex" };

describe("writeFileDragPayload", () => {
    it("round-trips an entry", () => {
        const transfer = makeDataTransfer();

        writeFileDragPayload(transfer, FILE);

        expect(readFileDragPayload(transfer)).toEqual(FILE);
    });

    it("marks the drag with the private type", () => {
        const transfer = makeDataTransfer();

        writeFileDragPayload(transfer, FILE);

        expect(hasFileDragPayload(transfer)).toBe(true);
    });

    it("also writes the path as plain text, for drags out of the app", () => {
        const transfer = makeDataTransfer();

        writeFileDragPayload(transfer, FILE);

        expect(transfer.getData("text/plain")).toBe(FILE.path);
    });

    it("allows both copy and move", () => {
        // The file browser moves an entry between folders; a pane opens
        // it and leaves the tree alone. Declaring only one of those makes
        // the browser cancel the other drop entirely (finding A-3).
        const transfer = makeDataTransfer();

        writeFileDragPayload(transfer, FILE);

        expect(transfer.effectAllowed).toBe("copyMove");
    });

    it("carries the entry's kind", () => {
        const transfer = makeDataTransfer();

        writeFileDragPayload(transfer, { kind: "directory", path: "C:\\project\\chapters" });

        expect(readFileDragPayload(transfer)?.kind).toBe("directory");
    });
});

describe("hasFileDragPayload", () => {
    it("rejects a drag carrying only plain text", () => {
        // This is the dragged-text-selection case: CodeMirror puts the
        // selection on `text/plain`, exactly as the old file browser did.
        const transfer = makeDataTransfer({ "text/plain": "some dragged prose" });

        expect(hasFileDragPayload(transfer)).toBe(false);
    });

    it("rejects an empty drag", () => {
        expect(hasFileDragPayload(makeDataTransfer())).toBe(false);
    });
});

describe("readFileDragPayload", () => {
    it("returns null for a drag that did not come from the file browser", () => {
        const transfer = makeDataTransfer({ "text/plain": "C:\\project\\main.tex" });

        // Even though the text *looks* like a path, nothing marked it as
        // ours, so it is not accepted.
        expect(readFileDragPayload(transfer)).toBeNull();
    });
});

describe("parseFileDragPayload", () => {
    it.each([
        ["not JSON at all", "C:\\project\\main.tex"],
        ["JSON that is not an object", '"main.tex"'],
        ["null", "null"],
        ["an array", '["file", "main.tex"]'],
        ["a missing path", '{"kind":"file"}'],
        ["an empty path", '{"kind":"file","path":""}'],
        ["a non-string path", '{"kind":"file","path":42}'],
        ["a missing kind", '{"path":"main.tex"}'],
        ["an unknown kind", '{"kind":"symlink","path":"main.tex"}'],
        ["a non-string kind", '{"kind":true,"path":"main.tex"}'],
    ])("rejects %s", (_description, raw) => {
        expect(parseFileDragPayload(raw)).toBeNull();
    });

    it("accepts a well-formed payload", () => {
        expect(parseFileDragPayload(JSON.stringify(FILE))).toEqual(FILE);
    });

    it("ignores extra fields rather than failing", () => {
        // Forward compatibility: an older build reading a newer payload
        // should still manage to open the file.
        const raw = JSON.stringify({ ...FILE, addedLater: "whatever" });

        expect(parseFileDragPayload(raw)).toEqual(FILE);
    });

    it("does not read the payload from any other MIME type", () => {
        const transfer = makeDataTransfer({
            [MOONSTONE_PATH_MIME]: JSON.stringify(FILE),
        });

        expect(readFileDragPayload(transfer)).toEqual(FILE);
        expect(transfer.getData("text/plain")).toBe("");
    });
});
