/**
 * One project tile in the project browser grid.
 */

import type { MouseEvent as ReactMouseEvent } from "react";
import type { ProjectInfo } from "../../shared/types";

/** Props for {@link ProjectCard}. */
export interface ProjectCardProps {
    /** The project this card represents. */
    readonly project: ProjectInfo;
    /** Called when the user double-clicks the card. */
    readonly onOpen: (project: ProjectInfo) => void;
    /** Called when the user right-clicks the card. */
    readonly onContextMenu: (event: ReactMouseEvent, project: ProjectInfo) => void;
}

/**
 * Formats an RFC3339 timestamp for the card tooltip.
 *
 * @param rfc3339 - The timestamp to format.
 * @returns A locale-formatted date string, or the raw value if unparseable.
 */
function formatLastModified(rfc3339: string): string {
    const parsed = new Date(rfc3339);

    if (Number.isNaN(parsed.getTime())) return rfc3339;

    return parsed.toLocaleString();
}

/**
 * Renders a document-style icon above the project name; double-click
 * opens the project, right-click opens its context menu.
 *
 * @param props - The project and interaction callbacks.
 * @returns The card element.
 */
export function ProjectCard({ project, onOpen, onContextMenu }: ProjectCardProps) {
    return (
        <button
            type="button"
            className="project-card"
            title={`Last modified: ${formatLastModified(project.lastModified)}`}
            onDoubleClick={() => onOpen(project)}
            onContextMenu={(event) => onContextMenu(event, project)}
        >
            {/* Page icon: a rectangle with a folded top-right corner. */}
            <svg
                className="project-card-icon"
                viewBox="0 0 48 60"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
            >
                <path d="M6 2 H32 L42 12 V58 H6 Z" strokeLinejoin="round" />
                <path d="M32 2 V12 H42" strokeLinejoin="round" />
                <path d="M13 24 H35 M13 32 H35 M13 40 H28" strokeLinecap="round" />
            </svg>
            <span className="project-card-name">{project.name}</span>
        </button>
    );
}
