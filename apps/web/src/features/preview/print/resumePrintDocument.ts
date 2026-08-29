import type {
  LayoutPlan,
  CanonicalResumeDocument,
  CanonicalResumePresentation,
} from "../../../api/resumeContract";
import {
  resumePresentationAccentColor,
  resumePresentationPageMargins,
  resumePresentationTemplateDefinition,
  styleToEditorSettings,
} from "../../../api/resumeContract";
import { composeEditorDocumentForLayoutPlan } from "../../workbench/templateLayout";
import { resumeDocumentToEditorDocument } from "../../workbench/resumeEditorPersistence";
import { renderResumeEditorDocument } from "./resumeEditorRenderer";

export const RESUME_RENDER_PROTOCOL_VERSION = 1 as const;

export type ResumeRenderRequestV1 = {
  protocol_version?: typeof RESUME_RENDER_PROTOCOL_VERSION;
  title: string;
  data: CanonicalResumeDocument;
  style: CanonicalResumePresentation;
  layout_plan?: LayoutPlan | null;
  assets?: Record<string, string>;
};

export type ResumePrintDocumentOptions = {
  includeStyles?: boolean;
  className?: string;
  ariaLabel?: string;
};

const UNAVAILABLE_PRINT_CONTENT = '<p class="resume-render-unavailable" role="status">预览不可用</p>';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function safeCssValue(value: string, fallback: string) {
  // Font family is persisted user input, so it needs to be treated as untrusted
  // when the document is rendered outside React.
  if (!value || /[{};<>]/u.test(value)) return fallback;
  return value;
}

function replaceEmbeddedAssets(html: string, assets: Record<string, string>) {
  if (!Object.keys(assets).length) return html;
  return html.replace(/\bsrc=("|')([^"']+)\1/gi, (match, quote: string, source: string) => {
    const localAssetPath = source.startsWith("/__local_asset__?path=")
      ? decodeURIComponent(source.slice("/__local_asset__?path=".length))
      : source;
    const asset = assets[source] ?? assets[localAssetPath];
    if (!asset || !/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(asset)) return match;
    return `src=${quote}${asset}${quote}`;
  });
}

function printCssVariables(style: CanonicalResumePresentation) {
  const settings = styleToEditorSettings(style);
  const margins = resumePresentationPageMargins(style);
  return [
    `--resume-font-family:${safeCssValue(settings.fontFamily, "sans-serif")}`,
    `--resume-font-size:${settings.fontSize}pt`,
    `--resume-line-height:${settings.lineHeight}`,
    `--resume-page-margin-x:${margins.left}mm`,
    `--resume-page-margin-y:${margins.top}mm`,
    `--resume-page-margin-top:${margins.top}mm`,
    `--resume-page-margin-right:${margins.right}mm`,
    `--resume-page-margin-bottom:${margins.bottom}mm`,
    `--resume-page-margin-left:${margins.left}mm`,
    `--preview-font-family:${safeCssValue(settings.fontFamily, "sans-serif")}`,
    `--preview-font-size:${settings.fontSize}pt`,
    `--preview-line-height:${settings.lineHeight}`,
    `--preview-margin-x:${margins.left}mm`,
    `--preview-margin-y:${margins.top}mm`,
    `--preview-accent:${resumePresentationAccentColor(style)}`,
  ].join(";");
}

/**
 * Converts a persisted snapshot into the read-only DOM consumed by preview,
 * the server-side Chromium CLI and the future desktop renderer.
 */
export function renderResumePrintDocument(
  request: ResumeRenderRequestV1,
  options: ResumePrintDocumentOptions = {},
) {
  const settings = styleToEditorSettings(request.style);
  const editorDocument = resumeDocumentToEditorDocument(request.data);
  const definition = resumePresentationTemplateDefinition(request.style);
  let rendered = UNAVAILABLE_PRINT_CONTENT;
  let renderState = "unavailable";
  if (editorDocument && request.layout_plan && definition) {
    try {
      const projected = composeEditorDocumentForLayoutPlan(
        editorDocument,
        request.data,
        request.layout_plan,
        definition,
      );
      rendered = renderResumeEditorDocument(projected);
      renderState = "pending";
    } catch {
      // A missing, stale, or malformed plan must fail closed. Rendering the
      // canonical tree directly would silently discard the server's layout
      // decision and produce a different template.
    }
  }
  const content = replaceEmbeddedAssets(rendered, request.assets ?? {});
  const paperClasses = [
    "resume-paper",
    "resume-preview-paper",
    "resume-print-paper",
    `theme-${settings.theme}`,
    settings.smartOnePage ? "smart-one-page" : "",
  ].filter(Boolean).join(" ");
  const contentClasses = "resume-content resume-print-content";
  const extraClass = options.className ? ` ${escapeHtml(options.className)}` : "";
  const ariaLabel = options.ariaLabel ? ` aria-label="${escapeHtml(options.ariaLabel)}"` : "";
  const style = printCssVariables(request.style);
  const title = escapeHtml(request.title.trim() || "LinkCV Resume");
  const css = options.includeStyles ? "<style data-resume-print-styles>/* injected by the renderer */</style>" : "";

  return `<article class="${paperClasses}${extraClass}" data-resume-print-document data-render-state="${renderState}" data-render-protocol="${RESUME_RENDER_PROTOCOL_VERSION}" data-resume-title="${title}"${ariaLabel} style="${escapeHtml(style)}">${css}<div class="${contentClasses}">${content}</div></article>`;
}

export function createResumeRenderRequest(
  title: string,
  data: CanonicalResumeDocument,
  style: CanonicalResumePresentation,
  assets?: Record<string, string>,
  layoutPlan?: LayoutPlan | null,
): ResumeRenderRequestV1 {
  return {
    protocol_version: RESUME_RENDER_PROTOCOL_VERSION,
    title,
    data,
    style,
    ...(layoutPlan ? { layout_plan: layoutPlan } : {}),
    ...(assets ? { assets } : {}),
  };
}
