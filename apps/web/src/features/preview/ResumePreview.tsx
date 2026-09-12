import "./print/resume-print.css";
import { useMemo } from "react";
import type { CanonicalResumeDocument, CanonicalResumePresentation, LayoutPlan } from "../../api/client";
import { resumeDocumentTitle } from "../../api/resumeContract";
import { renderResumePrintDocument } from "./print/resumePrintDocument";

export function ResumePreview({
  data,
  style,
  layoutPlan,
  mode = "card",
}: {
  data: CanonicalResumeDocument;
  style: CanonicalResumePresentation;
  layoutPlan?: LayoutPlan | null;
  mode?: "card" | "full";
}) {
  const documentHtml = useMemo(
    () => renderResumePrintDocument({ title: resumeDocumentTitle(data) || "LinkCV Resume", data, style, layout_plan: layoutPlan }),
    [data, layoutPlan, style],
  );

  return (
    <div
      className={`resume-readonly-preview resume-readonly-preview-${mode}`}
      aria-label="简历只读预览"
      dangerouslySetInnerHTML={{ __html: documentHtml }}
    />
  );
}
