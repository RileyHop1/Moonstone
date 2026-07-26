/**
 * General settings: preferences that apply to the whole application
 * rather than to the editor.
 */

import { useSettings } from "../../shared/settings";
import type { Theme } from "../../shared/types";
import { ChoiceButtons } from "./ChoiceButtons";
import { SettingsRow } from "./SettingsRow";

/** The selectable themes, in display order. */
const THEME_CHOICES: readonly { readonly value: Theme; readonly label: string }[] = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
];

/**
 * Renders the general settings panel.
 *
 * @returns The panel element.
 */
export function GeneralTab() {
    const { settings, updateSettings } = useSettings();

    return (
        <SettingsRow label="Theme" description="Applies immediately across the app.">
            <ChoiceButtons
                label="Theme"
                choices={THEME_CHOICES}
                value={settings.theme}
                onChange={(theme) => updateSettings({ theme })}
            />
        </SettingsRow>
    );
}
