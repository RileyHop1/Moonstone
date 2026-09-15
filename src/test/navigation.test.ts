/**
 * Test suite for navigation's return-page rule: settings is a detour,
 * so leaving it goes back to the work it was opened from.
 */

import { describe, it, expect } from "vitest";
import { returnPageFor } from "../shared/navigation";
import type { AppPage, ReturnablePage } from "../shared/navigation";
import type { ProjectInfo } from "../shared/types";

/** A project fixture to navigate to. */
const PROJECT: ProjectInfo = {
    name: "thesis",
    path: "C:/root/thesis",
    lastModified: "2026-07-01T12:00:00+00:00",
    fileCount: 3,
};

/** The pages used across these cases. */
const BROWSER: ReturnablePage = { kind: "browser" };
const PROJECT_PAGE: ReturnablePage = { kind: "project", project: PROJECT };
const SETTINGS: AppPage = { kind: "settings" };

describe("returnPageFor", () => {
    it("remembers the browser when settings is opened from it", () => {
        expect(returnPageFor(SETTINGS, BROWSER, BROWSER)).toEqual(BROWSER);
    });

    it("remembers the project when settings is opened from it", () => {
        // The flow this exists for: project → settings → back to the
        // same project, rather than out to the browser.
        expect(returnPageFor(SETTINGS, PROJECT_PAGE, BROWSER)).toEqual(PROJECT_PAGE);
    });

    it("keeps the page underneath when settings is opened from settings", () => {
        // Recording settings here would make leaving it a loop.
        expect(returnPageFor(SETTINGS, SETTINGS, PROJECT_PAGE)).toEqual(PROJECT_PAGE);
    });

    it("leaves the remembered page alone when going anywhere else", () => {
        expect(returnPageFor(BROWSER, SETTINGS, PROJECT_PAGE)).toEqual(PROJECT_PAGE);
        expect(returnPageFor(PROJECT_PAGE, BROWSER, PROJECT_PAGE)).toEqual(PROJECT_PAGE);
    });

    it("survives a round trip through settings", () => {
        // browser → project → settings → back, as a user would do it.
        let remembered: ReturnablePage = BROWSER;

        remembered = returnPageFor(PROJECT_PAGE, BROWSER, remembered);
        remembered = returnPageFor(SETTINGS, PROJECT_PAGE, remembered);

        expect(remembered).toEqual(PROJECT_PAGE);
    });
});
