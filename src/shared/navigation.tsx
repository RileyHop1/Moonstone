/**
 * Hand-rolled page navigation for Moonstone.
 *
 * A desktop app with three pages needs no URL router; the current page
 * is a discriminated union held in App state and switched exhaustively.
 */

import { createContext, useContext } from "react";
import type { ProjectInfo } from "./types";

/**
 * The pages settings can be left for: the work the user was doing
 * before they opened it.
 *
 * Settings is deliberately not one of them, so "remembered page" can
 * never be settings itself — the type makes the loop unrepresentable
 * rather than guarding against it at every use.
 */
export type ReturnablePage =
    | { readonly kind: "browser" }
    | { readonly kind: "project"; readonly project: ProjectInfo };

/** Every page the app can display, tagged for exhaustive switching. */
export type AppPage = ReturnablePage | { readonly kind: "settings" };

/** Value provided by the navigation context. */
export interface NavigationValue {
    /** The page currently displayed. */
    readonly page: AppPage;
    /** Switches the app to a different page. */
    readonly navigate: (page: AppPage) => void;
    /**
     * Where leaving settings should go: whatever the user was on when
     * they opened it.
     */
    readonly returnPage: ReturnablePage;
}

/**
 * Decides which page to remember as settings' way out.
 *
 * Only opening settings changes what "back" means, and settings opened
 * from settings keeps the page underneath it — otherwise leaving would
 * land the user back in settings.
 *
 * @param destination - The page being navigated to.
 * @param current - The page being navigated away from.
 * @param remembered - The page currently remembered as the way out.
 * @returns The page to remember after this navigation.
 */
export function returnPageFor(
    destination: AppPage,
    current: AppPage,
    remembered: ReturnablePage,
): ReturnablePage {
    if (destination.kind !== "settings") return remembered;

    if (current.kind === "settings") return remembered;

    return current;
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
