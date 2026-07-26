/**
 * The settings page's tabs.
 *
 * Kept apart from the page so the list is a plain value: adding a
 * section is a one-line change here plus its panel, and tests can
 * assert on the tabs without rendering anything.
 */

/** Identifier of a settings section. */
export type SettingsTabId = "general" | "editor" | "advanced";

/** One entry in the settings sidebar. */
export interface SettingsTab {
    /** Identifier used for selection and panel wiring. */
    readonly id: SettingsTabId;
    /** Name shown in the sidebar. */
    readonly label: string;
}

/** Sections in sidebar order, general first. */
export const SETTINGS_TABS: readonly SettingsTab[] = [
    { id: "general", label: "General" },
    { id: "editor", label: "Editor" },
    { id: "advanced", label: "Advanced" },
];

/** The section the page opens on. */
export const DEFAULT_SETTINGS_TAB: SettingsTabId = "general";
