import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import type { ResumeDocumentV1, ResumeStyleV1 } from "../../api/client";
import { resumeDocumentToMarkdown, styleToEditorSettings } from "../../api/resumeContract";
import { renderResumeMarkdown } from "../../parser/resumeMarkdown";
import { resumeEditorExtensions } from "../workbench/editorExtensions";

export function ResumePreview({
  data,
  style,
  mode = "card",
}: {
  data: ResumeDocumentV1;
  style: ResumeStyleV1;
  mode?: "card" | "full";
}) {
  const content = useMemo(
    () => renderResumeMarkdown(resumeDocumentToMarkdown(data)),
    [data],
  );
  const settings = useMemo(() => styleToEditorSettings(style), [style]);
  const editor = useEditor({
    extensions: resumeEditorExtensions,
    content,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "resume-content" },
    },
  });

  useEffect(() => {
    if (editor) editor.commands.setContent(content);
  }, [content, editor]);

  return (
    <div
      className={`resume-readonly-preview resume-readonly-preview-${mode}`}
      style={{
        "--preview-font-family": settings.fontFamily,
        "--preview-font-size": `${settings.fontSize}px`,
        "--preview-line-height": String(settings.lineHeight),
        "--preview-accent": style.accent_color,
        "--preview-margin-x": `${style.page.margin_left_mm}mm`,
        "--preview-margin-y": `${style.page.margin_top_mm}mm`,
      } as React.CSSProperties}
      aria-label="简历只读预览"
    >
      <article className={`resume-preview-paper theme-${settings.theme}`}>
        <EditorContent editor={editor} />
      </article>
    </div>
  );
}
