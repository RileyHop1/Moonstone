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
import type { ViewMode } from "../../../shared/types";
import { moonstone } from "./moonstoneTheme";
import { previewCompartment, previewExtensionForMode } from "./viewMode";
import "./TextEditor.css";

/** Props for {@link TextEditor}. */
export interface TextEditorProps {
    /** Document contents the editor starts with. */
    readonly initialDoc: string;
    /** View mode the editor mounts in (compartment reconfigures later). */
    readonly initialViewMode: ViewMode;
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
    onViewReadyRef.current = onViewReady;
    onDocChangedRef.current = onDocChanged;
    onSaveRequestedRef.current = onSaveRequested;

    useEffect(() => {
        if (!hostRef.current) return;

        const editor = new EditorView({
            doc: initialDoc,
            extensions: [
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

        return () => editor.destroy();
    }, [initialDoc]);

    return <div ref={hostRef} className="view-container-text-editor" />;
}
