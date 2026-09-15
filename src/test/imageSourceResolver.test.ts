/**
 * Test suite for the `\includegraphics` path resolver, which turns
 * LaTeX image paths into URLs the webview can load.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The resolver short-circuits outside Tauri, so both the bridge check
 * and the URL conversion are stubbed to exercise the real logic.
 */
vi.mock("@tauri-apps/api/core", () => ({
    isTauri: () => true,
    convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
    invoke: vi.fn(),
}));

const { createImageSourceResolver } = await import("../shared/tauri");

/** A Windows-style document path, as the backend returns. */
const DOCUMENT_PATH = "C:\\Users\\me\\Documents\\Moonstone\\demo\\main.tex";

/**
 * Decodes a resolved asset URL back into the path it wraps.
 *
 * @param url - The resolved URL, or null.
 * @returns The underlying path, or null.
 */
function pathOf(url: string | null): string | null {
    if (url === null) return null;
    return decodeURIComponent(url.replace("asset://localhost/", ""));
}

describe("createImageSourceResolver", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("resolves a relative path against the document's directory", () => {
        const resolve = createImageSourceResolver(DOCUMENT_PATH);

        expect(pathOf(resolve("plot.png"))).toBe(
            "C:\\Users\\me\\Documents\\Moonstone\\demo\\plot.png",
        );
    });

    it("resolves a subdirectory path using the document's separator", () => {
        const resolve = createImageSourceResolver(DOCUMENT_PATH);

        expect(pathOf(resolve("figures/plot.png"))).toBe(
            "C:\\Users\\me\\Documents\\Moonstone\\demo\\figures\\plot.png",
        );
    });

    it("handles posix document paths", () => {
        const resolve = createImageSourceResolver("/home/me/Moonstone/demo/main.tex");

        expect(pathOf(resolve("figures/plot.png"))).toBe(
            "/home/me/Moonstone/demo/figures/plot.png",
        );
    });

    it("refuses paths escaping the document directory", () => {
        const resolve = createImageSourceResolver(DOCUMENT_PATH);

        expect(resolve("../secrets.png")).toBeNull();
        expect(resolve("figures/../../secrets.png")).toBeNull();
    });

    it("refuses a path with no file extension", () => {
        const resolve = createImageSourceResolver(DOCUMENT_PATH);

        // LaTeX would probe for an extension; that needs filesystem
        // access, so these render as placeholders instead.
        expect(resolve("plot")).toBeNull();
    });

    it("passes absolute paths through unchanged", () => {
        const resolve = createImageSourceResolver(DOCUMENT_PATH);

        expect(pathOf(resolve("D:\\shared\\logo.png"))).toBe("D:\\shared\\logo.png");
    });

    it("resolves nothing when no document is open", () => {
        const resolve = createImageSourceResolver(null);

        expect(resolve("plot.png")).toBeNull();
    });
});
