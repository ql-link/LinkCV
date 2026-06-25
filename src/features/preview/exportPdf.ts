import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

function sanitizeFilename(name: string) {
  const clean = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return clean || "resume";
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
    scale: 2,
    useCORS: true,
    allowTaint: false,
    logging: false,
    windowWidth: paper.scrollWidth,
    windowHeight: paper.scrollHeight,
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

    if (!smartOnePage) {
      for (let index = 1; index < clonedPapers.length; index += 1) {
        const canvas = await renderPaperToCanvas(clonedPapers[index]);
        addCanvasPage(canvas, index);
      }
    }

    pdf.save(`${sanitizeFilename(title)}.pdf`);
  } finally {
    exportRoot.remove();
  }
}
