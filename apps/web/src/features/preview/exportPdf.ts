import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MIN_EXPORT_CANVAS_SCALE = 3;
const MAX_EXPORT_CANVAS_SCALE = 4;

type PdfLinkRegion = {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function sanitizeFilename(name: string) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return clean || "resume";
}

function isDomainLikeHref(href: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:[/:?#].*)?$/i.test(
    href,
  );
}

function normalizePdfLinkHref(href: string) {
  const trimmed = href.trim();
  if (!trimmed) return "";

  if (
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }

  return isDomainLikeHref(trimmed) ? `https://${trimmed}` : trimmed;
}

function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));

  return Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

function createExportRoot() {
  const root = document.createElement("div");
  root.className = "pdf-export-root";
  root.style.position = "fixed";
  root.style.left = "-10000px";
  root.style.top = "0";
  root.style.width = `${A4_WIDTH_MM}mm`;
  root.style.background = "#ffffff";
  root.style.pointerEvents = "none";
  document.body.appendChild(root);
  return root;
}

function clonePaperForExport(paper: HTMLElement) {
  const clone = paper.cloneNode(true) as HTMLElement;
  const content = clone.querySelector<HTMLElement>(".resume-content");

  clone.style.transform = "none";
  clone.style.boxShadow = "none";
  clone.style.width = `${A4_WIDTH_MM}mm`;
  clone.style.minHeight = `${A4_HEIGHT_MM}mm`;
  clone.style.height = "auto";
  clone.style.overflow = "visible";

  if (content) {
    content.style.minHeight = `${A4_HEIGHT_MM}mm`;
    content.style.height = "auto";
    content.style.overflow = "visible";
  }

  clone.querySelectorAll(".page-number").forEach((element) => element.remove());
  clone.querySelectorAll(".media-context-toolbar, .media-resize-handle").forEach((element) => element.remove());
  clone.querySelectorAll(".is-selected").forEach((element) => element.classList.remove("is-selected"));
  clone.querySelectorAll(".resume-layout-row.is-active").forEach((element) => element.classList.remove("is-active"));
  return clone;
}

async function renderPaperToCanvas(paper: HTMLElement) {
  await waitForImages(paper);
  await document.fonts?.ready;

  return html2canvas(paper, {
    backgroundColor: "#ffffff",
    scale: Math.min(
      MAX_EXPORT_CANVAS_SCALE,
      Math.max(MIN_EXPORT_CANVAS_SCALE, window.devicePixelRatio || 1),
    ),
    useCORS: true,
    allowTaint: false,
    logging: false,
    windowWidth: paper.scrollWidth,
    windowHeight: paper.scrollHeight,
  });
}

function collectPdfLinks(paper: HTMLElement, pageHeightMm: number): PdfLinkRegion[] {
  const paperRect = paper.getBoundingClientRect();
  const scaleX = A4_WIDTH_MM / paperRect.width;
  const scaleY = pageHeightMm / paperRect.height;

  return Array.from(paper.querySelectorAll<HTMLAnchorElement>("a[href]")).flatMap((anchor) => {
    const href = normalizePdfLinkHref(anchor.getAttribute("href") ?? "");
    if (!href) return [];

    return Array.from(anchor.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        href,
        x: (rect.left - paperRect.left) * scaleX,
        y: (rect.top - paperRect.top) * scaleY,
        width: rect.width * scaleX,
        height: rect.height * scaleY,
      }));
  });
}

function addPdfLinks(pdf: jsPDF, links: PdfLinkRegion[]) {
  links.forEach((link) => {
    pdf.link(link.x, link.y, link.width, link.height, { url: link.href });
  });
}

function createPageSlice(source: HTMLCanvasElement, startY: number, pageHeight: number) {
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = pageHeight;
  const context = slice.getContext("2d");
  if (!context) return slice;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, slice.width, slice.height);
  const remainingHeight = Math.min(pageHeight, source.height - startY);
  context.drawImage(source, 0, startY, source.width, remainingHeight, 0, 0, source.width, remainingHeight);
  return slice;
}

function addLinksForStandardPage(pdf: jsPDF, links: PdfLinkRegion[], pageIndex: number) {
  const pageTop = pageIndex * A4_HEIGHT_MM;
  const pageBottom = pageTop + A4_HEIGHT_MM;
  addPdfLinks(pdf, links.flatMap((link) => {
    const linkBottom = link.y + link.height;
    if (linkBottom <= pageTop || link.y >= pageBottom) return [];
    const clippedTop = Math.max(link.y, pageTop);
    const clippedBottom = Math.min(linkBottom, pageBottom);
    return [{ ...link, y: clippedTop - pageTop, height: clippedBottom - clippedTop }];
  }));
}

export function getStandardPdfPageCount(canvasWidth: number, canvasHeight: number) {
  const pageHeightPx = Math.max(1, Math.round((canvasWidth * A4_HEIGHT_MM) / A4_WIDTH_MM));
  return Math.max(1, Math.ceil(canvasHeight / pageHeightPx));
}

export async function exportResumePdf(smartOnePage: boolean, title: string) {
  const papers = Array.from(
    document.querySelectorAll<HTMLElement>(".resume-workbench .resume-paper, .paper-zoom-frame .resume-paper"),
  );

  if (papers.length === 0) return;

  const exportRoot = createExportRoot();

  try {
    const clonedPapers = papers.map((paper) => {
      const clone = clonePaperForExport(paper);
      exportRoot.appendChild(clone);
      return clone;
    });

    const firstCanvas = await renderPaperToCanvas(clonedPapers[0]);
    const firstHeightMm = smartOnePage
      ? Math.max(A4_HEIGHT_MM, (A4_WIDTH_MM * firstCanvas.height) / firstCanvas.width)
      : A4_HEIGHT_MM;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [A4_WIDTH_MM, firstHeightMm],
      compress: true,
    });

    if (smartOnePage) {
      pdf.addImage(firstCanvas.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_MM, firstHeightMm);
      addPdfLinks(pdf, collectPdfLinks(clonedPapers[0], firstHeightMm));
    } else {
      let outputPageIndex = 0;
      for (let paperIndex = 0; paperIndex < clonedPapers.length; paperIndex += 1) {
        const canvas = paperIndex === 0 ? firstCanvas : await renderPaperToCanvas(clonedPapers[paperIndex]);
        const pageHeightPx = Math.max(1, Math.round((canvas.width * A4_HEIGHT_MM) / A4_WIDTH_MM));
        const fullHeightMm = (A4_WIDTH_MM * canvas.height) / canvas.width;
        const links = collectPdfLinks(clonedPapers[paperIndex], fullHeightMm);
        const pageCount = getStandardPdfPageCount(canvas.width, canvas.height);

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
          if (outputPageIndex > 0) pdf.addPage([A4_WIDTH_MM, A4_HEIGHT_MM], "portrait");
          const slice = createPageSlice(canvas, pageIndex * pageHeightPx, pageHeightPx);
          pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM);
          addLinksForStandardPage(pdf, links, pageIndex);
          outputPageIndex += 1;
        }
      }
    }

    pdf.save(`${sanitizeFilename(title)}.pdf`);
  } finally {
    exportRoot.remove();
  }
}
