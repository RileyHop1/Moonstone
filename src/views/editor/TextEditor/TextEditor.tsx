/**
 * CodeMirror-based LaTeX editor with Obsidian-style live preview.
 *
 * The component is intentionally stateless about files: the parent
 * passes the initial document and remounts (via a React `key`) when a
 * different file opens, which also gives each file its own undo
 * history.
 *
 * It is *not* stateless about settings. The editor owns applying its
 * own {@link EditorConfiguration}, so a parent showing several editors
 * at once simply hands each the same object instead of dispatching
 * into each view itself.
 */

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { latex } from "codemirror-lang-latex";
import { editorDiagnostics } from "./Diagnostics";
import { editorExtensions, reconfigurationEffects } from "./editorConfiguration";
import type { EditorConfiguration } from "./editorConfiguration";
import "./TextEditor.css";

/** Props for {@link TextEditor}. */
export interface TextEditorProps {
    /** Document contents the editor starts with. */
    readonly initialDoc: string;
    /**
     * The settings this editor runs under. Applied at mount and
     * re-applied whenever the object changes, so the parent never
     * needs to hold the view to change a setting.
     */
    readonly configuration: EditorConfiguration;
    /** Called when the diagnostics shortcut toggles the overlay. */
    readonly onDiagnosticsToggled: (visible: boolean) => void;
    /** Receives the created EditorView so the parent can drive it. */
    readonly onViewReady: (view: EditorView) => void;
    /**
     * Called with the view just before it is destroyed.
     *
     * The counterpart to {@link onViewReady}: without it a parent
     * holding views by key keeps entries for editors that no longer
     * exist. CodeMirror silently ignores a dispatch to a destroyed
     * view, so a stale entry fails invisibly rather than loudly.
     */
    readonly onViewDestroyed?: ((view: EditorView) => void) | undefined;
    /** Called whenever the document changes (parent tracks dirtiness). */
    readonly onDocChanged: () => void;
    /** Called when the user presses Ctrl/Cmd+S. */
    readonly onSaveRequested: () => void;
}

/**
 * Mounts a CodeMirror editor for one file.
 *
 * @param props - Initial document, settings and lifecycle callbacks.
 * @returns The editor host element.
 */
export function TextEditor({
    initialDoc,
    configuration,
    onDiagnosticsToggled,
    onViewReady,
    onViewDestroyed,
    onDocChanged,
    onSaveRequested,
}: TextEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);

    // Keep the latest callbacks in refs so the editor is created once
    // per mount instead of rebuilding when a parent re-renders.
    const onViewReadyRef = useRef(onViewReady);
    const onViewDestroyedRef = useRef(onViewDestroyed);
    const onDocChangedRef = useRef(onDocChanged);
    const onSaveRequestedRef = useRef(onSaveRequested);
    const onDiagnosticsToggledRef = useRef(onDiagnosticsToggled);
    onViewReadyRef.current = onViewReady;
    onViewDestroyedRef.current = onViewDestroyed;
    onDocChangedRef.current = onDocChanged;
    onSaveRequestedRef.current = onSaveRequested;
    onDiagnosticsToggledRef.current = onDiagnosticsToggled;

    // The configuration the live view is actually running under, which
    // is what the next update diffs against. A ref rather than state:
    // applying it is a side effect on CodeMirror, not a render input.
    const appliedRef = useRef(configuration);

    useEffect(() => {
        if (!hostRef.current) return;

        const editor = new EditorView({
            doc: initialDoc,
            extensions: [
                ...editorExtensions(appliedRef.current),
                basicSetup,
                latex({
                    autoCloseTags: true,
                    enableLinting: true,
                    enableTooltips: true,
                    // The package would otherwise install its own
                    // `autocompletion({override: […]})`, and `override`
                    // replaces every other completion source — which
                    // silently kills reference search. Its LaTeX
                    // completions are registered through language data
                    // regardless, so basicSetup's autocompletion still
                    // offers them alongside ours.
                    enableAutocomplete: false,
                }),
                editorDiagnostics({
                    initialVisible: appliedRef.current.showDiagnostics,
                    onVisibilityChange: (visible) => {
                        onDiagnosticsToggledRef.current(visible);
                    },
                }),
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

        viewRef.current = editor;
        onViewReadyRef.current(editor);

        return () => {
            // Told before the destroy, so the parent can drop its
            // reference while the view is still a valid argument.
            onViewDestroyedRef.current?.(editor);
            viewRef.current = null;
            editor.destroy();
        };
    }, [initialDoc]);

    // Apply settings changes in place, preserving the document and undo
    // history — a remount would lose both.
    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;

        const effects = reconfigurationEffects(appliedRef.current, configuration);
        appliedRef.current = configuration;

        if (effects.length > 0) view.dispatch({ effects });
    }, [configuration]);

    return <div ref={hostRef} className="view-container-text-editor" />;
}
