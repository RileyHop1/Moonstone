/**
 * Settings page: a sidebar of sections and the panel for the selected
 * one. Every control applies immediately and is persisted by the
 * settings provider, so there is no save button.
 */

import { useState } from "react";
import { useNavigation } from "../../shared/navigation";
import { assertNever } from "../../shared/types";
import { EditorTab } from "./EditorTab";
import { GeneralTab } from "./GeneralTab";
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS } from "./settingsTabs";
import type { SettingsTabId } from "./settingsTabs";
import "./Settings.css";

/**
 * Renders the panel for a section.
 *
 * @param tab - The selected section.
 * @returns That section's controls.
 */
function renderPanel(tab: SettingsTabId) {
    switch (tab) {
        case "general":
            return <GeneralTab />;

        case "editor":
            return <EditorTab />;

        default:
            return assertNever(tab);
    }
}

/**
 * Renders the settings page.
 *
 * @returns The settings page element.
 */
export function Settings() {
    const { navigate } = useNavigation();
    const [activeTab, setActiveTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);

    return (
        <div className="settings-page">
            <header className="settings-header">
                <h1 className="settings-title">Settings</h1>
                <button
                    type="button"
                    className="settings-back-button"
                    onClick={() => navigate({ kind: "browser" })}
                >
                    ← Back to projects
                </button>
            </header>

            <div className="settings-body">
                <nav className="settings-sidebar" role="tablist" aria-label="Settings sections">
                    {SETTINGS_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={tab.id === activeTab}
                            aria-controls={`settings-panel-${tab.id}`}
                            className={`settings-tab${
                                tab.id === activeTab ? " settings-tab-active" : ""
                            }`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>

                <section
                    className="settings-panel"
                    role="tabpanel"
                    id={`settings-panel-${activeTab}`}
                >
                    {renderPanel(activeTab)}
                </section>
            </div>
        </div>
    );
}
