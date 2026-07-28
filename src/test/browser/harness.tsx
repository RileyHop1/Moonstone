/**
 * Browser-test harness: mounts the real {@link TextEditor} on a bare
 * page, with no Tauri backend behind it.
 *
 * Why this exists: jsdom has no layout, so anything that depends on
 * real geometry — tooltip placement, drag gestures, CodeMirror's
 * measure phase, key handling — cannot be tested in the vitest suites.
 * Playwright drives this page instead.
 *
 * It deliberately mounts the shipping component rather than
 * re-declaring its extension list, so the tests exercise what users
 * actually run and cannot drift from it.
 *
 * Configuration comes from the query string, keeping the page stateless
 * and letting one fixture serve every scenario:
 *
 * | Param      | Values                          | Default |
 * |------------|---------------------------------|---------|
 * | `doc`      | URL-encoded document text       | a short prose sample |
 * | `view`     | `source` \| `live` \| `readonly`| `live` |
 * | `modal`    | `none` \| `vim` \| `helix`      | `none` |
 * | `spell`    | `on` \| `off`                   | `on` |
 * | `lines`    | `absolute` \| `relative` \| `mixed` | `absolute` |
 * | `theme`    | `dark` \| `light`               | `dark` |
 * | `cursor`   | document offset to select at    | none (offset 0) |
 *
 * `cursor` matters more than it looks: the preview reveals source
 * wherever the cursor sits, so where it starts decides whether the
 * preamble is collapsed and which environments are boxed.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { EditorView } from "@codemirror/view";
import { TextEditor } from "../../views/editor/TextEditor/TextEditor";
import type { LineNumberMode, ModalMode, ViewMode } from "../../shared/types";
import "../../styles/styles.css";

/** Handle the Playwright specs drive the editor through. */
export interface HarnessWindow extends Window {
    /** The mounted editor, once CodeMirror has created it. */
    moonstoneView?: EditorView;
    /** Set true after the first mount, so specs can await readiness. */
    moonstoneReady?: boolean;
}

/** Prose with several misspellings, for spell-check scenarios. */
const DEFAULT_DOC = [
    "\\documentclass{article}",
    "",
    "\\begin{document}",
    "",
    "This sentance contains a mispelled word that the checker should flag.",
    "",
    "Another paragraph with a seperate problem worth clicking on.",
    "",
    "\\end{document}",
].join("\n");

/**
 * Reads one query parameter, falling back when it is absent or not one
 * of the values the caller accepts.
 *
 * @param name - Parameter name.
 * @param allowed - Values considered valid.
 * @param fallback - Value used when the parameter is missing or invalid.
 * @returns The chosen value.
 */
function readEnum<T extends string>(
    name: string,
    allowed: readonly T[],
    fallback: T,
): T {
    const raw = new URLSearchParams(window.location.search).get(name);
    const match = allowed.find((value) => value === raw);

    return match ?? fallback;
}

/**
 * Moves the cursor to a requested document offset.
 *
 * Out-of-range and unparseable values are ignored rather than thrown
 * on: a fixture that silently starts at offset 0 is easier to debug
 * than one that fails to mount.
 *
 * @param view - The mounted editor.
 * @param raw - The `cursor` query parameter, or null when absent.
 */
function placeCursor(view: EditorView, raw: string | null): void {
    if (raw === null) return;

    const offset = Number.parseInt(raw, 10);
    if (!Number.isInteger(offset) || offset < 0 || offset > view.state.doc.length) return;

    view.dispatch({ selection: { anchor: offset } });
}

/**
 * Mounts the editor described by the current query string.
 *
 * @returns Nothing; the editor is attached to `#harness-root`.
 */
function mountHarness(): void {
    const root = document.querySelector<HTMLDivElement>("#harness-root");
    if (!root) throw new Error("Harness root element is missing");

    const params = new URLSearchParams(window.location.search);
    const doc = params.get("doc") ?? DEFAULT_DOC;
    const theme = readEnum("theme", ["dark", "light"] as const, "dark");

    // The app sets this on the document element; the harness has no
    // settings backend, so it applies the same attribute directly.
    document.documentElement.setAttribute("data-theme", theme);

    const harnessWindow = window as HarnessWindow;

    createRoot(root).render(
        <StrictMode>
            <TextEditor
                initialDoc={doc}
                initialViewMode={readEnum<ViewMode>(
                    "view",
                    ["source", "live", "readonly"],
                    "live",
                )}
                initialModalMode={readEnum<ModalMode>(
                    "modal",
                    ["none", "vim", "helix"],
                    "none",
                )}
                initialSpellCheckEnabled={readEnum("spell", ["on", "off"] as const, "on") === "on"}
                initialLineNumberMode={readEnum<LineNumberMode>(
                    "lines",
                    ["absolute", "relative", "mixed"],
                    "absolute",
                )}
                initialShowDiagnostics={false}
                onDiagnosticsToggled={() => {}}
                initialReferences={[]}
                onViewReady={(view) => {
                    harnessWindow.moonstoneView = view;
                    placeCursor(view, params.get("cursor"));
                    harnessWindow.moonstoneReady = true;
                }}
                onDocChanged={() => {}}
                onSaveRequested={() => {}}
            />
        </StrictMode>,
    );
}

mountHarness();
