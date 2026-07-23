/**
 * Hand-rolled page navigation for Moonstone.
 *
 * A desktop app with three pages needs no URL router; the current page
 * is a discriminated union held in App state and switched exhaustively.
 */

import { createContext, useContext } from "react";
import type { ProjectInfo } from "./types";

/** Every page the app can display, tagged for exhaustive switching. */
export type AppPage =
    | { readonly kind: "browser" }
    | { readonly kind: "project"; readonly project: ProjectInfo }
    | { readonly kind: "settings" };

/** Value provided by the navigation context. */
export interface NavigationValue {
    /** The page currently displayed. */
    readonly page: AppPage;
    /** Switches the app to a different page. */
    readonly navigate: (page: AppPage) => void;
}

/** Context carrying the current page and the navigate function. */
export const NavigationContext = createContext<NavigationValue | null>(null);

/**
 * Accesses the navigation context.
 *
 * @returns The current page and navigate function.
 * @throws If called outside of a NavigationContext provider.
 */
export function useNavigation(): NavigationValue {
    const value = useContext(NavigationContext);

    if (!value) {
        throw new Error("useNavigation must be used inside a NavigationContext provider");
    }

    return value;
}
