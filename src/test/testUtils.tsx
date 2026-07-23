/**
 * Test rendering helpers: wraps components in the navigation and
 * app-actions providers and records navigation calls.
 */

import { render } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { NavigationContext } from "../shared/navigation";
import type { AppPage, NavigationValue } from "../shared/navigation";
import { AppActionsProvider } from "../shared/appActions";
import { SettingsProvider } from "../shared/settings";

/** A render result extended with the recorded navigation calls. */
export interface ProviderRenderResult extends RenderResult {
    /** Every page passed to navigate(), in call order. */
    readonly navigateCalls: readonly AppPage[];
}

/**
 * Renders a component inside the app's providers.
 *
 * @param ui - The element to render.
 * @param page - The page the fake navigation reports as current.
 * @returns The render result plus recorded navigate calls.
 */
export function renderWithProviders(
    ui: ReactElement,
    page: AppPage = { kind: "browser" },
): ProviderRenderResult {
    const navigateCalls: AppPage[] = [];

    const navigation: NavigationValue = {
        page,
        navigate: (nextPage) => {
            navigateCalls.push(nextPage);
        },
    };

    const result = render(
        <NavigationContext.Provider value={navigation}>
            <SettingsProvider>
                <AppActionsProvider>{ui}</AppActionsProvider>
            </SettingsProvider>
        </NavigationContext.Provider>,
    );

    return { ...result, navigateCalls };
}
