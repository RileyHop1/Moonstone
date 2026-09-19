/**
 * Browser harness for the PDF viewer.
 *
 * Mounts the real `PdfViewer` — real pdf.js, real worker, real canvas —
 * on a fixture PDF served by the Vite dev server, with no Tauri backend.
 *
 * Query params:
 * - `src` — URL to load (defaults to the three-page fixture).
 *
 * `window.setPdfSource(url)` swaps the source in place, which is exactly
 * what a recompile does in the app.
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PdfViewer } from "../../views/ProjectPage/PdfViewer";
import "../../styles/styles.css";
import "../../views/ProjectPage/ProjectPage.css";

declare global {
    interface Window {
        /** Replaces the viewer's source, as a recompile does. */
        setPdfSource?: (source: string) => void;
    }
}

/** The fixture every spec starts from. */
const FIXTURE = "/src/test/browser/fixtures/sample.pdf";

/**
 * Hosts the viewer and exposes its source to the spec.
 *
 * @returns The viewer.
 */
function Harness() {
    const initial = new URLSearchParams(window.location.search).get("src") ?? FIXTURE;
    const [source, setSource] = useState(initial);

    useEffect(() => {
        window.setPdfSource = setSource;
    }, []);

    return <PdfViewer source={source} />;
}

const root = document.getElementById("harness-root");
if (root) {
    createRoot(root).render(
        <StrictMode>
            <Harness />
        </StrictMode>,
    );
}
