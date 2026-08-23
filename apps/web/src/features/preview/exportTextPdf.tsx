import type { JSONContent } from "@tiptap/core";
import {
  Document,
  Font,
  Image,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";
import notoSansHansRegularUrl from "../../../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Regular.otf?url";
import notoSansHansMediumUrl from "../../../node_modules/@embedpdf/fonts-sc/fonts/NotoSansHans-Medium.otf?url";
import sourceHanSerifRegularUrl from "../../../node_modules/@fontpkg/source-han-serif-sc/SourceHanSerifSC-Regular.otf?url";
import sourceHanSerifSemiBoldUrl from "../../../node_modules/@fontpkg/source-han-serif-sc/SourceHanSerifSC-SemiBold.otf?url";
import lxgwWenKaiRegularUrl from "../../../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Regular.ttf?url";
import lxgwWenKaiMediumUrl from "../../../node_modules/@fontpkg/lxgw-wen-kai/LXGWWenKai-Medium.ttf?url";
import type { ReactNode } from "react";
import type { ResumeSettings } from "../../store/resumeStore";
import { inlineFontSizeFromNode } from "../../lib/resumeInlineStyle";
import { isInlineIconName, resumeInlineIconGlyphs } from "../../lib/resumeInlineIcon";

const PDF_FONT_FAMILY = "LinkCV Noto Sans Hans";
export const PDF_SERIF_FONT_FAMILY = "LinkCV Source Han Serif SC";
export const PDF_WENKAI_FONT_FAMILY = "LinkCV LXGW WenKai";
export const PDF_A4_WIDTH = 595.28;
export const PDF_A4_HEIGHT = 841.89;
const SMART_PDF_HEIGHT_EPSILON = 4;

Font.register({
  family: PDF_FONT_FAMILY,
  fonts: [
    { src: notoSansHansRegularUrl, fontWeight: 400 },
    { src: notoSansHansRegularUrl, fontWeight: 400, fontStyle: "italic" },
    { src: notoSansHansMediumUrl, fontWeight: 600 },
    { src: notoSansHansMediumUrl, fontWeight: 600, fontStyle: "italic" },
  ],
});

Font.register({
  family: PDF_SERIF_FONT_FAMILY,
  fonts: [
    { src: sourceHanSerifRegularUrl, fontWeight: 400 },
    { src: sourceHanSerifRegularUrl, fontWeight: 400, fontStyle: "italic" },
    { src: sourceHanSerifSemiBoldUrl, fontWeight: 600 },
    { src: sourceHanSerifSemiBoldUrl, fontWeight: 600, fontStyle: "italic" },
  ],
});

Font.register({
  family: PDF_WENKAI_FONT_FAMILY,
  fonts: [
    { src: lxgwWenKaiRegularUrl, fontWeight: 400 },
    { src: lxgwWenKaiRegularUrl, fontWeight: 400, fontStyle: "italic" },
    { src: lxgwWenKaiMediumUrl, fontWeight: 600 },
    { src: lxgwWenKaiMediumUrl, fontWeight: 600, fontStyle: "italic" },
  ],
});

export function resolvePdfFontFamily(fontFamily: string) {
  if (/LXGW WenKai|霞鹜文楷/i.test(fontFamily)) return PDF_WENKAI_FONT_FAMILY;
  if (/Source Han Serif|Songti|STSong|SimSun|宋体/i.test(fontFamily)) return PDF_SERIF_FONT_FAMILY;
  return PDF_FONT_FAMILY;
}

type PreparedPdfContent = JSONContent & { content?: PreparedPdfContent[] };
type PdfPageSize = "A4" | [number, number];
type PdfLayoutNode = {
  box?: { top?: number; height?: number };
  children?: PdfLayoutNode[];
};
type PdfRenderResult = {
  blob?: Blob;
  _INTERNAL__LAYOUT__DATA_?: PdfLayoutNode;
};

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "resume";
}

export function pdfTextAlignment(
  node: JSONContent,
  previousNode?: JSONContent,
): "left" | "center" | "right" {
  const explicitAlignment = node.attrs?.textAlign;
  if (explicitAlignment === "left" || explicitAlignment === "center" || explicitAlignment === "right") {
    return explicitAlignment;
  }

  if (node.type === "heading" && Number(node.attrs?.level) === 1) return "center";
  if (
    node.type === "paragraph"
    && previousNode?.type === "heading"
    && Number(previousNode.attrs?.level) === 1
  ) {
    return "center";
  }

  return "left";
}

function markStyle(node: JSONContent) {
  const marks = node.marks ?? [];
  const textStyle = marks.find((mark) => mark.type === "textStyle")?.attrs ?? {};
  const highlight = marks.find((mark) => mark.type === "highlight")?.attrs ?? {};
  return {
    fontWeight: marks.some((mark) => mark.type === "bold") ? 600 : 400,
    fontStyle: marks.some((mark) => mark.type === "italic") ? "italic" as const : "normal" as const,
    textDecoration: marks.some((mark) => mark.type === "underline") ? "underline" as const : undefined,
    color: typeof textStyle.color === "string" ? textStyle.color : marks.some((mark) => mark.type === "bold") ? "#4b5563" : undefined,
    backgroundColor: typeof highlight.color === "string" ? highlight.color : marks.some((mark) => mark.type === "highlight") ? "#fef08a" : undefined,
    fontSize: inlineFontSizeFromNode(node),
  };
}

function safeLinkHref(value: unknown) {
  if (typeof value !== "string") return "";
  return /^(?:https?:|mailto:|tel:)/i.test(value.trim()) ? value.trim() : "";
}

function inlineNodes(node: JSONContent, keyPrefix: string): ReactNode[] {
  return (node.content ?? []).flatMap((child, index) => {
    const key = `${keyPrefix}-${index}`;
    if (child.type === "text") {
      const content = <Text key={key} style={markStyle(child)}>{child.text ?? ""}</Text>;
      const href = safeLinkHref(child.marks?.find((mark) => mark.type === "link")?.attrs?.href);
      return href
        ? [<Link key={key} src={href} style={{ color: "#2563eb", textDecoration: "none" }}>{content}</Link>]
        : [content];
    }
    if (child.type === "hardBreak") return [<Text key={key}>{"\n"}</Text>];
    if (child.type === "inlineIcon") {
      const name = child.attrs?.name;
      return [<Text key={key}>{isInlineIconName(name) ? resumeInlineIconGlyphs[name] : "★"}</Text>];
    }
    if (child.type === "inlineImage") {
      const src = typeof child.attrs?.pdfSrc === "string" ? child.attrs.pdfSrc : "";
      if (!src) return [<Text key={key}>[{String(child.attrs?.alt ?? "行内图片")}无法嵌入]</Text>];
      const width = Math.min(180, Math.max(12, Number(child.attrs?.width) * 0.75 || 54));
      const aspectRatio = Math.min(20, Math.max(0.1, Number(child.attrs?.aspectRatio) || 3));
      const height = Math.min(180, Math.max(12, Number(child.attrs?.height) * 0.75 || width / aspectRatio));
      return [<Image key={key} src={src} style={{ width, height, marginRight: 4 }} />];
    }
    return inlineNodes(child, key);
  });
}

function listItemText(node: JSONContent, keyPrefix: string) {
  return (node.content ?? []).flatMap((child, index) => inlineNodes(child, `${keyPrefix}-${index}`));
}

function imageWidth(node: JSONContent) {
  if (node.type === "avatarImage") return Math.min(165, Math.max(42, Number(node.attrs?.size) * 0.75 || 72));
  if (node.attrs?.widthUnit === "px") return Math.min(500, Math.max(36, Number(node.attrs.width) * 0.75 || 225));
  return `${Math.min(100, Math.max(5, Number(node.attrs?.width) || 55))}%` as `${number}%`;
}

function blockNode(
  node: PreparedPdfContent,
  key: string,
  listDepth = 0,
  theme: ResumeSettings["theme"] = "classic",
  previousNode?: PreparedPdfContent,
): ReactNode {
  if (node.type === "heading") {
    const level = Number(node.attrs?.level);
    return (
      <Text
        key={key}
        minPresenceAhead={level === 2 ? 32 : 16}
        style={[
          level === 1 ? styles.heading1 : level === 2 ? styles.heading2 : styles.heading3,
          level === 2 && theme === "modern" ? styles.modernHeading2 : {},
          { textAlign: pdfTextAlignment(node, previousNode) },
        ]}
      >
        {inlineNodes(node, key)}
      </Text>
    );
  }
  if (node.type === "paragraph") {
    return <Text key={key} style={[styles.paragraph, { textAlign: pdfTextAlignment(node, previousNode) }]}>{inlineNodes(node, key)}</Text>;
  }
  if (node.type === "bulletList" || node.type === "orderedList") {
    const start = Number(node.attrs?.start) || 1;
    return (
      <View key={key} style={[styles.list, { marginLeft: listDepth * 10 }]}>
        {(node.content ?? []).map((item, index) => (
          <View key={`${key}-${index}`} style={styles.listItem} wrap>
            <Text style={styles.listMarker}>{node.type === "orderedList" ? `${start + index}.` : "•"}</Text>
            <Text style={styles.listText}>{listItemText(item, `${key}-${index}`)}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (node.type === "resumeRow") {
    const [left, right] = node.content ?? [];
    const leftWidth = Math.min(90, Math.max(10, Number(node.attrs?.leftWidth) || 50));
    return (
      <View key={key} style={styles.row} wrap={false}>
        <Text style={[styles.rowLeft, { width: `${leftWidth}%` }]}>{left ? inlineNodes(left, `${key}-left`) : null}</Text>
        <Text style={[styles.rowRight, { width: `${100 - leftWidth}%` }]}>{right ? inlineNodes(right, `${key}-right`) : null}</Text>
      </View>
    );
  }
  if (node.type === "blockquote") {
    return <View key={key} style={styles.blockquote}>{(node.content ?? []).map((child, index, siblings) => blockNode(child, `${key}-${index}`, listDepth, theme, siblings[index - 1]))}</View>;
  }
  if (node.type === "horizontalRule") return <View key={key} style={styles.rule} />;
  if (node.type === "codeBlock") return <Text key={key} style={styles.code}>{inlineNodes(node, key)}</Text>;
  if (node.type === "resumeImage" || node.type === "avatarImage") {
    const src = typeof node.attrs?.pdfSrc === "string" ? node.attrs.pdfSrc : "";
    const alt = String(node.attrs?.alt ?? (node.type === "avatarImage" ? "简历头像" : "简历图片"));
    if (!src) return <Text key={key} style={styles.imageFallback}>[{alt}无法嵌入]</Text>;
    const align = node.type === "avatarImage" ? "center" : String(node.attrs?.align ?? "center");
    return (
      <View key={key} style={[styles.imageContainer, align === "left" ? styles.imageLeft : align === "right" ? styles.imageRight : styles.imageCenter]} wrap={false}>
        <Image src={src} style={{ width: imageWidth(node), objectFit: "contain" }} />
      </View>
    );
  }
  return <View key={key}>{(node.content ?? []).map((child, index, siblings) => blockNode(child, `${key}-${index}`, listDepth + 1, theme, siblings[index - 1]))}</View>;
}

const styles = StyleSheet.create({
  page: { color: "#111827", fontFamily: PDF_FONT_FAMILY, fontSize: 10.5, lineHeight: 1.32 },
  heading1: { marginBottom: 7, fontSize: 20, fontWeight: 400, textAlign: "center" },
  heading2: { marginTop: 8, marginBottom: 4, borderBottomWidth: 0.75, borderBottomColor: "#1f2937", paddingBottom: 1, fontSize: 12.5, fontWeight: 400 },
  modernHeading2: { borderBottomColor: "#155fd7", color: "#1d4ed8" },
  heading3: { marginTop: 7, marginBottom: 3, fontSize: 11, fontWeight: 400 },
  paragraph: { marginTop: 2, marginBottom: 2 },
  list: { marginTop: 3, marginBottom: 4 },
  listItem: { flexDirection: "row", marginBottom: 1 },
  listMarker: { width: 15, flexShrink: 0 },
  listText: { flexGrow: 1, flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", marginTop: 3, marginBottom: 3 },
  rowLeft: { paddingRight: 8 },
  rowRight: { textAlign: "right", fontStyle: "italic" },
  blockquote: { marginVertical: 4, borderLeftWidth: 2.25, borderLeftColor: "#9ca3af", paddingLeft: 8, color: "#374151" },
  rule: { marginVertical: 5, borderBottomWidth: 0.75, borderBottomColor: "#9ca3af" },
  code: { marginVertical: 2, padding: 4, backgroundColor: "#f1f5f9", fontSize: 9 },
  imageContainer: { marginVertical: 7 },
  imageLeft: { alignItems: "flex-start" },
  imageCenter: { alignItems: "center" },
  imageRight: { alignItems: "flex-end" },
  imageFallback: { marginVertical: 4, color: "#66717f", fontSize: 9 },
});

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("PDF_IMAGE_READ_FAILED")), { once: true });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("PDF_IMAGE_READ_FAILED")), { once: true });
    reader.readAsDataURL(blob);
  });
}

async function prepareNode(node: JSONContent): Promise<PreparedPdfContent> {
  const prepared: PreparedPdfContent = { ...node, attrs: node.attrs ? { ...node.attrs } : undefined };
  if (node.type === "resumeImage" || node.type === "avatarImage" || node.type === "inlineImage") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    if (src && !/^data:image\/(?:png|jpe?g);/i.test(src)) {
      try {
        const imageUrl = new URL(src, window.location.href);
        const response = await fetch(imageUrl.href, { credentials: imageUrl.origin === window.location.origin ? "include" : "omit" });
        const type = response.headers.get("content-type") ?? "";
        if (!response.ok || !/^image\/(?:png|jpe?g)/i.test(type)) throw new Error("PDF_IMAGE_UNSUPPORTED");
        prepared.attrs = { ...prepared.attrs, pdfSrc: await blobToDataUrl(await response.blob()) };
      } catch {
        prepared.attrs = { ...prepared.attrs, pdfSrc: "" };
      }
    } else {
      prepared.attrs = { ...prepared.attrs, pdfSrc: src };
    }
  }
  if (node.content) prepared.content = await Promise.all(node.content.map(prepareNode));
  return prepared;
}

export function pdfPageStyle(settings: ResumeSettings) {
  const compactTheme = settings.theme === "compact";
  return {
    ...styles.page,
    paddingTop: `${settings.verticalPageMargin}mm`,
    paddingBottom: `${settings.verticalPageMargin}mm`,
    paddingLeft: `${settings.pageMargin}mm`,
    paddingRight: `${settings.pageMargin}mm`,
    fontFamily: resolvePdfFontFamily(settings.fontFamily),
    fontSize: compactTheme ? 9.5 : settings.fontSize,
    lineHeight: compactTheme ? 1.22 : settings.lineHeight,
  };
}

export function smartPdfMeasurementSize(pageCount: number): [number, number] {
  return [PDF_A4_WIDTH, PDF_A4_HEIGHT * Math.max(1, Math.ceil(pageCount))];
}

export function smartPdfPageSize(contentHeight: number): [number, number] {
  return [PDF_A4_WIDTH, Math.max(PDF_A4_HEIGHT, Math.ceil(contentHeight * 100) / 100)];
}

export function contentHeightFromLayout(layout: PdfLayoutNode | undefined, bottomPadding: number) {
  const pages = layout?.children ?? [];
  if (pages.length !== 1) throw new Error("SMART_PDF_LAYOUT_MEASUREMENT_FAILED");
  const contentBottom = (pages[0].children ?? []).reduce((maximum, child) => {
    const top = child.box?.top ?? 0;
    const height = child.box?.height ?? 0;
    return Math.max(maximum, top + height);
  }, 0);
  return Math.max(PDF_A4_HEIGHT, contentBottom + bottomPadding + SMART_PDF_HEIGHT_EPSILON);
}

export function countPdfPagesFromSource(source: string) {
  const pageNodes = source.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
  return Math.max(1, pageNodes);
}

async function countPdfPages(blob: Blob) {
  return countPdfPagesFromSource(await blob.text());
}

export function ResumePdfDocument({ content, settings, title = "LinkCV Resume", pageSize = "A4", onRender }: { content: PreparedPdfContent; settings: ResumeSettings; title?: string; pageSize?: PdfPageSize; onRender?: (result: PdfRenderResult) => void }) {
  return (
    <Document title={title.trim() || "LinkCV Resume"} author="LinkCV" creator="LinkCV" onRender={onRender as (result: { blob?: Blob }) => void}>
      <Page size={pageSize} style={pdfPageStyle(settings)} wrap>
        {(content.content ?? []).map((node, index, siblings) => blockNode(node, `block-${index}`, 0, settings.theme, siblings[index - 1]))}
      </Page>
    </Document>
  );
}

export async function createResumePdfBlob(content: JSONContent, settings: ResumeSettings, title = "LinkCV Resume") {
  const prepared = await prepareNode(content);
  const standardBlob = await pdf(<ResumePdfDocument content={prepared} settings={settings} title={title} />).toBlob();
  if (!settings.smartOnePage) return standardBlob;

  const pageCount = await countPdfPages(standardBlob);
  let measurementLayout: PdfLayoutNode | undefined;
  await pdf(
    <ResumePdfDocument
      content={prepared}
      settings={settings}
      title={title}
      pageSize={smartPdfMeasurementSize(pageCount)}
      onRender={(result) => { measurementLayout = result._INTERNAL__LAYOUT__DATA_; }}
    />,
  ).toBlob();
  const bottomPadding = settings.verticalPageMargin * 72 / 25.4;
  const contentHeight = contentHeightFromLayout(measurementLayout, bottomPadding);
  return pdf(
    <ResumePdfDocument
      content={prepared}
      settings={settings}
      title={title}
      pageSize={smartPdfPageSize(contentHeight)}
    />,
  ).toBlob();
}

export async function exportResumeTextPdf(content: JSONContent, settings: ResumeSettings, title: string) {
  const blob = await createResumePdfBlob(content, settings, title);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilename(title)}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
