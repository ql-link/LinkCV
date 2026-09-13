import { resumePresentationPageMargins, type ResumePresentationRead } from "../../api/resumeContract";
import type { ResumeSettings } from "../../store/resumeStore";

export function liveResumePageMargins(
  settings: Pick<ResumeSettings, "pageMargin" | "verticalPageMargin">,
  style?: ResumePresentationRead,
) {
  const persistedMargins = style ? resumePresentationPageMargins(style) : null;
  const horizontalMarginChanged = persistedMargins?.left !== settings.pageMargin;
  const verticalMarginChanged = persistedMargins?.top !== settings.verticalPageMargin;

  return {
    top: settings.verticalPageMargin,
    right: horizontalMarginChanged ? settings.pageMargin : persistedMargins?.right ?? settings.pageMargin,
    bottom: verticalMarginChanged ? settings.verticalPageMargin : persistedMargins?.bottom ?? settings.verticalPageMargin,
    left: settings.pageMargin,
  };
}
