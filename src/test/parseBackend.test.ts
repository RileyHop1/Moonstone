/**
 * Tests for the IPC response validators.
 *
 * The boundary they guard is the one the review called asserted rather
 * than validated (finding C-1): `invoke<T>()` is an unchecked cast, so
 * a malformed or version-skewed response used to arrive typed and
 * wrong, and surfaced as `undefined.children` deep inside a React
 * render. What matters here is mostly what gets *rejected*.
 */

import { describe, expect, it } from "vitest";
import {
    parseArrayOf,
    parseCompileOutcome,
    parseFileNode,
    parseProjectInfo,
    parseReference,
    parseStoredSettings,
    parseString,
    parseTemplateInfo,
} from "../shared/parseBackend";

const PROJECT = {
    name: "demo",
    path: "C:/root/demo",
    lastModified: "2026-07-01T12:00:00+00:00",
    fileCount: 2,
};

describe("parseProjectInfo", () => {
    it("accepts a well-formed project", () => {
        expect(parseProjectInfo(PROJECT)).toEqual(PROJECT);
    });

    it.each([
        ["null", null],
        ["a string", "demo"],
        ["an array", [PROJECT]],
        ["a missing field", { ...PROJECT, path: undefined }],
        ["a field of the wrong type", { ...PROJECT, fileCount: "2" }],
        ["a non-finite count", { ...PROJECT, fileCount: Number.NaN }],
    ])("rejects %s", (_description, value) => {
        expect(parseProjectInfo(value)).toBeNull();
    });

    it("drops fields it does not know about", () => {
        // Forward compatibility: a newer backend adding a field must
        // not break an older frontend.
        expect(parseProjectInfo({ ...PROJECT, addedLater: true })).toEqual(PROJECT);
    });
});

describe("parseFileNode", () => {
    it("accepts a nested tree", () => {
        const tree = {
            kind: "directory",
            name: "demo",
            path: "C:/demo",
            children: [{ kind: "file", name: "main.tex", path: "C:/demo/main.tex" }],
        };

        expect(parseFileNode(tree)).toEqual(tree);
    });

    it("rejects an unknown kind", () => {
        expect(parseFileNode({ kind: "symlink", name: "a", path: "b" })).toBeNull();
    });

    it("rejects a directory with no children array", () => {
        // This is the shape that used to reach a render and throw.
        expect(parseFileNode({ kind: "directory", name: "a", path: "b" })).toBeNull();
    });

    it("rejects a tree whose nested child is malformed", () => {
        const tree = {
            kind: "directory",
            name: "demo",
            path: "C:/demo",
            children: [
                {
                    kind: "directory",
                    name: "chapters",
                    path: "C:/demo/chapters",
                    children: [{ kind: "file", name: 42, path: "C:/demo/chapters/x.tex" }],
                },
            ],
        };

        expect(parseFileNode(tree)).toBeNull();
    });
});

describe("parseArrayOf", () => {
    it("rejects the whole list when one entry is bad", () => {
        // Skipping the bad entry would silently shorten a file tree or
        // project list, which is harder to notice than an error.
        expect(parseArrayOf(parseString)(["a", 2, "c"])).toBeNull();
    });

    it("accepts an empty list", () => {
        expect(parseArrayOf(parseString)([])).toEqual([]);
    });

    it("rejects a non-array", () => {
        expect(parseArrayOf(parseString)({ 0: "a" })).toBeNull();
    });
});

describe("parseReference", () => {
    const reference = {
        key: "knuth84",
        entryType: "book",
        title: "The TeXbook",
        authors: ["Donald E. Knuth"],
        year: "1984",
        sourcePath: "/p/refs.bib",
        sourceName: "refs.bib",
    };

    it("accepts a well-formed entry", () => {
        expect(parseReference(reference)).toEqual(reference);
    });

    it("rejects authors that are not all strings", () => {
        expect(parseReference({ ...reference, authors: ["a", 1] })).toBeNull();
    });
});

describe("parseTemplateInfo", () => {
    it("rejects a missing description", () => {
        expect(parseTemplateInfo({ id: "a", name: "b", fileCount: 1 })).toBeNull();
    });
});

describe("parseStoredSettings", () => {
    it("keeps every field unvalidated", () => {
        // Deliberately permissive: `normalizeSettings` does the
        // narrowing, and a settings file written by an older build
        // should load with what it has rather than be rejected whole.
        expect(parseStoredSettings({ theme: 42 })).toEqual({
            theme: 42,
            editorFontSize: undefined,
            modalMode: undefined,
            spellCheckEnabled: undefined,
            lineNumberMode: undefined,
            showDiagnostics: undefined,
        });
    });

    it("rejects something that is not an object at all", () => {
        expect(parseStoredSettings("dark")).toBeNull();
    });
});

describe("parseCompileOutcome", () => {
    /** A complete, well-formed outcome from a successful compile. */
    const CLEAN = {
        pdfPath: "C:/projects/thesis/main.pdf",
        logPath: "C:/projects/thesis/.moonstone-build/main.log",
        diagnostics: [],
    };

    it("accepts a clean compile", () => {
        expect(parseCompileOutcome(CLEAN)).toEqual({
            pdfPath: "C:/projects/thesis/main.pdf",
            logPath: "C:/projects/thesis/.moonstone-build/main.log",
            diagnostics: [],
        });
    });

    it("accepts a compile that produced no PDF", () => {
        // Null is a real answer here, not a malformed one — the
        // distinction most of this parser exists to make.
        const outcome = parseCompileOutcome({ ...CLEAN, pdfPath: null, logPath: null });

        expect(outcome).not.toBeNull();
        expect(outcome?.pdfPath).toBeNull();
    });

    it("rejects an outcome missing its pdfPath field entirely", () => {
        // Absent is a shape mismatch even though null is allowed.
        expect(parseCompileOutcome({ logPath: null, diagnostics: [] })).toBeNull();
    });

    it("rejects a pdfPath that is neither a string nor null", () => {
        expect(parseCompileOutcome({ ...CLEAN, pdfPath: 42 })).toBeNull();
    });

    it("reads a diagnostic", () => {
        const outcome = parseCompileOutcome({
            ...CLEAN,
            diagnostics: [
                {
                    severity: "error",
                    file: "main.tex",
                    line: 11,
                    message: "Missing $ inserted",
                },
            ],
        });

        expect(outcome?.diagnostics).toEqual([
            { severity: "error", file: "main.tex", line: 11, message: "Missing $ inserted" },
        ]);
    });

    it("reads a diagnostic with no line", () => {
        // The engine reports no location for failures in itself.
        const outcome = parseCompileOutcome({
            ...CLEAN,
            diagnostics: [
                { severity: "error", file: "", line: null, message: "engine failed" },
            ],
        });

        expect(outcome?.diagnostics[0]?.line).toBeNull();
    });

    it("rejects a severity it does not know", () => {
        // A new severity added to the backend must not arrive typed as
        // one of the two the UI switches on.
        const outcome = parseCompileOutcome({
            ...CLEAN,
            diagnostics: [{ severity: "fatal", file: "main.tex", line: 1, message: "x" }],
        });

        expect(outcome).toBeNull();
    });

    it("rejects a line that is not a number", () => {
        const outcome = parseCompileOutcome({
            ...CLEAN,
            diagnostics: [{ severity: "error", file: "main.tex", line: "11", message: "x" }],
        });

        expect(outcome).toBeNull();
    });

    it("rejects the whole list when one diagnostic is malformed", () => {
        // A silently shortened error list is worse than an error
        // message: the author fixes what they can see and cannot work
        // out why it still will not build.
        const outcome = parseCompileOutcome({
            ...CLEAN,
            diagnostics: [
                { severity: "error", file: "main.tex", line: 1, message: "real" },
                { severity: "error", file: "main.tex", line: 2 },
            ],
        });

        expect(outcome).toBeNull();
    });

    it("rejects something that is not an object", () => {
        expect(parseCompileOutcome("compiled")).toBeNull();
    });
});
