/**
 * A PDF pane's body: the document rendered by Mozilla's pdf.js.
 *
 * Every platform uses pdf.js rather than the webview's own viewer,
 * because Linux's WebKitGTK has none — an `<iframe>` there is blank.
 * Rendering into our own DOM has two further benefits: the pane's drop
 * handlers see drags over the pages (an iframe swallowed them), and a
 * recompile can swap the document while keeping the reader's place.
 */

import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type * as PdfJsCore from "pdfjs-dist";
import type * as PdfJsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import type {
    EventBus,
    PDFPageView,
    PDFViewer as PdfViewerInstance,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfLocation } from "../../shared/types";
import "pdfjs-dist/web/pdf_viewer.css";

/** Props for {@link PdfViewer}. */
export interface PdfViewerProps {
    /** URL to load; a new value reloads the document in place. */
    readonly source: string;
    /** A spot to scroll to and flash; each new object flashes again. */
    readonly target?: PdfLocation | null | undefined;
    /** Called with the spot the user double-clicked. */
    readonly onSyncClick?: ((location: PdfLocation) => void) | undefined;
}

/** The zoom a document opens at: the page fills the pane's width. */
const FIT_WIDTH = "page-width";

/** Context kept above a jumped-to line, in PDF points (one inch). */
const CONTEXT_ABOVE_PT = 72;

/** Height of the band flashed across a jumped-to line, in PDF points. */
const MARKER_HEIGHT_PT = 14;

/** The two pdf.js modules, loaded together and only once. */
type PdfJs = readonly [typeof PdfJsCore, typeof PdfJsViewer];

let pdfJsPromise: Promise<PdfJs> | null = null;

/**
 * Loads pdf.js on first use, so its ~1 MB never touches startup.
 *
 * The viewer module reads the core library from `globalThis.pdfjsLib`
 * while it is being evaluated, so the core must be loaded and published
 * first — the order here is load-bearing.
 *
 * @returns The core library and the viewer component module.
 */
function loadPdfJs(): Promise<PdfJs> {
    pdfJsPromise ??= (async () => {
        const core = await import("pdfjs-dist");
        core.GlobalWorkerOptions.workerSrc = workerUrl;
        (globalThis as { pdfjsLib?: unknown }).pdfjsLib = core;

        return [core, await import("pdfjs-dist/web/pdf_viewer.mjs")] as const;
    })();

    return pdfJsPromise;
}

/**
 * Creates the pdf.js viewer inside a container.
 *
 * Annotations are disabled because a link in the PDF would otherwise
 * navigate the whole app window away from Moonstone.
 *
 * @param container - The absolutely positioned scroll container.
 * @returns The viewer and the event bus it reports on.
 */
async function createViewer(
    container: HTMLDivElement,
): Promise<{ viewer: PdfViewerInstance; eventBus: EventBus }> {
    const [core, viewerModule] = await loadPdfJs();
    const eventBus = new viewerModule.EventBus();
    const viewer = new viewerModule.PDFViewer({
        container,
        eventBus,
        annotationMode: core.AnnotationMode.DISABLE,
    });

    return { viewer, eventBus };
}

/**
 * The rendered view of one page.
 *
 * @param viewer - The viewer.
 * @param page - The 1-based page number.
 * @returns The page's view, or null when there is no such page.
 */
async function pageViewAt(
    viewer: PdfViewerInstance,
    page: number,
): Promise<PDFPageView | null> {
    const [, viewerModule] = await loadPdfJs();
    // pdf.js types this as `any`; the class check is what narrows it.
    const view: unknown = viewer.getPageView(page - 1);

    return view instanceof viewerModule.PDFPageView ? view : null;
}

/**
 * Scrolls a spot into view and flashes a band across its line.
 *
 * @param viewer - The viewer.
 * @param location - The spot, in PDF points from the page's top-left.
 */
async function revealLocation(
    viewer: PdfViewerInstance,
    { page, y }: PdfLocation,
): Promise<void> {
    const view = await pageViewAt(viewer, page);
    if (!view) return;

    // The destination is in PDF space, whose y axis runs up the page.
    const pageTop = view.viewport.viewBox[3] ?? 0;
    viewer.scrollPageIntoView({
        pageNumber: page,
        destArray: [null, { name: "XYZ" }, null, pageTop - y + CONTEXT_ABOVE_PT, null],
    });

    const { scale } = view.viewport;
    const marker = document.createElement("div");
    marker.className = "pdf-sync-marker";
    marker.style.top = `${(y - MARKER_HEIGHT_PT) * scale}px`;
    marker.style.height = `${MARKER_HEIGHT_PT * 1.4 * scale}px`;
    marker.addEventListener("animationend", () => marker.remove(), { once: true });
    view.div.append(marker);
}

/**
 * Renders a PDF, reloading it in place whenever `source` changes.
 *
 * @param props - The URL of the PDF, and the SyncTeX hooks.
 * @returns The viewer element.
 */
export function PdfViewer({ source, target, onSyncClick }: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewerRef = useRef<Promise<{ viewer: PdfViewerInstance; eventBus: EventBus }> | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

    // A target that arrived before its pages did; the next load shows it.
    const pendingTargetRef = useRef<PdfLocation | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const viewerReady = (viewerRef.current ??= createViewer(container));
        const abort = new AbortController();

        void (async () => {
            const [core] = await loadPdfJs();
            const { viewer, eventBus } = await viewerReady;
            const task = core.getDocument({ url: source });
            abort.signal.addEventListener("abort", () => void task.destroy());

            const pdf = await task.promise;
            if (abort.signal.aborted) return;

            // A reload keeps the reader's zoom and place: the whole point
            // of previewing is to look at the part just edited.
            const scale = viewer.currentScaleValue || FIT_WIDTH;
            const scrollTop = container.scrollTop;
            eventBus.on(
                "pagesinit",
                () => {
                    viewer.currentScaleValue = scale;
                    container.scrollTop = scrollTop;

                    const pending = pendingTargetRef.current;
                    pendingTargetRef.current = null;
                    if (pending) void revealLocation(viewer, pending);
                },
                { once: true, signal: abort.signal },
            );

            const previous = viewer.pdfDocument;
            viewer.setDocument(pdf);
            void previous?.loadingTask.destroy();
            setError(null);
        })().catch((cause: unknown) => {
            if (abort.signal.aborted) return;

            console.error("Could not open PDF", { source, cause });
            setError(cause instanceof Error ? cause.message : String(cause));
        });

        return () => abort.abort();
    }, [source]);

    // Declared after the load effect, which is what creates the viewer.
    useEffect(() => {
        if (!target) return;

        pendingTargetRef.current = target;
        void viewerRef.current?.then(({ viewer }) => {
            if (viewer.pagesCount === 0 || pendingTargetRef.current !== target) return;

            pendingTargetRef.current = null;
            void revealLocation(viewer, target);
        });
    }, [target]);

    /**
     * Reports a double-clicked spot in PDF points, for SyncTeX.
     *
     * @param event - The double click.
     */
    const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
        if (!onSyncClick || !(event.target instanceof Element)) return;

        const pageElement = event.target.closest<HTMLElement>(".page");
        const page = Number(pageElement?.dataset.pageNumber);
        if (!pageElement || !Number.isInteger(page)) return;

        const bounds = pageElement.getBoundingClientRect();
        const offsetX = event.clientX - bounds.left - pageElement.clientLeft;
        const offsetY = event.clientY - bounds.top - pageElement.clientTop;

        void viewerRef.current?.then(async ({ viewer }) => {
            const view = await pageViewAt(viewer, page);
            if (!view) return;

            const { scale } = view.viewport;
            onSyncClick({ page, x: offsetX / scale, y: offsetY / scale });
        });
    };

    // Fit-width is a ratio of the pane, so it is re-applied whenever a
    // split or the file browser changes the pane's width.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Only width matters to fit-width; re-fitting on a height change
        // would re-render every page for nothing.
        let fittedWidth = container.clientWidth;
        const observer = new ResizeObserver(() => {
            if (container.clientWidth === fittedWidth) return;
            fittedWidth = container.clientWidth;

            void viewerRef.current?.then(({ viewer }) => {
                if (viewer.currentScaleValue === FIT_WIDTH)
                    viewer.currentScaleValue = FIT_WIDTH;
            });
        });
        observer.observe(container);

        return () => {
            observer.disconnect();
            void viewerRef.current?.then(({ viewer }) =>
                viewer.pdfDocument?.loadingTask.destroy(),
            );
        };
    }, []);

    /**
     * Runs a zoom action once the viewer exists.
     *
     * @param zoom - What to do to the viewer.
     */
    const applyZoom = (zoom: (viewer: PdfViewerInstance) => void): void => {
        void viewerRef.current?.then(({ viewer }) => zoom(viewer));
    };

    return (
        <div className="pdf-viewer">
            <div className="pdf-viewer-toolbar" role="toolbar" aria-label="PDF zoom">
                <button
                    type="button"
                    title="Zoom out"
                    onClick={() => applyZoom((v) => v.decreaseScale())}
                >
                    −
                </button>
                <button
                    type="button"
                    title="Zoom in"
                    onClick={() => applyZoom((v) => v.increaseScale())}
                >
                    +
                </button>
                <button
                    type="button"
                    title="Fit to width"
                    onClick={() => applyZoom((v) => (v.currentScaleValue = FIT_WIDTH))}
                >
                    Fit width
                </button>
            </div>
            <div className="pdf-viewer-body">
                {/* pdf.js requires an absolutely positioned container with a
                    `.pdfViewer` child; the body gives it a box to fill. */}
                <div
                    ref={containerRef}
                    className="pdf-viewer-scroll"
                    onDoubleClick={handleDoubleClick}
                >
                    <div className="pdfViewer" />
                </div>
                {error !== null && (
                    <div className="pdf-viewer-error" role="alert">
                        Could not open this PDF: {error}
                    </div>
                )}
            </div>
        </div>
    );
}
