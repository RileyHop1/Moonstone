/**
 * Opt-in diagnostic overlay for the editor.
 *
 * A developer-facing readout of the editor state that most often
 * explains surprising preview behaviour (active modes, cursor
 * position, what share of the document is actually rendered). It is
 * **hidden by default** and must be asked for explicitly.
 *
 * Visibility lives in a `StateField` rather than the compartment
 * pattern used by `viewMode.ts` / `modalMode.ts`: nothing here swaps
 * extensions, so a toggleable flag inside the state is both simpler
 * and reachable from a keymap without a round trip through React.
 *
 * TODO (settings pass): expose this through the settings page as a
 * persisted "Show editor diagnostics" preference, driving it via
 * {@link setDiagnosticsVisible}. Until then the keyboard shortcut is
 * the only entry point, which is deliberate — it stays out of the way
 * of ordinary users.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { collectDiagnostics } from "./collectDiagnostics";
import type { DiagnosticReport } from "./collectDiagnostics";
import "./diagnostics.css";

/** The panel starts hidden; testing is opt-in, never the default. */
export const DIAGNOSTICS_VISIBLE_BY_DEFAULT = false;

/** Keyboard shortcut that shows/hides the panel. */
export const DIAGNOSTICS_TOGGLE_KEY = "Mod-Shift-d";

/** Sets panel visibility. */
const setVisibilityEffect = StateEffect.define<boolean>();

/** Whether the diagnostic panel is currently shown. */
const diagnosticsVisibleField = StateField.define<boolean>({
    create: () => DIAGNOSTICS_VISIBLE_BY_DEFAULT,

    update(visible, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setVisibilityEffect)) return effect.value;
        }
        return visible;
    },
});

/**
 * Shows or hides the diagnostic panel.
 *
 * The intended entry point for UI outside the editor (the settings
 * page, once that pass happens).
 *
 * @param view - The editor to update.
 * @param visible - True to show the panel.
 */
export function setDiagnosticsVisible(view: EditorView, visible: boolean): void {
    view.dispatch({ effects: setVisibilityEffect.of(visible) });
}

/**
 * Reports whether the diagnostic panel is currently shown.
 *
 * @param view - The editor to query.
 * @returns True when the panel is visible.
 */
export function isDiagnosticsVisible(view: EditorView): boolean {
    return view.state.field(diagnosticsVisibleField);
}

/**
 * Renders the diagnostic report into a panel overlaying the editor.
 *
 * The panel is a child of the editor's own DOM, so it is torn down
 * with the editor — unlike a `document.body` overlay, which survives
 * remounts and leaks. Refreshes are driven by editor updates rather
 * than a timer, so an idle editor costs nothing.
 */
const diagnosticPanelPlugin = ViewPlugin.fromClass(
    class {
        private readonly panel: HTMLElement;

        constructor(view: EditorView) {
            this.panel = document.createElement("div");
            this.panel.className = "cm-diagnostic-panel";
            // Purely informational: never steal clicks from the editor.
            this.panel.setAttribute("aria-hidden", "true");
            view.dom.appendChild(this.panel);

            this.render(view);
        }

        update(update: ViewUpdate) {
            const visibilityChanged =
                update.startState.field(diagnosticsVisibleField) !==
                update.state.field(diagnosticsVisibleField);

            if (
                visibilityChanged ||
                update.docChanged ||
                update.selectionSet ||
                update.viewportChanged
            ) {
                this.render(update.view);
            }
        }

        destroy() {
            this.panel.remove();
        }

        /**
         * Repaints the panel, or hides it when diagnostics are off.
         *
         * @param view - The editor being reported on.
         */
        private render(view: EditorView): void {
            const visible = view.state.field(diagnosticsVisibleField);
            this.panel.hidden = !visible;

            // Skip building content while hidden — an invisible panel
            // must not cost anything on every keystroke.
            if (!visible) {
                this.panel.replaceChildren();
                return;
            }

            const report = collectDiagnostics(view.state, view.viewport);
            this.panel.replaceChildren(...renderReport(report));
        }
    },
);

/**
 * Builds the panel's DOM for a report.
 *
 * @param report - The sections to render.
 * @returns One element per section, plus the panel heading.
 */
function renderReport(report: DiagnosticReport): readonly HTMLElement[] {
    const heading = document.createElement("h2");
    heading.className = "cm-diagnostic-title";
    heading.textContent = "Diagnostics";

    return [heading, ...report.map(renderSection)];
}

/**
 * Builds the DOM for one report section.
 *
 * @param section - The section to render.
 * @returns The section element.
 */
function renderSection(section: DiagnosticReport[number]): HTMLElement {
    const container = document.createElement("section");
    container.className = "cm-diagnostic-section";

    const title = document.createElement("h3");
    title.className = "cm-diagnostic-section-title";
    title.textContent = section.title;
    container.appendChild(title);

    for (const field of section.fields) {
        const row = document.createElement("div");
        row.className = "cm-diagnostic-row";

        const label = document.createElement("span");
        label.className = "cm-diagnostic-label";
        label.textContent = field.label;

        const value = document.createElement("span");
        value.className = "cm-diagnostic-value";
        // textContent, never innerHTML: values derive from document
        // contents and must never be interpreted as markup.
        value.textContent = field.value;

        row.append(label, value);
        container.appendChild(row);
    }

    return container;
}

/**
 * The diagnostic overlay extension: hidden state, the panel, and the
 * shortcut that toggles it.
 *
 * @returns The combined extension.
 */
export function editorDiagnostics(): Extension {
    return [
        diagnosticsVisibleField,
        diagnosticPanelPlugin,
        keymap.of([
            {
                key: DIAGNOSTICS_TOGGLE_KEY,
                run: (view) => {
                    setDiagnosticsVisible(view, !isDiagnosticsVisible(view));
                    return true;
                },
            },
        ]),
    ];
}
