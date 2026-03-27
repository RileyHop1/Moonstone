import { View } from '../../view';
import { EditorView, basicSetup } from 'codemirror';
import { latex } from 'codemirror-lang-latex';
import './text-editor.css';
export class TextEditor extends View {

    //This should be a EditorView before it is ever actually used.
    #editor: EditorView | null = null;


    protected setup(): void {
        this.#editor = new EditorView({
            doc: '',
            extensions: [basicSetup, latex({
                            autoCloseTags: true,
                            enableLinting: true,
                            enableTooltips: true
                        })],
            parent: this.container
        });
        
        this.container.classList.add('view-container-text-editor');

    }

    protected cleanup(): void {
        this.#editor?.destroy();
    }

 }