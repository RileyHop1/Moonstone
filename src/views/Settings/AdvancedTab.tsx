/**
 * Advanced settings: developer-facing switches that most users never
 * need to touch.
 */

import { useSettings } from "../../shared/settings";
import { DIAGNOSTICS_TOGGLE_KEY } from "../editor/TextEditor/Diagnostics";
import { SettingsRow } from "./SettingsRow";
import { ToggleSwitch } from "./ToggleSwitch";

/**
 * Spells a CodeMirror key binding the way a user would read it.
 *
 * @param binding - The binding, e.g. `Mod-Shift-d`.
 * @returns A readable shortcut, e.g. `Ctrl+Shift+D`.
 */
function describeShortcut(binding: string): string {
    return binding
        .split("-")
        .map((part) => (part === "Mod" ? "Ctrl" : part))
        .map((part) => (part.length === 1 ? part.toUpperCase() : part))
        .join("+");
}

/**
 * Renders the advanced settings panel.
 *
 * @returns The panel element.
 */
export function AdvancedTab() {
    const { settings, updateSettings } = useSettings();

    return (
        <SettingsRow
            label="Show editor diagnostics"
            description={`An overlay reporting editor state — active modes, cursor position, how much of the document is rendered. Also toggled with ${describeShortcut(
                DIAGNOSTICS_TOGGLE_KEY,
            )}.`}
        >
            <ToggleSwitch
                label="Show editor diagnostics"
                checked={settings.showDiagnostics}
                onChange={(showDiagnostics) => updateSettings({ showDiagnostics })}
            />
        </SettingsRow>
    );
}
