/** Extend a whole-sheet layout's paint without changing its text geometry.
 * This function is also serialized into Chromium by the PDF CLI. */
export function syncResumeSheetColumns({
  paper = document.querySelector<HTMLElement>("[data-resume-print-document]"),
  printMargins,
  measurementPaper,
}: {
  paper?: HTMLElement | null;
  printMargins?: { top: number; right: number; bottom: number; left: number };
  measurementPaper?: HTMLElement;
} = {}) {
  if (!paper) return;
  const content = paper.querySelector<HTMLElement>(".resume-content");
  if (!content) return;
  const editable = content.classList.contains("ProseMirror");
  const surface = editable ? paper : content;
  delete surface.dataset.resumeSheetOutline;
  delete surface.dataset.resumeSheetBackground;
  delete paper.dataset.resumeSheetColumns;
  if (measurementPaper) delete measurementPaper.dataset.resumeSheetColumns;
  const contentStyle = getComputedStyle(content);
  const horizontal = paper.classList.contains("pages-horizontal");
  // Adjacent, equally coloured identity blocks become one painted rectangle.
  // Scaling separate backgrounds can expose fractional-pixel seams in cards.
  // Keep the paint outside ProseMirror and leave the editable text untouched.
  delete paper.dataset.resumeIdentityFill;
  let identityPaint = paper.querySelector<HTMLElement>(":scope > [data-resume-identity-fill-paint]");
  const identityGeometry = measurementPaper ?? paper;
  const measuredIdentityFill = measurementPaper?.dataset.resumeIdentityFill;
  if (measurementPaper) delete measurementPaper.dataset.resumeIdentityFill;
  const identityHeading = identityGeometry.querySelector<HTMLElement>(".resume-content h1");
  const identityBlocks: HTMLElement[] = [];
  const identityColor = identityHeading ? getComputedStyle(identityHeading).backgroundColor : "";
  if (identityHeading && !["", "transparent", "rgba(0, 0, 0, 0)"].includes(identityColor)) {
    const headingBounds = identityHeading.getBoundingClientRect();
    const identityScale = identityGeometry.getBoundingClientRect().width / identityGeometry.offsetWidth || 1;
    let block: HTMLElement | null = identityHeading;
    let bottom = headingBounds.top;
    while (block && identityBlocks.length < 3) {
      const css = getComputedStyle(block);
      const bounds = block.getBoundingClientRect();
      if (css.backgroundColor !== identityColor || !["", "none"].includes(css.backgroundImage)
        || Math.abs(bounds.left - headingBounds.left) > identityScale
        || Math.abs(bounds.right - headingBounds.right) > identityScale
        || (identityBlocks.length > 0 && Math.abs(bounds.top - bottom) > identityScale)) break;
      identityBlocks.push(block);
      bottom = bounds.bottom;
      const next: Element | null = block.nextElementSibling;
      block = next instanceof HTMLElement && next.tagName === "P" ? next : null;
    }
    if (identityBlocks.length >= 2) {
      const sheet = identityGeometry.getBoundingClientRect();
      if (!identityPaint) {
        identityPaint = document.createElement("div");
        identityPaint.dataset.resumeIdentityFillPaint = "true";
        identityPaint.setAttribute("aria-hidden", "true");
        paper.append(identityPaint);
      }
      identityPaint.style.left = `${(headingBounds.left - sheet.left) / identityScale}px`;
      identityPaint.style.top = `${(headingBounds.top - sheet.top) / identityScale}px`;
      identityPaint.style.width = `${headingBounds.width / identityScale}px`;
      identityPaint.style.height = `${(bottom - headingBounds.top) / identityScale}px`;
      identityPaint.style.backgroundColor = identityColor;
      paper.dataset.resumeIdentityFill = String(identityBlocks.length);
    }
  }
  if (!paper.dataset.resumeIdentityFill) identityPaint?.remove();
  if (measurementPaper && measuredIdentityFill) measurementPaper.dataset.resumeIdentityFill = measuredIdentityFill;
  const pageCount = printMargins || paper.classList.contains("smart-one-page") ? 1 : Math.max(1,
    Number.parseInt(paper.style.getPropertyValue("--resume-page-count") || paper.dataset.pageCount || "1", 10) || 1,
  );
  const mm = 96 / 25.4;
  const edges = ["top", "right", "bottom", "left"] as const;
  const visibleBorder = edges.some((edge) => (
    Number.parseFloat(contentStyle.getPropertyValue(`border-${edge}-width`)) > 0
    && contentStyle.getPropertyValue(`border-${edge}-style`) !== "none"
    && !["transparent", "rgba(0, 0, 0, 0)"].includes(contentStyle.getPropertyValue(`border-${edge}-color`))
  ));
  let outline = paper.querySelector<HTMLElement>(":scope > [data-resume-sheet-outline-paint]");
  const visibleBackground = (contentStyle.backgroundImage !== "" && contentStyle.backgroundImage !== "none")
    || !["transparent", "rgba(0, 0, 0, 0)", ""].includes(contentStyle.backgroundColor);
  if (visibleBorder || visibleBackground) {
    if (!outline) {
      outline = document.createElement("div");
      outline.dataset.resumeSheetOutlinePaint = "true";
      outline.setAttribute("aria-hidden", "true");
      paper.append(outline);
    }
    for (const edge of edges) outline.style.setProperty(`border-${edge}`, contentStyle.getPropertyValue(`border-${edge}`));
    outline.style.borderRadius = contentStyle.borderRadius;
    outline.style.background = visibleBackground ? contentStyle.background : "transparent";
    outline.replaceChildren();
    if (pageCount > 1) {
      outline.dataset.resumeSheetPages = "true";
      for (let page = 0; page < pageCount; page++) {
        const face = document.createElement("div");
        face.style.cssText = `position:absolute;left:0;top:${page * (297 * mm + 24)}px;width:210mm;height:297mm;box-sizing:border-box;--resume-sheet-page-index:${page}`;
        for (const edge of edges) face.style.setProperty(`border-${edge}`, contentStyle.getPropertyValue(`border-${edge}`));
        face.style.borderRadius = contentStyle.borderRadius;
        face.style.background = visibleBackground ? contentStyle.background : "transparent";
        outline.append(face);
      }
    } else delete outline.dataset.resumeSheetPages;
    if (visibleBorder) surface.dataset.resumeSheetOutline = "true";
    if (visibleBackground) surface.dataset.resumeSheetBackground = "true";
  } else outline?.remove();
  const columns = content?.querySelector<HTMLElement>(":scope > :is(.resume-columns,.resume-layout-columns):only-child");
  let stripPaint = paper.querySelector<HTMLElement>(":scope > [data-resume-sheet-column-strip]");
  if (!columns || (!horizontal && !editable)) stripPaint?.remove();
  if (!columns) return;
  const rails = Array.from(columns.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  // Remove the paint override while reading the active theme, including after
  // a theme switch or a page-margin change in the editor.
  if (!editable) for (const rail of rails) delete rail.dataset.resumeColumnFill;
  const geometryPaper = measurementPaper ?? paper;
  const geometryRails = measurementPaper
    ? Array.from(measurementPaper.querySelector<HTMLElement>(".resume-content > :is(.resume-columns,.resume-layout-columns):only-child")?.children ?? [])
    : rails;
  const sheet = geometryPaper.getBoundingClientRect();
  const scale = sheet.width / geometryPaper.offsetWidth || 1;
  const bounds = geometryRails.map((rail) => rail.getBoundingClientRect());
  const first = Math.min(...bounds.map((rect) => rect.left));
  const last = Math.max(...bounds.map((rect) => rect.right));
  if (horizontal || editable) {
    if (!stripPaint) {
      stripPaint = document.createElement("div");
      stripPaint.dataset.resumeSheetColumnStrip = "true";
      stripPaint.setAttribute("aria-hidden", "true");
      paper.append(stripPaint);
    }
    stripPaint.replaceChildren();
  }
  rails.forEach((rail, index) => {
    const rect = bounds[index];
    const css = getComputedStyle(rail);
    const leftEdge = Math.abs(rect.left - first) < 1;
    const rightEdge = Math.abs(rect.right - last) < 1;
    const background = css.background;
    const shadow = css.boxShadow;
    const borders = edges.map((edge) => css.getPropertyValue(`border-${edge}`));
    // Rounded inner corners remain part of the theme; outer corners meet the
    // rectangular paper edge instead of exposing little white wedges.
    const radius = [
      leftEdge ? "0px" : css.borderTopLeftRadius,
      rightEdge ? "0px" : css.borderTopRightRadius,
      rightEdge ? "0px" : css.borderBottomRightRadius,
      leftEdge ? "0px" : css.borderBottomLeftRadius,
    ].join(" ");
    if (!editable) {
      rail.style.setProperty("--resume-column-fill-background", background);
      rail.style.setProperty("--resume-column-fill-radius", radius);
      rail.style.setProperty("--resume-column-fill-shadow", shadow);
      edges.forEach((edge, index) => rail.style.setProperty(`--resume-column-fill-border-${edge}`, borders[index]));
    }
    if (printMargins && !editable) {
      const left = leftEdge ? -printMargins.left * mm : rect.left;
      const right = rightEdge ? sheet.right + printMargins.right * mm : rect.right;
      rail.style.setProperty("--resume-column-fill-left", `${left}px`);
      rail.style.setProperty("--resume-column-fill-width", `${right - left}px`);
      rail.style.setProperty("--resume-column-fill-top", `${-printMargins.top * mm}px`);
      rail.style.setProperty("--resume-column-fill-bottom", `${-printMargins.bottom * mm}px`);
    } else if (!editable) {
      rail.style.setProperty("--resume-column-fill-left", `${leftEdge ? (sheet.left - rect.left) / scale : 0}px`);
      rail.style.setProperty("--resume-column-fill-right", `${rightEdge ? (rect.right - sheet.right) / scale : 0}px`);
      rail.style.setProperty("--resume-column-fill-top", `${(sheet.top - rect.top) / scale}px`);
      rail.style.setProperty("--resume-column-fill-bottom", `${Math.min(0, (rect.bottom - sheet.bottom) / scale)}px`);
    }
    if (!editable) rail.dataset.resumeColumnFill = "true";
    if ((horizontal || editable) && stripPaint) {
      for (let page = 0; page < pageCount; page++) {
        const face = document.createElement("div");
        const left = leftEdge ? 0 : (rect.left - sheet.left) / scale;
        const right = rightEdge ? 0 : (sheet.right - rect.right) / scale;
        face.style.cssText = `position:absolute;left:${left}px;top:${page * (297 * mm + 24)}px;width:calc(210mm - ${left + right}px);height:${pageCount === 1 && !horizontal ? "100%" : "297mm"};box-sizing:border-box;--resume-sheet-page-index:${page}`;
        face.style.background = background;
        face.style.borderRadius = radius;
        face.style.boxShadow = shadow;
        edges.forEach((edge, index) => face.style.setProperty(`border-${edge}`, borders[index]));
        stripPaint.append(face);
      }
    }
  });
  if (editable) paper.dataset.resumeSheetColumns = "true";
}
