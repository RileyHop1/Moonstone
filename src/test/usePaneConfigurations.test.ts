/**
 * Tests for the per-file editor configuration.
 *
 * This exists because of a real bug. When the project page gained a
 * second pane it kept building *one* configuration and handing it to
 * every pane — but two of its fields follow the open document, not the
 * user's preferences. So an unfocused pane resolved `\includegraphics`
 * against whichever directory the *focused* pane was in, and every pane
 * was parsed as whatever file type the focused one happened to be.
 *
 * Two properties are tested, and both matter:
 *
 * - **Correctness** — a pane's configuration follows its own file.
 * - **Identity** — the same path yields the same object. `TextEditor`
 *   diffs the object it is handed, so a fresh one per render would
 *   reconfigure every compartment in every pane on every render,
 *   rebuilding preview decorations and resetting modal state.
 */

import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * The image resolver short-circuits outside Tauri, so the bridge is
 * stubbed — otherwise every pane would get the same do-nothing resolver
 * and the bug under test would be invisible.
 */
vi.mock("@tauri-apps/api/core", () => ({
    isTauri: () => true,
    convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
    invoke: vi.fn(),
}));

import type { EditorConfiguration } from "../views/editor/TextEditor/editorConfiguration";

const { usePaneConfigurations } = await import("../views/ProjectPage/usePaneConfigurations");
const { editorProfileForExtension } = await import("../views/editor/TextEditor/editorProfile");

/** Everything the hook takes: a configuration minus its per-file parts. */
type SharedSettings = Omit<EditorConfiguration, "profile" | "resolveImageSource">;

/** Settings shared by every pane, at known values. */
const SHARED: SharedSettings = {
    viewMode: "live",
    modalMode: "none",
    spellCheckEnabled: true,
    theme: "dark",
    lineNumberMode: "absolute",
    showDiagnostics: false,
    references: [],
    openLink: undefined,
};

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

describe("usePaneConfigurations", () => {
    it("resolves each pane's images against that pane's own directory", () => {
        // The bug: both panes used to resolve against the active
        // document, so `plot.png` in the appendix pane pointed at
        // `chapters/`.
        const { result } = renderHook(() => usePaneConfigurations(SHARED));

        const chapter = result.current("/project/chapters/intro.tex");
        const appendix = result.current("/project/appendix/extra.tex");

        expect(pathOf(chapter.resolveImageSource?.("plot.png") ?? null)).toBe(
            "/project/chapters/plot.png",
        );
        expect(pathOf(appendix.resolveImageSource?.("plot.png") ?? null)).toBe(
            "/project/appendix/plot.png",
        );
    });

    it("gives each pane the profile for its own file type", () => {
        const { result } = renderHook(() => usePaneConfigurations(SHARED));

        expect(result.current("/project/main.tex").profile).toBe(
            editorProfileForExtension("tex"),
        );
        expect(result.current("/project/refs.bib").profile).toBe(
            editorProfileForExtension("bib"),
        );
    });

    it("carries the shared settings through unchanged", () => {
        const { result } = renderHook(() => usePaneConfigurations(SHARED));
        const configuration = result.current("/project/main.tex");

        expect(configuration.theme).toBe("dark");
        expect(configuration.spellCheckEnabled).toBe(true);
        expect(configuration.viewMode).toBe("live");
    });

    it("returns the same object for the same path", () => {
        const { result } = renderHook(() => usePaneConfigurations(SHARED));

        expect(result.current("/project/main.tex")).toBe(result.current("/project/main.tex"));
    });

    it("keeps a pane's object stable when an unrelated pane opens a file", () => {
        // The failure this prevents: opening a file in pane 2 rebuilds
        // the map, and pane 1's editor reconfigures every compartment
        // for a configuration that did not actually change.
        const { result, rerender } = renderHook(() => usePaneConfigurations(SHARED));
        const before = result.current("/project/main.tex");

        result.current("/project/chapters/intro.tex");
        rerender();

        expect(result.current("/project/main.tex")).toBe(before);
    });

    it("keeps objects stable across a render that changes nothing", () => {
        const { result, rerender } = renderHook(() => usePaneConfigurations(SHARED));
        const before = result.current("/project/main.tex");

        rerender();

        expect(result.current("/project/main.tex")).toBe(before);
    });

    it("rebuilds when the shared settings change, so panes follow a theme switch", () => {
        const { result, rerender } = renderHook(
            ({ settings }: { settings: SharedSettings }) => usePaneConfigurations(settings),
            { initialProps: { settings: { ...SHARED } } },
        );
        const before = result.current("/project/main.tex");

        rerender({ settings: { ...SHARED, theme: "light" } });
        const after = result.current("/project/main.tex");

        expect(after).not.toBe(before);
        expect(after.theme).toBe("light");
    });

    it("gives an empty pane a configuration rather than failing", () => {
        const { result } = renderHook(() => usePaneConfigurations(SHARED));
        const empty = result.current(null);

        expect(empty.profile.usesLatexLanguage).toBe(false);
        expect(empty.resolveImageSource?.("plot.png")).toBeNull();
    });
});
