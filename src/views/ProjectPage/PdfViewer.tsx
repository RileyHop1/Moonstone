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
import type * as PdfJsCore from "pdfjs-dist";
import type * as PdfJsViewer from "pdfjs-dist/web/pdf_viewer.mjs";
import type { EventBus, PDFViewer as PdfViewerInstance } from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

/** Props for {@link PdfViewer}. */
export interface PdfViewerProps {
    /** URL to load; a new value reloads the document in place. */
    readonly source: string;
}

/** The zoom a document opens at: the page fills the pane's width. */
const FIT_WIDTH = "page-width";

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
 * Renders a PDF, reloading it in place whenever `source` changes.
 *
 * @param props - The URL of the PDF.
 * @returns The viewer element.
 */
export function PdfViewer({ source }: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const viewerRef = useRef<Promise<{ viewer: PdfViewerInstance; eventBus: EventBus }> | null>(
        null,
    );
    const [error, setError] = useState<string | null>(null);

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
                <div ref={containerRef} className="pdf-viewer-scroll">
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
