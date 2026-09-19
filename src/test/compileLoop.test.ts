/**
 * Tests for the pure half of the compile loop: choosing the root
 * document, resolving diagnostic file names, and summing up problems.
 */

import { describe, expect, it } from "vitest";
import {
    normalizeRelative,
    projectFiles,
    resolveDiagnosticFile,
    resolveRootDocument,
    summarizeDiagnostics,
} from "../views/ProjectPage/compileLoop";
import type { RootDocumentInput } from "../views/ProjectPage/compileLoop";
import type { CompileDiagnostic, FileNode } from "../shared/types";

/** A thesis: a root document, chapters beside it, a stray main.tex. */
const FILES: ReadonlySet<string> = new Set([
    "thesis.tex",
    "main.tex",
    "chapters/one.tex",
    "chapters/two.tex",
    "standalone.tex",
]);

/**
 * Builds a root-document query with sensible defaults.
 *
 * @param overrides - The fields a test cares about.
 * @returns The query.
 */
function input(overrides: Partial<RootDocumentInput>): RootDocumentInput {
    return {
        projectName: "thesis",
        files: FILES,
        storedMainFile: null,
        active: null,
        ...overrides,
    };
}

describe("resolveRootDocument", () => {
    it("follows a magic comment, relative to the file that has it", () => {
        const active = { file: "chapters/one.tex", text: "% !TEX root = ../main.tex\nHello" };

        expect(resolveRootDocument(input({ active, storedMainFile: "thesis.tex" }))).toBe(
            "main.tex",
        );
    });

    it("ignores a magic comment naming a file that does not exist", () => {
        const active = { file: "chapters/one.tex", text: "%!TEX root = ../gone.tex" };

        expect(resolveRootDocument(input({ active }))).toBe("thesis.tex");
    });

    it("prefers the stored main file over an open whole document", () => {
        const active = { file: "standalone.tex", text: "\\documentclass{article}" };

        expect(resolveRootDocument(input({ active, storedMainFile: "main.tex" }))).toBe(
            "main.tex",
        );
    });

    it("compiles an open whole document when no main file is stored", () => {
        const active = { file: "standalone.tex", text: "\\documentclass{article}" };

        expect(resolveRootDocument(input({ active }))).toBe("standalone.tex");
    });

    it("builds <project>.tex, not the open chapter", () => {
        // The 1.0 bug: compiling from a chapter built the chapter alone.
        const active = { file: "chapters/two.tex", text: "\\section{Two}" };

        expect(resolveRootDocument(input({ active }))).toBe("thesis.tex");
    });

    it("falls back to main.tex, then to the open file", () => {
        const noProjectFile = new Set(["main.tex", "chapters/one.tex"]);
        const chapterOnly = new Set(["chapters/one.tex"]);
        const active = { file: "chapters/one.tex", text: "text" };

        expect(resolveRootDocument(input({ files: noProjectFile, active }))).toBe("main.tex");
        expect(resolveRootDocument(input({ files: chapterOnly, active }))).toBe(
            "chapters/one.tex",
        );
    });

    it("finds nothing in a project without a .tex file", () => {
        expect(resolveRootDocument(input({ files: new Set(["notes.md"]) }))).toBeNull();
    });

    it("skips a stored main file that has since been deleted", () => {
        expect(resolveRootDocument(input({ storedMainFile: "old.tex" }))).toBe("thesis.tex");
    });
});

describe("normalizeRelative", () => {
    it("resolves dots and either separator", () => {
        expect(normalizeRelative("chapters/../figures\\.\\plot.png")).toBe("figures/plot.png");
    });

    it("refuses a path that climbs out of the project", () => {
        expect(normalizeRelative("../elsewhere.tex")).toBeNull();
    });
});

describe("resolveDiagnosticFile", () => {
    it("adds the .tex that \\input left off", () => {
        expect(resolveDiagnosticFile("chapters/one", "thesis.tex", FILES)).toBe(
            "chapters/one.tex",
        );
    });

    it("resolves against the root document's folder", () => {
        const files = new Set(["book/main.tex", "book/parts/a.tex"]);

        expect(resolveDiagnosticFile("parts/a", "book/main.tex", files)).toBe(
            "book/parts/a.tex",
        );
    });

    it("strips the ./ TeX sometimes writes", () => {
        expect(resolveDiagnosticFile("./main.tex", "main.tex", FILES)).toBe("main.tex");
    });

    it("gives up on names that are not project files", () => {
        expect(resolveDiagnosticFile("article.cls", "thesis.tex", FILES)).toBeNull();
        expect(resolveDiagnosticFile("", "thesis.tex", FILES)).toBeNull();
    });
});

describe("summarizeDiagnostics", () => {
    /**
     * A diagnostic of a given severity.
     *
     * @param severity - How serious it is.
     * @returns The diagnostic.
     */
    const diagnostic = (severity: "error" | "warning"): CompileDiagnostic => ({
        severity,
        file: "main.tex",
        line: 1,
        message: "m",
    });

    it("counts errors and warnings with correct plurals", () => {
        expect(
            summarizeDiagnostics([
                diagnostic("error"),
                diagnostic("error"),
                diagnostic("warning"),
            ]),
        ).toBe("2 errors, 1 warning");
        expect(summarizeDiagnostics([diagnostic("warning")])).toBe("1 warning");
        expect(summarizeDiagnostics([])).toBe("No problems");
    });
});

describe("projectFiles", () => {
    it("maps every file's relative path to its path in the tree", () => {
        const tree: FileNode = {
            kind: "directory",
            name: "p",
            path: "C:\\root\\p",
            children: [
                { kind: "file", name: "main.tex", path: "C:\\root\\p\\main.tex" },
                {
                    kind: "directory",
                    name: "ch",
                    path: "C:\\root\\p\\ch",
                    children: [{ kind: "file", name: "a.tex", path: "C:\\root\\p\\ch\\a.tex" }],
                },
            ],
        };

        expect([...projectFiles(tree, "C:\\root\\p")]).toEqual([
            ["main.tex", "C:\\root\\p\\main.tex"],
            ["ch/a.tex", "C:\\root\\p\\ch\\a.tex"],
        ]);
    });
});
