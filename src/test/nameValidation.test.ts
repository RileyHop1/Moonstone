/**
 * Test suite for filename guards.
 *
 * The frontend check exists to report mistakes next to the field
 * rather than as a command failure; the backend stays the authority.
 * That only works if the two agree, so the extension list is also
 * checked against the Rust source here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateEntryName } from "../shared/nameValidation";
import { FILE_TYPES, isEditableExtension } from "../shared/fileTypes";

describe("validateEntryName", () => {
    it("accepts ordinary names", () => {
        expect(validateEntryName("chapter1")).toBeNull();
        expect(validateEntryName("Welcome to Moonstone")).toBeNull();
        expect(validateEntryName("notes v1.2")).toBeNull();
    });

    it("rejects empty and whitespace-only names", () => {
        expect(validateEntryName("")).toBe("Name can't be empty");
        expect(validateEntryName("   ")).toBe("Name can't be empty");
    });

    it("rejects path separators and reserved characters", () => {
        for (const name of ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"]) {
            expect(validateEntryName(name), name).toContain("can't contain");
        }
    });

    it("rejects control characters", () => {
        expect(validateEntryName("re\tport")).toContain("control");
        expect(validateEntryName("re\u0000port")).toContain("control");
    });

    it("rejects dot-names", () => {
        expect(validateEntryName(".")).toContain("dot");
        expect(validateEntryName(".hidden")).toContain("dot");
    });

    it("rejects trailing dots and spaces", () => {
        // Windows strips these, so the stored name would differ from
        // the one the user typed.
        expect(validateEntryName("report.")).toContain("end with");
        expect(validateEntryName("report ")).toContain("end with");
    });

    it("rejects Windows device names regardless of case or extension", () => {
        for (const name of ["CON", "nul", "Com1", "LPT9", "con.tex"]) {
            expect(validateEntryName(name), name).toContain("reserved");
        }
    });

    it("allows a device name as a prefix", () => {
        expect(validateEntryName("console")).toBeNull();
        expect(validateEntryName("nullable")).toBeNull();
    });

    it("rejects overlong names", () => {
        expect(validateEntryName("a".repeat(200))).toBeNull();
        expect(validateEntryName("a".repeat(201))).toContain("longer than");
    });
});

describe("file types", () => {
    it("recognises its own extensions, case-insensitively", () => {
        expect(isEditableExtension("tex")).toBe(true);
        expect(isEditableExtension("BIB")).toBe(true);
        expect(isEditableExtension("pdf")).toBe(false);
    });

    it("offers LaTeX documents first", () => {
        // The default must be the right answer without touching the
        // dropdown, which is the point of the whole control.
        expect(FILE_TYPES[0]?.extension).toBe("tex");
    });

    it("lists every extension only once", () => {
        const extensions = FILE_TYPES.map((type) => type.extension);

        expect(new Set(extensions).size).toBe(extensions.length);
    });

    it("matches the extensions the backend accepts", () => {
        // Offering a type the backend refuses would produce a dialog
        // that fails only on submit; accepting one the dialog omits
        // would leave files openable but not creatable.
        // Vitest runs from the repo root.
        const source = readFileSync(
            resolve(process.cwd(), "src-tauri/src/file_manager.rs"),
            "utf8",
        );

        const block = /const EDITABLE_EXTENSIONS: \[&str; \d+\] = \[([\s\S]*?)\];/.exec(source);
        expect(block, "EDITABLE_EXTENSIONS not found in file_manager.rs").not.toBeNull();

        const backendExtensions = [...(block?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map(
            (match) => match[1],
        );

        expect(backendExtensions.length).toBeGreaterThan(0);
        expect([...backendExtensions].sort()).toEqual(
            FILE_TYPES.map((type) => type.extension).sort(),
        );
    });
});
