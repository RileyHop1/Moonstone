import { TextEditor } from "./views/editor/text-editor/text-editor";





const editor_subsection = document
    .querySelector('.editor-panel') as HTMLElement | null;

if (!editor_subsection) {
    throw new Error("Can't find the editor panel section");
}

const  editor_panel = new TextEditor(editor_subsection); 

