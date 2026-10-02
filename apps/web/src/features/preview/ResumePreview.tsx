import { t, useLocale } from "@/i18n";
import "./print/resume-print.css";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { CanonicalResumeDocument, CanonicalResumePresentation, LayoutPlan } from "../../api/client";
import { resumeDocumentTitle } from "../../api/resumeContract";
import { renderResumePrintDocument } from "./print/resumePrintDocument";
import { syncResumeSheetColumns } from "./print/resumeSheetDecoration";

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
  useLocale();
  const documentHtml = useMemo(
    () => renderResumePrintDocument({ title: resumeDocumentTitle(data) || "LinkResume Resume", data, style, layout_plan: layoutPlan }),
    [data, layoutPlan, style],
  );
  const previewRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const paper = previewRef.current?.querySelector<HTMLElement>(".resume-paper");
    if (!paper) return;
    let active = true;
    const update = () => { if (active) syncResumeSheetColumns({ paper }); };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(paper);
    document.fonts?.ready.then(update);
    return () => { active = false; observer?.disconnect(); };
  });

  return (
    <div
      ref={previewRef}
      className={`resume-readonly-preview resume-readonly-preview-${mode}`}
      aria-label={t("简历只读预览")}
      dangerouslySetInnerHTML={{ __html: documentHtml }}
    />
  );
}
