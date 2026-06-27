import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { EditorCommand, EditorToolbar } from "./EditorToolbar";
import { EditorInsertRange, insertEditorText, runEditorCommand } from "./editorCommands";

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("INVALID_FILE_RESULT"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("FILE_READ_FAILED")));
    reader.readAsDataURL(file);
  });
}

export function EditorPanel() {
  const markdownValue = useResumeStore((state) => state.markdown);
  const setMarkdown = useResumeStore((state) => state.setMarkdown);
  const editorRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImageInsertRangeRef = useRef<EditorInsertRange | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const handleCommand = (command: EditorCommand) => {
    if (!editorRef.current) return;
    if (command === "image") {
      const selection = editorRef.current.state.selection.main;
      pendingImageInsertRangeRef.current = { from: selection.from, to: selection.to };
      fileInputRef.current?.click();
      return;
    }
    runEditorCommand(editorRef.current, command);
  };

  const handleImageFile = async (file: File) => {
    const view = editorRef.current;
    if (!view) return;

    setIsUploadingImage(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const { asset } = await api.uploadAsset({ fileName: file.name, dataUrl });
      const alt = file.name.replace(/"/g, "&quot;");
      const insertRange = pendingImageInsertRangeRef.current ?? undefined;
      insertEditorText(
        view,
        `<img src="${asset.url}" alt="${alt}" width="20" height="20">`,
        insertRange,
      );
    } catch (error) {
      window.alert(`图片上传失败：${(error as Error).message}`);
    } finally {
      pendingImageInsertRangeRef.current = null;
      setIsUploadingImage(false);
    }
  };

  return (
    <div className="editor-panel">
      <EditorToolbar
        onCommand={handleCommand}
        disabledCommands={isUploadingImage ? ["image"] : []}
      />
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
            ".cm-selectionBackground, .cm-content ::selection": {
              backgroundColor: "rgba(74, 85, 104, 0.26) !important",
            },
            "&.cm-focused .cm-selectionBackground": {
              backgroundColor: "rgba(74, 85, 104, 0.38) !important",
              boxShadow: "inset 0 0 0 1px rgba(20, 20, 19, 0.28)",
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
