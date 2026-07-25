/**
 * CodeMirror-based LaTeX editor with Obsidian-style live preview.
 *
 * The component is intentionally stateless about files: the parent
 * passes the initial document and remounts (via a React `key`) when a
 * different file opens, which also gives each file its own undo
 * history.
 */

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { latex } from "codemirror-lang-latex";
import type { ModalMode, ViewMode } from "../../../shared/types";
import { moonstone } from "./moonstoneTheme";
import { previewCompartment, previewExtensionForMode } from "./viewMode";
import { modalCompartment, modalExtensionForMode } from "./modalMode";
import "./TextEditor.css";

/** Props for {@link TextEditor}. */
export interface TextEditorProps {
    /** Document contents the editor starts with. */
    readonly initialDoc: string;
    /** View mode the editor mounts in (compartment reconfigures later). */
    readonly initialViewMode: ViewMode;
    /** Modal editing mode at mount (compartment reconfigures later). */
    readonly initialModalMode: ModalMode;
    /** Receives the created EditorView so the parent can drive it. */
    readonly onViewReady: (view: EditorView) => void;
    /** Called whenever the document changes (parent tracks dirtiness). */
    readonly onDocChanged: () => void;
    /** Called when the user presses Ctrl/Cmd+S. */
    readonly onSaveRequested: () => void;
}

/**
 * Mounts a CodeMirror editor for one file.
 *
 * @param props - Initial document and lifecycle callbacks.
 * @returns The editor host element.
 */
export function TextEditor({
    initialDoc,
    initialViewMode,
    initialModalMode,
    onViewReady,
    onDocChanged,
    onSaveRequested,
}: TextEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);

    // Keep the latest callbacks in refs so the editor is created once
    // per mount instead of rebuilding when a parent re-renders.
    const onViewReadyRef = useRef(onViewReady);
    const onDocChangedRef = useRef(onDocChanged);
    const onSaveRequestedRef = useRef(onSaveRequested);
    const initialViewModeRef = useRef(initialViewMode);
    const initialModalModeRef = useRef(initialModalMode);
    onViewReadyRef.current = onViewReady;
    onDocChangedRef.current = onDocChanged;
    onSaveRequestedRef.current = onSaveRequested;

    useEffect(() => {
        if (!hostRef.current) return;

        const editor = new EditorView({
            doc: initialDoc,
            extensions: [
                // Modal keymap first: Vim/Helix register high-precedence
                // keymaps that must see keys before the default bindings.
                modalCompartment.of(modalExtensionForMode(initialModalModeRef.current)),
                basicSetup,
                latex({
                    autoCloseTags: true,
                    enableLinting: true,
                    enableTooltips: true,
                }),
                moonstone,
                previewCompartment.of(previewExtensionForMode(initialViewModeRef.current)),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) onDocChangedRef.current();
                }),
                // High precedence so Ctrl+S wins over any default binding.
                Prec.high(
                    keymap.of([
                        {
                            key: "Mod-s",
                            run: () => {
                                onSaveRequestedRef.current();
                                return true;
                            },
                        },
                    ]),
                ),
            ],
            parent: hostRef.current,
        });

        onViewReadyRef.current(editor);

        // TEMP DIAGNOSTIC — remove after debugging the modal-mode blue overlay.
        const dbg = document.createElement("div");
        dbg.style.cssText =
            "position:fixed;top:130px;right:8px;z-index:99999;max-width:360px;" +
            "background:#000;color:#0f0;font:11px monospace;padding:6px;" +
            "white-space:pre-wrap;border:1px solid #0f0;pointer-events:none";
        document.body.appendChild(dbg);
        const dump = () => {
            // Read the LIVE on-screen editor, not the closure instance
            // (StrictMode double-mount can leave this closure on a dead one).
            const ed = document.querySelector(".cm-editor") as HTMLElement | null;
            if (!ed) {
                dbg.textContent = "no .cm-editor";
                return;
            }
            const isBlue = (el: Element): boolean => {
                const bg = getComputedStyle(el).backgroundColor;
                return bg.includes("169, 198, 255");
            };
            // Find every element painted with the moon-blue background and
            // summarise them by class + rough size.
            const all = ed.querySelectorAll<HTMLElement>("*");
            const blues = new Map<string, { count: number; maxH: number }>();
            all.forEach((el) => {
                if (!isBlue(el)) return;
                const key = el.className || el.tagName;
                const prev = blues.get(key) ?? { count: 0, maxH: 0 };
                blues.set(key, {
                    count: prev.count + 1,
                    maxH: Math.max(prev.maxH, el.offsetHeight),
                });
            });
            const blueLines = [...blues.entries()].map(
                ([k, v]) => `  ${k} x${v.count} h≤${v.maxH}`,
            );
            dbg.textContent = [
                `editorClasses=${ed.className}`,
                `bluesFound=${blues.size}`,
                ...blueLines,
            ].join("\n");
        };
        const dbgTimer = window.setInterval(dump, 500);
        dump();

        return () => {
            window.clearInterval(dbgTimer);
            dbg.remove();
            editor.destroy();
        };
    }, [initialDoc]);

    return <div ref={hostRef} className="view-container-text-editor" />;
}
