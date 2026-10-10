import { t, useLocale } from "@/i18n";
import "./print/resume-print.css";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { CanonicalResumeDocument, CanonicalResumePresentation, LayoutPlan } from "../../api/client";
import { resumeDocumentTitle } from "../../api/resumeContract";
import { renderResumePrintDocument } from "./print/resumePrintDocument";
import { syncResumeSheetColumns } from "./print/resumeSheetDecoration";
import { paginateShareDocument } from "../share/sharePagination";

export function ResumePreview({
  data,
  style,
  layoutPlan,
  mode = "card",
  firstPageOnly = false,
}: {
  data: CanonicalResumeDocument;
  style: CanonicalResumePresentation;
  layoutPlan?: LayoutPlan | null;
  mode?: "card" | "full";
  firstPageOnly?: boolean;
}) {
  useLocale();
  const documentHtml = useMemo(
    () => renderResumePrintDocument({
      title: resumeDocumentTitle(data) || "DrawOffer Resume",
      data,
      style: firstPageOnly ? { ...style, portable: { ...style.portable, smart_one_page: false } } : style,
      layout_plan: layoutPlan,
    }),
    [data, firstPageOnly, layoutPlan, style],
  );
  const previewRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const paper = previewRef.current?.querySelector<HTMLElement>(".resume-paper");
    if (!paper) return;
    let active = true;
    const update = () => {
      if (!active) return;
      // Card scaling must not change the A4 coordinates used for pagination.
      const scale = paper.style.scale;
      try {
        if (firstPageOnly) {
          paper.style.scale = "1";
          paginateShareDocument(paper);
        }
        syncResumeSheetColumns({ paper });
      } finally {
        paper.style.scale = scale;
      }
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(paper);
    document.fonts?.ready.then(update);
    const images = Array.from(paper.querySelectorAll("img"));
    images.forEach((item) => {
      item.addEventListener("load", update);
      item.addEventListener("error", update);
    });
    return () => {
      active = false;
      observer?.disconnect();
      images.forEach((item) => {
        item.removeEventListener("load", update);
        item.removeEventListener("error", update);
      });
    };
  }, [documentHtml, firstPageOnly, mode]);

  return (
    <div
      ref={previewRef}
      className={`resume-readonly-preview resume-readonly-preview-${mode}${firstPageOnly ? " resume-readonly-preview-first-page" : ""}`}
      aria-label={t("简历只读预览")}
      dangerouslySetInnerHTML={{ __html: documentHtml }}
    />
  );
}
