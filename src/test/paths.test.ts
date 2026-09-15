/**
 * Tests for the shared path helpers.
 *
 * These replaced four hand-rolled copies that disagreed about the edge
 * cases, so the edge cases are most of what is worth testing: paths
 * with no separator, mixed separators, and names that merely share a
 * prefix with a directory.
 */

import { describe, expect, it } from "vitest";
import {
    basename,
    dirname,
    isAbsolute,
    isAtOrInside,
    relativeTo,
    isInside,
    join,
    reparent,
    segmentsOf,
    separatorOf,
} from "../shared/paths";

describe("basename", () => {
    it.each([
        ["C:\\project\\main.tex", "main.tex"],
        ["C:/project/main.tex", "main.tex"],
        ["C:\\project\\chapters", "chapters"],
        ["main.tex", "main.tex"],
        ["", ""],
    ])("reads %s as %s", (path, expected) => {
        expect(basename(path)).toBe(expected);
    });

    it("handles a path that mixes separators", () => {
        expect(basename("C:/project\\chapters/intro.tex")).toBe("intro.tex");
    });
});

describe("dirname", () => {
    it.each([
        ["C:\\project\\main.tex", "C:\\project"],
        ["C:/project/main.tex", "C:/project"],
        ["C:\\project\\chapters\\intro.tex", "C:\\project\\chapters"],
    ])("reads %s as %s", (path, expected) => {
        expect(dirname(path)).toBe(expected);
    });

    it("returns nothing for a bare name", () => {
        // The original in `tauri.ts` did `slice(0, Math.max(-1, -1))`,
        // which is `slice(0, -1)` — it silently dropped the last
        // character and called the result a directory.
        expect(dirname("main.tex")).toBe("");
    });

    it("does not truncate a bare name", () => {
        expect(dirname("main.tex")).not.toBe("main.te");
    });

    it("returns nothing for an empty path", () => {
        expect(dirname("")).toBe("");
    });
});

describe("join", () => {
    it("keeps the directory's separator style", () => {
        expect(join("C:\\project", "main.tex")).toBe("C:\\project\\main.tex");
        expect(join("C:/project", "main.tex")).toBe("C:/project/main.tex");
    });

    it("returns the bare name when there is no directory", () => {
        expect(join("", "main.tex")).toBe("main.tex");
    });
});

describe("isInside", () => {
    it.each([
        ["C:\\project", "C:\\project\\main.tex", true],
        ["C:\\project", "C:\\project\\chapters\\intro.tex", true],
        ["C:\\project", "C:/project/main.tex", true],
        ["C:\\project", "C:\\project", false],
        ["C:\\project", "C:\\elsewhere\\main.tex", false],
    ])("%s contains %s: %s", (parent, candidate, expected) => {
        expect(isInside(parent, candidate)).toBe(expected);
    });

    it("requires a separator, not just a prefix", () => {
        // The case a bare `startsWith` gets wrong: a sibling whose name
        // begins with the directory's name is not inside it.
        expect(isInside("C:\\project", "C:\\project-notes\\main.tex")).toBe(false);
    });
});

describe("isAtOrInside", () => {
    it("counts the entry itself", () => {
        expect(isAtOrInside("C:\\project\\main.tex", "C:\\project\\main.tex")).toBe(true);
    });

    it("counts a descendant", () => {
        expect(isAtOrInside("C:\\project", "C:\\project\\main.tex")).toBe(true);
    });

    it("excludes a prefix-sharing sibling", () => {
        expect(isAtOrInside("C:\\project", "C:\\project-notes")).toBe(false);
    });
});

describe("reparent", () => {
    it("rewrites the entry itself", () => {
        expect(reparent("C:\\p\\old.tex", "C:\\p\\old.tex", "C:\\p\\new.tex")).toBe(
            "C:\\p\\new.tex",
        );
    });

    it("rewrites a file inside a renamed directory", () => {
        expect(reparent("C:\\p\\old\\main.tex", "C:\\p\\old", "C:\\p\\new")).toBe(
            "C:\\p\\new\\main.tex",
        );
    });

    it("rewrites a deeply nested file", () => {
        expect(reparent("C:\\p\\old\\a\\b.tex", "C:\\p\\old", "C:\\p\\new")).toBe(
            "C:\\p\\new\\a\\b.tex",
        );
    });

    it("reports an unaffected path as null", () => {
        expect(reparent("C:\\p\\other.tex", "C:\\p\\old", "C:\\p\\new")).toBeNull();
    });

    it("does not rewrite a prefix-sharing sibling", () => {
        expect(reparent("C:\\p\\older.tex", "C:\\p\\old", "C:\\p\\new")).toBeNull();
    });
});

describe("segmentsOf", () => {
    it("splits on either separator", () => {
        expect(segmentsOf("C:/project\\chapters/intro.tex")).toEqual([
            "C:",
            "project",
            "chapters",
            "intro.tex",
        ]);
    });
});

describe("separatorOf", () => {
    it("prefers the backslash a Windows path already uses", () => {
        expect(separatorOf("C:\\project")).toBe("\\");
    });

    it("falls back to a slash", () => {
        expect(separatorOf("project/chapters")).toBe("/");
        expect(separatorOf("main.tex")).toBe("/");
    });
});

describe("isAbsolute", () => {
    it.each([
        ["C:\\project\\main.tex", true],
        ["C:/project/main.tex", true],
        ["\\network\\share", true],
        ["/usr/share", true],
        ["chapters/intro.tex", false],
        ["main.tex", false],
        ["", false],
    ])("reads %s as %s", (path, expected) => {
        expect(isAbsolute(path)).toBe(expected);
    });
});

describe("relativeTo", () => {
    it("strips the containing directory", () => {
        expect(relativeTo("C:/projects/thesis", "C:/projects/thesis/main.tex")).toBe(
            "main.tex",
        );
    });

    it("keeps intermediate directories", () => {
        expect(relativeTo("C:/projects/thesis", "C:/projects/thesis/chapters/one.tex")).toBe(
            "chapters/one.tex",
        );
    });

    it("matches across mixed separators", () => {
        // The backend returns backslashes; LaTeX and the compile engine
        // speak forward slashes. Both reach this function.
        expect(relativeTo("C:\\projects\\thesis", "C:/projects/thesis/main.tex")).toBe(
            "main.tex",
        );
    });

    it("always answers in forward slashes", () => {
        // What the LaTeX engine reports diagnostics in, so a relative
        // path is compared against engine output more often than it is
        // joined onto a Windows path.
        expect(
            relativeTo("C:\\projects\\thesis", "C:\\projects\\thesis\\chapters\\one.tex"),
        ).toBe("chapters/one.tex");
    });

    it("refuses a path outside the directory", () => {
        expect(relativeTo("C:/projects/thesis", "C:/projects/other/main.tex")).toBeNull();
    });

    it("is not fooled by a sibling sharing a prefix", () => {
        // `thesis-old` starts with `thesis`, which a naive prefix check
        // would accept.
        expect(relativeTo("C:/projects/thesis", "C:/projects/thesis-old/main.tex")).toBeNull();
    });

    it("refuses the directory itself", () => {
        // A directory is not a file inside itself, and returning "" here
        // would hand the compiler an empty main file.
        expect(relativeTo("C:/projects/thesis", "C:/projects/thesis")).toBeNull();
    });
});
