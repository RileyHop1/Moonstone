/**
 * The global hot bar shown at the top of every page.
 *
 * Menu contents come from the pure builders in `globalHotBarMenus.ts`;
 * this component only wires the contexts in and renders the
 * dropdowns. Items whose action is unavailable on the current page
 * render disabled.
 */

import { useMemo } from "react";
import DropDown from "./DropDown";
import type { DropDownOption } from "./DropDown";
import styles from "../styles/GlobalHotBar.module.css";
import { buildMenus } from "./globalHotBarMenus";
import type { Menu } from "./globalHotBarMenus";
import { useAppActions } from "../shared/appActions";
import { useNavigation } from "../shared/navigation";
import { useSettings } from "../shared/settings";

/**
 * Renders the hot bar menus and routes selections to the registered
 * page actions.
 *
 * @returns The hot bar element.
 */
export default function GlobalHotBar() {
    const { actions } = useAppActions();
    const { navigate } = useNavigation();
    const { settings, updateSettings } = useSettings();

    const menus = useMemo<readonly Menu[]>(
        () =>
            buildMenus({
                actions,
                editor: actions.editor,
                navigate,
                settings,
                updateSettings,
            }),
        [actions, navigate, settings, updateSettings],
    );

    /**
     * Runs the action behind a clicked menu item.
     *
     * @param menu - The menu the click came from.
     * @param label - The clicked item's label.
     */
    function handleSelect(menu: Menu, label: string): void {
        const item = menu.items.find((candidate) => candidate.label === label);

        item?.action?.();
    }

    return (
        <div className={styles.HotBar}>
            {menus.map((menu) => (
                <DropDown
                    key={menu.name}
                    name={menu.name}
                    options={menu.items.map(
                        (item): DropDownOption => ({
                            label: item.label,
                            disabled: item.action === null,
                        }),
                    )}
                    onSelect={(label) => handleSelect(menu, label)}
                />
            ))}
        </div>
    );
}
