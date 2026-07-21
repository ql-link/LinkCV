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

function clonePaperForExport(paper: HTMLElement, smartOnePage: boolean) {
  const clone = paper.cloneNode(true) as HTMLElement;
  const content = clone.querySelector<HTMLElement>(".resume-content");

  clone.style.transform = "none";
  clone.style.boxShadow = "none";
  clone.style.width = `${A4_WIDTH_MM}mm`;
  clone.style.minHeight = `${A4_HEIGHT_MM}mm`;
  clone.style.height = smartOnePage ? "auto" : `${A4_HEIGHT_MM}mm`;
  clone.style.overflow = smartOnePage ? "visible" : "hidden";

  if (content) {
    content.style.minHeight = `${A4_HEIGHT_MM}mm`;
    content.style.height = smartOnePage ? "auto" : `${A4_HEIGHT_MM}mm`;
    content.style.overflow = smartOnePage ? "visible" : "hidden";
  }

  clone.querySelectorAll(".page-number").forEach((element) => element.remove());
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

export async function exportResumePdf(smartOnePage: boolean, title: string) {
  const papers = Array.from(
    document.querySelectorAll<HTMLElement>(".paper-zoom-frame .resume-paper"),
  );

  if (papers.length === 0) return;

  const exportRoot = createExportRoot();

  try {
    const clonedPapers = papers.map((paper, index) => {
      const clone = clonePaperForExport(paper, smartOnePage && index === 0);
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

    const addCanvasPage = (canvas: HTMLCanvasElement, pageIndex: number) => {
      const imageData = canvas.toDataURL("image/png");
      const pageHeightMm = smartOnePage
        ? Math.max(A4_HEIGHT_MM, (A4_WIDTH_MM * canvas.height) / canvas.width)
        : A4_HEIGHT_MM;

      if (pageIndex > 0) {
        pdf.addPage([A4_WIDTH_MM, pageHeightMm], "portrait");
      }

      pdf.addImage(imageData, "PNG", 0, 0, A4_WIDTH_MM, pageHeightMm);
    };

    addCanvasPage(firstCanvas, 0);
    addPdfLinks(pdf, collectPdfLinks(clonedPapers[0], firstHeightMm));

    if (!smartOnePage) {
      for (let index = 1; index < clonedPapers.length; index += 1) {
        const canvas = await renderPaperToCanvas(clonedPapers[index]);
        addCanvasPage(canvas, index);
        addPdfLinks(pdf, collectPdfLinks(clonedPapers[index], A4_HEIGHT_MM));
      }
    }

    pdf.save(`${sanitizeFilename(title)}.pdf`);
  } finally {
    exportRoot.remove();
  }
}
