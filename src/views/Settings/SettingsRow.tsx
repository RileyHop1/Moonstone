/**
 * One labelled setting: a name on the left, its control on the right,
 * with optional explanatory text beneath.
 */

import type { ReactNode } from "react";

/** Props for {@link SettingsRow}. */
export interface SettingsRowProps {
    /** The setting's name. */
    readonly label: string;
    /** One line on what the setting does, shown under the label. */
    readonly description?: string;
    /** The control itself. */
    readonly children: ReactNode;
}

/**
 * Renders a labelled settings row.
 *
 * @param props - Label, optional description, and the control.
 * @returns The row element.
 */
export function SettingsRow({ label, description, children }: SettingsRowProps) {
    return (
        <div className="settings-row">
            <div className="settings-row-text">
                <span className="settings-label">{label}</span>
                {description && <span className="settings-description">{description}</span>}
            </div>
            <div className="settings-control">{children}</div>
        </div>
    );
}
