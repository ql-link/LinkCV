import "./print/resume-print.css";
import { useMemo } from "react";
import type { ResumeDocument, ResumePresentation } from "../../api/client";
import { renderResumePrintDocument } from "./print/resumePrintDocument";

export function ResumePreview({
  data,
  style,
  mode = "card",
}: {
  data: ResumeDocument;
  style: ResumePresentation;
  mode?: "card" | "full";
}) {
  const documentHtml = useMemo(
    () => renderResumePrintDocument({ title: data.basics.name || "LinkCV Resume", data, style }),
    [data, style],
  );

  return (
    <div
      className={`resume-readonly-preview resume-readonly-preview-${mode}`}
      aria-label="简历只读预览"
      dangerouslySetInnerHTML={{ __html: documentHtml }}
    />
  );
}
