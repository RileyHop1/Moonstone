/**
 * Project browser page.
 *
 * Shows every project under the Moonstone root in a grid; double-click
 * opens a project, and the New Project dialog (also reachable from the
 * hotbar) creates one.
 */

import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu } from "../../components/ContextMenu";
import { NameDialog } from "../../components/NameDialog";
import type { NameDialogResult } from "../../components/NameDialog";
import { useNavigation } from "../../shared/navigation";
import { useAppActions } from "../../shared/appActions";
import { deleteProject, listProjects, renameProject } from "../../shared/tauri";
import { assertNever } from "../../shared/types";
import type { LoadState, ProjectInfo } from "../../shared/types";
import { ProjectCard } from "./ProjectCard";
import { NewProjectDialog } from "./NewProjectDialog";
import "./ProjectBrowser.css";

/** Where the project context menu is open, and for which project. */
interface MenuState {
    readonly x: number;
    readonly y: number;
    readonly project: ProjectInfo;
}

/**
 * Renders the project grid with loading, error, and empty states, and
 * hosts the new-project dialog.
 *
 * @returns The project browser page element.
 */
export function ProjectBrowser() {
    const { navigate } = useNavigation();
    const { registerNewProject } = useAppActions();
    const [projects, setProjects] = useState<LoadState<readonly ProjectInfo[]>>({
        status: "loading",
    });
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [menu, setMenu] = useState<MenuState | null>(null);
    const [renaming, setRenaming] = useState<ProjectInfo | null>(null);

    const loadProjects = useCallback(async (): Promise<void> => {
        setProjects({ status: "loading" });

        const result = await listProjects();

        setProjects(
            result.ok
                ? { status: "ready", data: result.data }
                : { status: "error", message: result.error },
        );
    }, []);

    // Initial fetch. The cancelled flag keeps StrictMode's unmounted
    // first pass from racing the surviving one.
    useEffect(() => {
        let cancelled = false;

        void (async () => {
            const result = await listProjects();
            if (cancelled) return;

            setProjects(
                result.ok
                    ? { status: "ready", data: result.data }
                    : { status: "error", message: result.error },
            );
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Let the hotbar's File > New Project open our dialog.
    useEffect(() => {
        registerNewProject(() => setIsDialogOpen(true));

        return () => registerNewProject(null);
    }, [registerNewProject]);

    const openProject = useCallback(
        (project: ProjectInfo) => navigate({ kind: "project", project }),
        [navigate],
    );

    /**
     * Opens the context menu for a project card at the cursor.
     */
    const openMenu = useCallback((event: ReactMouseEvent, project: ProjectInfo) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, project });
    }, []);

    /**
     * Renames the project the rename dialog is open for.
     *
     * @param result - The validated name from the dialog.
     * @returns An inline error message, or null on success.
     */
    const handleRenameProject = useCallback(
        async ({ name }: NameDialogResult): Promise<string | null> => {
            if (!renaming) return null;

            const result = await renameProject(renaming.path, name);
            if (!result.ok) return result.error;

            setRenaming(null);
            void loadProjects();
            return null;
        },
        [renaming, loadProjects],
    );

    /**
     * Confirms and deletes a project, then reloads the grid.
     */
    const handleDeleteProject = useCallback(
        async (project: ProjectInfo): Promise<void> => {
            const confirmed = window.confirm(
                `Delete the project "${project.name}"? It will be moved to the recycle bin.`,
            );
            if (!confirmed) return;

            const result = await deleteProject(project.path);

            if (!result.ok) {
                setProjects({ status: "error", message: result.error });
                return;
            }

            void loadProjects();
        },
        [loadProjects],
    );

    return (
        <div className="project-browser">
            <h1 className="project-browser-title">Projects</h1>

            {renderContent(projects, openProject, openMenu, () => setIsDialogOpen(true), loadProjects)}

            {isDialogOpen && (
                <NewProjectDialog
                    onCreated={(project) => {
                        setIsDialogOpen(false);
                        openProject(project);
                    }}
                    onCancel={() => setIsDialogOpen(false)}
                />
            )}

            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={[
                        {
                            label: "Rename",
                            onClick: () => setRenaming(menu.project),
                        },
                        {
                            label: "Delete",
                            danger: true,
                            onClick: () => void handleDeleteProject(menu.project),
                        },
                    ]}
                    onClose={() => setMenu(null)}
                />
            )}

            {renaming && (
                <NameDialog
                    title="Rename Project"
                    placeholder="Project name"
                    submitLabel="Rename"
                    initialValue={renaming.name}
                    onSubmit={handleRenameProject}
                    onCancel={() => setRenaming(null)}
                />
            )}
        </div>
    );
}

/**
 * Renders the body of the page for the current load state.
 *
 * @param projects - The project list load state.
 * @param onOpen - Opens a project page.
 * @param onCardMenu - Opens a project card's context menu.
 * @param onNewProject - Opens the new-project dialog.
 * @param onRetry - Re-fetches the project list.
 * @returns The state-appropriate body element.
 */
function renderContent(
    projects: LoadState<readonly ProjectInfo[]>,
    onOpen: (project: ProjectInfo) => void,
    onCardMenu: (event: ReactMouseEvent, project: ProjectInfo) => void,
    onNewProject: () => void,
    onRetry: () => void,
) {
    switch (projects.status) {
        case "loading":
            return <p className="project-browser-status">Loading projects…</p>;

        case "error":
            return (
                <div className="project-browser-status">
                    <p className="project-browser-error">{projects.message}</p>
                    <button type="button" className="dialog-button" onClick={onRetry}>
                        Retry
                    </button>
                </div>
            );

        case "ready":
            if (projects.data.length === 0) {
                return (
                    <div className="project-browser-status">
                        <p>No projects yet.</p>
                        <button
                            type="button"
                            className="dialog-button dialog-button-primary"
                            onClick={onNewProject}
                        >
                            Create your first project
                        </button>
                    </div>
                );
            }

            return (
                <div className="project-grid">
                    {projects.data.map((project) => (
                        <ProjectCard
                            key={project.path}
                            project={project}
                            onOpen={onOpen}
                            onContextMenu={onCardMenu}
                        />
                    ))}
                </div>
            );

        default:
            return assertNever(projects);
    }
}
