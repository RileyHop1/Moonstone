/**
 * Editor settings: preferences that change how the document is edited
 * and displayed.
 */

import { FONT_SIZE_MAX, FONT_SIZE_MIN, useSettings } from "../../shared/settings";
import { SettingsRow } from "./SettingsRow";

/**
 * Renders the editor settings panel.
 *
 * @returns The panel element.
 */
export function EditorTab() {
    const { settings, updateSettings } = useSettings();

    return (
        <SettingsRow
            label="Font size"
            description={`Between ${FONT_SIZE_MIN} and ${FONT_SIZE_MAX} pixels.`}
        >
            <input
                className="settings-number-input"
                type="number"
                aria-label="Font size"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                value={settings.editorFontSize}
                onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (Number.isNaN(parsed)) return;

                    updateSettings({ editorFontSize: parsed });
                }}
            />
        </SettingsRow>
    );
}
