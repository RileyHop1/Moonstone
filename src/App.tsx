/**
 * Application shell: providers, titlebar, hot bar, and the page
 * switch.
 */

import { useCallback, useMemo, useState } from "react";
import GlobalHotBar from "./components/GlobalHotBar";
import { NavigationContext, returnPageFor } from "./shared/navigation";
import type { AppPage, NavigationValue, ReturnablePage } from "./shared/navigation";
import { AppActionsProvider } from "./shared/appActions";
import { SettingsProvider } from "./shared/settings";
import { assertNever } from "./shared/types";
import { ProjectBrowser } from "./views/ProjectBrowser";
import { ProjectPage } from "./views/ProjectPage";
import { Settings } from "./views/Settings";

/**
 * Renders the page the user is working in.
 *
 * This stays mounted while settings is open — settings is a detour,
 * and unmounting the project page would throw away the open document,
 * its unsaved edits, undo history and scroll position, then silently
 * reload from disk on the way back.
 *
 * @param page - The page being worked in.
 * @param isActive - False while settings covers it.
 * @returns The page element.
 */
function renderWorkPage(page: ReturnablePage, isActive: boolean) {
    switch (page.kind) {
        case "browser":
            return <ProjectBrowser />;

        case "project":
            return <ProjectPage project={page.project} isActive={isActive} />;

        default:
            return assertNever(page);
    }
}

/**
 * The application root: hosts navigation state and the global chrome
 * (titlebar + hot bar) around the active page.
 *
 * @returns The app element.
 */
export function App() {
    const [page, setPage] = useState<AppPage>({ kind: "browser" });
    const [returnPage, setReturnPage] = useState<ReturnablePage>({ kind: "browser" });

    // Opening settings records where it was opened from, so leaving it
    // goes back rather than dumping the user at the project browser.
    const navigate = useCallback(
        (destination: AppPage): void => {
            setReturnPage((remembered) => returnPageFor(destination, page, remembered));
            setPage(destination);
        },
        [page],
    );

    const navigation = useMemo<NavigationValue>(
        () => ({ page, navigate, returnPage }),
        [page, navigate, returnPage],
    );

    // While settings is open the page underneath is the one it was
    // opened from, and it keeps rendering behind it.
    const isSettingsOpen = page.kind === "settings";
    const workPage: ReturnablePage = isSettingsOpen ? returnPage : page;

    return (
        <NavigationContext.Provider value={navigation}>
            <SettingsProvider>
                <AppActionsProvider>
                    <div className="app">
                        <header className="titlebar">
                            <span className="titlebar-title">Moonstone</span>
                            {page.kind === "project" && (
                                <span className="titlebar-project">— {page.project.name}</span>
                            )}
                        </header>

                        <GlobalHotBar />

                        {/* Hidden rather than unmounted, so the work
                            survives a trip through settings. */}
                        <div className="app-page" hidden={isSettingsOpen}>
                            {renderWorkPage(workPage, !isSettingsOpen)}
                        </div>

                        {isSettingsOpen && <Settings />}
                    </div>
                </AppActionsProvider>
            </SettingsProvider>
        </NavigationContext.Provider>
    );
}
