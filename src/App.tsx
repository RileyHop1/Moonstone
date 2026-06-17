import { TextEditor } from "./views/editor/TextEditor";
import GlobalHotBar from "./components/GlobalHotBar";

export function App() {
    return (
        <div className="app">
            <header className="titlebar">
                <span className="titlebar-title">Moonstone</span>
            </header>

            <GlobalHotBar />

            <div className="workspace">
                <aside className="sidebar">
                    <div className="sidebar-header">
                        <span>Files</span>
                    </div>
                    <div className="file-tree">
                        {/* This is where the file tree will end up */}
                    </div>
                </aside>

                <section className="editor-panel">
                    <TextEditor />
                </section>
            </div>
        </div>
    );
}
