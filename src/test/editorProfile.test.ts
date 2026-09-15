/**
 * Tests for the extension → editor-profile mapping.
 *
 * The bug this module exists to fix was that there was no mapping at
 * all: every editable file was treated as LaTeX, so a `$` in a `.csv`
 * became inline maths. The tests therefore care most about the files
 * that must be left alone, and about the *middle* case — LaTeX source,
 * which is highlighted but never rendered.
 */

import { describe, expect, it } from "vitest";
import {
    DEFAULT_EDITOR_PROFILE,
    editorProfileForExtension,
    editorProfileForPath,
} from "../views/editor/TextEditor/editorProfile";
import type { EditorProfileId } from "../views/editor/TextEditor/editorProfile";
import { FILE_TYPES } from "../shared/fileTypes";

describe("editorProfileForExtension", () => {
    it("gives a .tex file the full LaTeX treatment", () => {
        expect(editorProfileForExtension("tex")).toEqual({
            id: "latex",
            usesLatexLanguage: true,
            usesLinting: true,
            usesPreview: true,
        });
    });

    it.each(["sty", "cls", "bst", "dtx", "ins", "def", "cfg", "tikz"])(
        "highlights %s but does not render it",
        (extension) => {
            const profile = editorProfileForExtension(extension);

            expect(profile.usesLatexLanguage).toBe(true);
            // The point of the middle profile: a `\textbf{…}` inside a
            // `\newcommand` body is a definition, not text to embolden.
            expect(profile.usesPreview).toBe(false);
        },
    );

    it.each(["txt", "csv", "md", "bib"])("leaves %s entirely alone", (extension) => {
        expect(editorProfileForExtension(extension)).toEqual({
            id: "plain",
            usesLatexLanguage: false,
            usesLinting: false,
            usesPreview: false,
        });
    });

    it("ignores case, since extensions arrive as the user typed them", () => {
        expect(editorProfileForExtension("TeX")).toBe(editorProfileForExtension("tex"));
    });

    it("falls back to plain text for an extension nobody claimed", () => {
        // Deliberately the *safe* default: applying a LaTeX parser to an
        // unknown file is how the original problem happened.
        expect(editorProfileForExtension("rs").usesLatexLanguage).toBe(false);
    });

    it("returns the same object for the same extension", () => {
        // Identity is load-bearing: `SYNCED` compares profiles by
        // reference to decide whether to reconfigure the language
        // compartment.
        expect(editorProfileForExtension("sty")).toBe(editorProfileForExtension("cls"));
    });

    it("has a deliberate answer for every file type the app can create", () => {
        // The unknown-file default is plain text, so a new file type
        // added to `FILE_TYPES` and forgotten here would silently get
        // the right *answer* for the wrong reason. Listing the decisions
        // explicitly makes that omission a failure instead.
        const decided: Readonly<Record<string, EditorProfileId>> = {
            tex: "latex",
            ltx: "latex",
            sty: "latex-source",
            cls: "latex-source",
            bst: "latex-source",
            dtx: "latex-source",
            ins: "latex-source",
            def: "latex-source",
            cfg: "latex-source",
            tikz: "latex-source",
            bib: "plain",
            txt: "plain",
            md: "plain",
            csv: "plain",
        };

        expect(FILE_TYPES.map((type) => type.extension).sort()).toEqual(
            Object.keys(decided).sort(),
        );

        for (const [extension, id] of Object.entries(decided)) {
            expect(editorProfileForExtension(extension).id).toBe(id);
        }
    });
});

describe("editorProfileForPath", () => {
    it("reads the extension off a Windows path", () => {
        expect(editorProfileForPath("C:\\projects\\thesis\\main.tex").id).toBe("latex");
    });

    it("reads the extension off a POSIX path", () => {
        expect(editorProfileForPath("/home/me/thesis/refs.bib").id).toBe("plain");
    });

    it("uses the last extension of a multi-dot name", () => {
        expect(editorProfileForPath("/p/chapter.draft.tex").id).toBe("latex");
    });

    it("treats a dotfile as having no extension", () => {
        // `.gitignore` is a name, not a type — reading "gitignore" as an
        // extension would be a guess.
        expect(editorProfileForPath("/p/.gitignore").id).toBe("plain");
    });

    it("treats a file with no extension as plain text", () => {
        expect(editorProfileForPath("/p/Makefile").id).toBe("plain");
    });

    it("treats an empty pane as plain text", () => {
        expect(editorProfileForPath(null).id).toBe("plain");
    });

    it("is not fooled by a dot in a directory name", () => {
        expect(editorProfileForPath("/p/v1.0/notes").id).toBe("plain");
    });
});

describe("DEFAULT_EDITOR_PROFILE", () => {
    it("is the full LaTeX profile, since that is what Moonstone edits", () => {
        expect(DEFAULT_EDITOR_PROFILE).toBe(editorProfileForExtension("tex"));
    });
});
