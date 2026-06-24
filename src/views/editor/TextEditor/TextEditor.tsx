import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { latex } from "codemirror-lang-latex";
import { moonstone } from "./moonstoneTheme";
import "./TextEditor.css";

export function TextEditor() {
    const hostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!hostRef.current) return;

        const editor = new EditorView({
            doc: "",
            extensions: [
                basicSetup,
                latex({
                    autoCloseTags: true,
                    enableLinting: true,
                    enableTooltips: true,
                }),
                moonstone,
            ],
            parent: hostRef.current,
        });

        return () => editor.destroy();
    }, []);

    return <div ref={hostRef} className="view-container-text-editor" />;
}
