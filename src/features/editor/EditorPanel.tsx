import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useRef } from "react";
import { useResumeStore } from "../../store/resumeStore";
import { EditorCommand, EditorToolbar } from "./EditorToolbar";
import { insertEditorText, runEditorCommand } from "./editorCommands";

export function EditorPanel() {
  const markdownValue = useResumeStore((state) => state.markdown);
  const setMarkdown = useResumeStore((state) => state.setMarkdown);
  const editorRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCommand = (command: EditorCommand) => {
    if (!editorRef.current) return;
    if (command === "image") {
      fileInputRef.current?.click();
      return;
    }
    runEditorCommand(editorRef.current, command);
  };

  const handleImageFile = (file: File) => {
    const view = editorRef.current;
    if (!view) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const alt = file.name.replace(/"/g, "&quot;");
      insertEditorText(view, `<img src="${result}" alt="${alt}" width="20" height="20">`);
    });
    reader.readAsDataURL(file);
  };

  return (
    <div className="editor-panel">
      <EditorToolbar onCommand={handleCommand} />
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleImageFile(file);
          event.target.value = "";
        }}
      />
      <CodeMirror
        className="editor-codemirror"
        value={markdownValue}
        height="100%"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          autocompletion: true,
          bracketMatching: true,
        }}
        extensions={[
          markdown(),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": {
              fontSize: "13px",
              height: "100%",
            },
            ".cm-scroller": {
              fontFamily:
                '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
              lineHeight: "1.62",
            },
          }),
        ]}
        onCreateEditor={(view) => {
          editorRef.current = view;
        }}
        onChange={setMarkdown}
      />
    </div>
  );
}
