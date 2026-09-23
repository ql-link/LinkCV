import {
  A4_HEIGHT_CSS_PX,
  PAGE_CONTINUATION_INSET_PX,
  computePageBreaks,
  pageContentHeight,
  type PageBlock,
} from "../workbench/pagination";

type Anchor =
  | { kind: "block"; element: HTMLElement }
  | { kind: "text"; node: Text; offset: number };

function textNodes(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.textContent?.trim()) nodes.push(node);
  }
  return nodes;
}

function firstOffsetOnLine(node: Text, lineTop: number) {
  let low = 0;
  let high = Math.max(0, node.length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const range = document.createRange();
    range.setStart(node, middle);
    range.setEnd(node, Math.min(node.length, middle + 1));
    if (range.getBoundingClientRect().top < lineTop - 1) low = middle + 1;
    else high = middle;
  }
  return low;
}

function candidates(content: HTMLElement): HTMLElement[] {
  const expand = (element: Element): HTMLElement[] => {
    if (!(element instanceof HTMLElement)) return [];
    if (element.matches(".resume-columns, .resume-layout-columns, .resume-column, .resume-layout-column")) {
      return Array.from(element.children).flatMap(expand);
    }
    if (element.matches("ol, ul")) {
      return Array.from(element.children).flatMap(expand);
    }
    return [element];
  };
  const result = Array.from(content.children).flatMap(expand);
  while (result.length && result[result.length - 1].matches("p") && !result[result.length - 1].textContent?.trim()) result.pop();
  return result;
}

function flowOf(element: HTMLElement, content: HTMLElement) {
  const column = element.closest<HTMLElement>(".resume-column, .resume-layout-column");
  const columns = column?.parentElement;
  if (!column || !columns) return "root";
  const group = Array.from(content.querySelectorAll(".resume-columns, .resume-layout-columns")).indexOf(columns);
  return `group-${group}-column-${Array.from(columns.children).indexOf(column)}`;
}

/** Add non-editable A4 gaps to the same DOM that renders the shared snapshot. */
export function paginateShareDocument(paper: HTMLElement): number {
  paper.querySelectorAll(".share-page-break").forEach((marker) => marker.remove());
  paper.normalize();
  const content = paper.querySelector<HTMLElement>(".resume-print-content");
  if (!content) return 1;
  const computed = getComputedStyle(paper);
  const topMm = Number.parseFloat(computed.getPropertyValue("--resume-page-margin-top")) || 0;
  const bottomMm = Number.parseFloat(computed.getPropertyValue("--resume-page-margin-bottom")) || 0;
  const topPx = topMm / 25.4 * 96;
  const bottomPx = bottomMm / 25.4 * 96;
  const usableHeight = pageContentHeight(topMm, bottomMm);
  const contentTop = content.getBoundingClientRect().top;
  const paperLeft = paper.getBoundingClientRect().left;
  const anchors = new Map<number, Anchor>();
  let position = 0;
  const blocks = candidates(content).flatMap((element): PageBlock[] => {
    const rect = element.getBoundingClientRect();
    const top = rect.top - contentTop;
    const height = rect.height;
    const flow = flowOf(element, content);
    const blockPosition = ++position;
    anchors.set(blockPosition, { kind: "block", element });
    if (element.matches("li") || height > usableHeight) {
      const lines: PageBlock[] = [];
      textNodes(element).forEach((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        Array.from(range.getClientRects()).filter((line) => line.width > 0 && line.height > 0).forEach((line) => {
          const lineTop = line.top - contentTop;
          const previous = lines[lines.length - 1];
          if (previous && Math.abs(previous.top - lineTop) < 1) {
            previous.height = Math.max(previous.height, line.height);
            return;
          }
          const first = lines.length === 0;
          const linePosition = first ? blockPosition : ++position;
          if (!first) anchors.set(linePosition, { kind: "text", node, offset: firstOffsetOnLine(node, line.top) });
          lines.push({
            position: linePosition,
            top: lineTop,
            height: line.height,
            flow,
            ...(first ? {} : { continuation: true, inlineOffset: line.left - paperLeft }),
          });
        });
      });
      if (lines.length > 1) return lines;
    }
    return [{ position: blockPosition, top, height, flow, ...(element.matches("h2, h3") ? { keepWithNext: true } : {}) }];
  });
  const byFlow = new Map<string, PageBlock[]>();
  blocks.forEach((block) => {
    const flow = block.flow ?? "root";
    if (!byFlow.has(flow)) byFlow.set(flow, []);
    byFlow.get(flow)?.push(block);
  });
  const breaks = Array.from(byFlow.values())
    .flatMap((flowBlocks) => computePageBreaks(
      flowBlocks,
      usableHeight,
      A4_HEIGHT_CSS_PX + 24,
      PAGE_CONTINUATION_INSET_PX,
    ))
    .sort((left, right) => right.position - left.position);
  breaks.forEach((pageBreak) => {
    const anchor = anchors.get(pageBreak.position);
    if (!anchor) return;
    const marker = document.createElement(
      anchor.kind === "text" ? "span" : anchor.element.parentElement?.matches("ol, ul") ? "li" : "div",
    );
    marker.className = `share-page-break${anchor.kind === "text" ? " is-text-continuation" : ""}`;
    marker.setAttribute("aria-hidden", "true");
    marker.style.setProperty("--share-break-remaining", `${pageBreak.remainingContentHeight}px`);
    marker.style.setProperty("--share-break-top", `${topPx}px`);
    marker.style.setProperty("--share-break-bottom", `${bottomPx}px`);
    if (pageBreak.inlineOffset !== undefined) {
      marker.style.setProperty("--share-break-inline-offset", `${pageBreak.inlineOffset}px`);
    }
    if (anchor.kind === "block") {
      anchor.element.before(marker);
    } else {
      const tail = anchor.node.splitText(anchor.offset);
      tail.before(marker);
    }
  });
  const pageCount = Math.max(1, ...breaks.map((pageBreak) => pageBreak.page));
  paper.style.setProperty("--share-page-stack-height", `${pageCount * A4_HEIGHT_CSS_PX + (pageCount - 1) * 24}px`);
  paper.dataset.pageCount = String(pageCount);
  return pageCount;
}
