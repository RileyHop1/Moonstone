import { invoke } from "@tauri-apps/api/core";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";


const initialDoc = 
  `
  \\documentclass{article}
  \\begin{document}

  Hello, Moonstone!

  \\end{document}
  `;


const editorPanel = document.querySelector(".editor-panel") as HTMLElement;


const state = EditorState.create({
  doc: initialDoc,
  extensions: [
    basicSetup,
    oneDark,
    EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "14px"
      },
      ".cm-scroller": {
        overflow: "auto",
      },
    })
  ],
});


const editor = new EditorView({
  state,
  parent: editorPanel,
  });

