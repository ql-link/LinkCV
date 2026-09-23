import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { A4_HEIGHT_CSS_PX, computePageBreaks, pageContentHeight, type PageBlock, type PageBreak } from "./pagination";

export const paginationPluginKey = new PluginKey<DecorationSet>("resumePagination");
const META_KEY = "resume-pagination-breaks";
const PAGINATION_STYLE_PROPERTIES = [
  "--resume-font-family",
  "--resume-font-size",
  "--resume-line-height",
  "--resume-page-margin-x",
  "--resume-page-margin-y",
  "--resume-page-margin-top",
  "--resume-page-margin-bottom",
];

function classSignature(value: string | null) {
  return (value ?? "")
    .split(/\s+/u)
    .filter((name) => name && name !== "pages-horizontal")
    .sort()
    .join(" ");
}

function stylePropertyValue(cssText: string | null, property: string) {
  const style = document.createElement("div").style;
  style.cssText = cssText ?? "";
  return style.getPropertyValue(property);
}

export function paginationMutationRequiresMeasure(
  attributeName: string | null,
  previousValue: string | null,
  currentValue: string | null,
) {
  if (attributeName === "class") return classSignature(previousValue) !== classSignature(currentValue);
  if (attributeName === "style") {
    return PAGINATION_STYLE_PROPERTIES.some((property) => (
      stylePropertyValue(previousValue, property) !== stylePropertyValue(currentValue, property)
    ));
  }
  return false;
}

function sameBreaks(left: PageBreak[], right: PageBreak[]) {
  return left.length === right.length
    && left.every((item, index) => item.position === right[index]?.position
      && item.page === right[index]?.page
      && item.continuation === right[index]?.continuation
      && Math.abs(item.contentOffset - (right[index]?.contentOffset ?? -1)) < 0.5
      && Math.abs(item.remainingContentHeight - (right[index]?.remainingContentHeight ?? -1)) < 0.5
      && Math.abs((item.inlineOffset ?? -1) - (right[index]?.inlineOffset ?? -1)) < 0.5);
}

function samePositions(left: number[], right: number[]) {
  return left.length === right.length && left.every((position, index) => position === right[index]);
}

function breakDecoration(pageBreak: PageBreak, marginPx: number, bottomMarginPx: number, inList: boolean) {
  return Decoration.widget(pageBreak.position, () => {
    const marker = document.createElement(pageBreak.continuation ? "span" : inList ? "li" : "div");
    marker.className = `workbench-page-break${pageBreak.continuation ? " is-list-continuation" : ""}`;
    marker.dataset.pageBreak = String(pageBreak.contentOffset);
    marker.dataset.pageIndex = String(pageBreak.page);
    marker.setAttribute("contenteditable", "false");
    marker.setAttribute("aria-hidden", "true");
    marker.style.setProperty("--page-break-margin", `${marginPx}px`);
    marker.style.setProperty("--page-break-bottom-margin", `${bottomMarginPx}px`);
    marker.style.setProperty("--page-break-remaining-height", `${pageBreak.remainingContentHeight}px`);
    if (pageBreak.inlineOffset !== undefined) {
      marker.style.setProperty("--page-break-inline-offset", `${pageBreak.inlineOffset}px`);
    }
    return marker;
  }, {
    key: `page-break-${pageBreak.position}-${pageBreak.page}-${Math.round(pageBreak.remainingContentHeight * 10)}`,
    side: -1,
  });
}

export function paginationCandidates(editor: HTMLElement) {
  const isEmptyTrailingParagraph = (element: HTMLElement) => element.matches("p")
    && !paginationTextNodes(element).some((node) => node.textContent?.trim())
    && !element.querySelector("img:not(.ProseMirror-separator), .resume-inline-icon, .resume-inline-image");
  const trimEmptyTail = (elements: HTMLElement[]) => {
    while (elements.length && isEmptyTrailingParagraph(elements[elements.length - 1])) elements.pop();
    return elements;
  };
  const expand = (element: Element): HTMLElement[] => {
    if (!(element instanceof HTMLElement)
      || element.classList.contains("workbench-page-break")) return [];
    if (element.matches(".resume-columns, .resume-layout-columns, .resume-column, .resume-layout-column")) {
      return trimEmptyTail(Array.from(element.children).flatMap(expand));
    }
    if (element.matches("ol, ul")) {
      return Array.from(element.children).filter((child): child is HTMLElement => (
        child instanceof HTMLElement && child.matches("li:not(.workbench-page-break)")
      ));
    }
    return [element];
  };
  return trimEmptyTail(Array.from(editor.children).flatMap(expand));
}

export function paginationTrailingEmptyParagraphs(editor: HTMLElement) {
  const isEmpty = (element: Element) => element.matches("p")
    && !paginationTextNodes(element as HTMLElement).some((node) => node.textContent?.trim())
    && !element.querySelector("img:not(.ProseMirror-separator), .resume-inline-icon, .resume-inline-image");
  const containers = [editor, ...editor.querySelectorAll<HTMLElement>(
    ".resume-column, .resume-layout-column",
  )];
  return containers.flatMap((container) => {
    const trailing: HTMLElement[] = [];
    for (const child of Array.from(container.children).reverse()) {
      if (!(child instanceof HTMLElement) || child.classList.contains("workbench-page-break")) continue;
      if (!isEmpty(child)) break;
      trailing.push(child);
    }
    return trailing;
  });
}

function paginationFlow(element: HTMLElement) {
  const column = element.closest<HTMLElement>(".resume-column, .resume-layout-column");
  if (!column) return "root";
  const columns = column.parentElement;
  const editor = column.closest<HTMLElement>(".resume-content");
  if (!columns || !editor) return "root";
  const groupIndex = Array.from(editor.querySelectorAll(".resume-columns, .resume-layout-columns")).indexOf(columns);
  return `group-${groupIndex}-column-${Array.from(columns.children).indexOf(column)}`;
}

function setPageStripMetrics(paper: HTMLElement, pageCount: number) {
  const normalizedCount = Math.max(1, pageCount);
  const pageWidthPx = (210 / 25.4) * 96;
  const pageHeightPx = (297 / 25.4) * 96;
  const gapPx = 24;
  const stripWidth = normalizedCount * pageWidthPx + (normalizedCount - 1) * gapPx;
  const stackHeight = normalizedCount * pageHeightPx + (normalizedCount - 1) * gapPx;
  const count = String(normalizedCount);
  const width = `${stripWidth}px`;
  const height = `${stackHeight}px`;
  if (paper.style.getPropertyValue("--resume-page-count") !== count) paper.style.setProperty("--resume-page-count", count);
  if (paper.style.getPropertyValue("--resume-page-strip-width") !== width) paper.style.setProperty("--resume-page-strip-width", width);
  if (paper.style.getPropertyValue("--resume-page-stack-height") !== height) paper.style.setProperty("--resume-page-stack-height", height);
}

export function paginationTextNodes(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!node.textContent || !parent || parent.closest(".workbench-page-break, .media-context-toolbar, .media-resize-handle, .resume-line-add")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function markerHeightBefore(markers: Array<{ rect: DOMRect; height: number }>, top: number) {
  return markers
    .filter((marker) => marker.rect.top < top)
    .reduce((total, marker) => total + marker.height, 0);
}

function characterRect(textNode: Text, offset: number) {
  const range = document.createRange();
  const start = Math.min(Math.max(0, offset), Math.max(0, textNode.length - 1));
  range.setStart(textNode, start);
  range.setEnd(textNode, Math.min(textNode.length, start + 1));
  return range.getBoundingClientRect();
}

function firstOffsetOnLine(textNode: Text, lineTop: number) {
  let low = 0;
  let high = Math.max(0, textNode.length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (characterRect(textNode, middle).top < lineTop - 1) low = middle + 1;
    else high = middle;
  }
  return low;
}

export const PaginationExtension = Extension.create({
  name: "resumePagination",

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: paginationPluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, current) {
          const meta = transaction.getMeta(META_KEY) as { breaks: PageBreak[]; marginPx: number; bottomMarginPx: number; collapsedPositions: number[] } | undefined;
          if (meta) {
            return DecorationSet.create(
              transaction.doc,
              [
                ...meta.collapsedPositions.flatMap((position) => {
                  const node = transaction.doc.nodeAt(position);
                  return node?.type.name === "paragraph"
                    ? [Decoration.node(position, position + node.nodeSize, { class: "pagination-trailing-empty" })]
                    : [];
                }),
                ...meta.breaks.map((item) => breakDecoration(
                  item,
                  meta.marginPx,
                  meta.bottomMarginPx,
                  ["bulletList", "orderedList"].includes(transaction.doc.resolve(item.position).parent.type.name),
                )),
              ],
            );
          }
          return current.map(transaction.mapping, transaction.doc);
        },
      },
      props: {
        decorations(state) {
          return paginationPluginKey.getState(state) ?? DecorationSet.empty;
        },
      },
      view(editorView) {
        let frame = 0;
        let pendingRelevantMeasure = true;
        let deferredRelevantMeasure = false;
        let lastBreaks: PageBreak[] = [];
        let lastMarginPx = -1;
        let lastBottomMarginPx = -1;
        let lastCollapsedPositions: number[] = [];

        const measure = () => {
          frame = 0;
          const relevantMeasure = pendingRelevantMeasure;
          // 输入法组合中不派发事务：dispatch 会强制 flush DOM 观察者，把还没
          // 提交的组合文本提前写进文档并重绘，打断中文输入法。组合结束后的
          // 下一次 update 会带着这个标记重新测量。
          if (editorView.composing) {
            pendingRelevantMeasure ||= relevantMeasure;
            return;
          }
          pendingRelevantMeasure = false;
          const editor = editorView.dom as HTMLElement;
          // Drag previews hide the source range and insert a real flow placeholder.
          // Measure that current flow so page gaps move with the surrounding content;
          // cleanup dispatches another measure after cancel or drop.
          const paper = editor.closest<HTMLElement>(".resume-paper");
          // Arrangement changes only alter how the existing page breaks are laid out.
          // Measuring here would clone the complete horizontal document in the middle
          // of the compositor animation and block the main thread for large resumes.
          if (paper?.dataset.arrangementTransition) {
            deferredRelevantMeasure ||= relevantMeasure;
            return;
          }
          if (!paper || paper.classList.contains("smart-one-page")) {
            if (paper) setPageStripMetrics(paper, 1);
            if (lastBreaks.length > 0 || lastCollapsedPositions.length > 0) {
              lastBreaks = [];
              lastCollapsedPositions = [];
              lastMarginPx = 0;
              lastBottomMarginPx = 0;
              editorView.dispatch(editorView.state.tr.setMeta(META_KEY, { breaks: [], marginPx: 0, bottomMarginPx: 0, collapsedPositions: [] }));
            }
            return;
          }

          const computedPaper = getComputedStyle(paper);
          const defaultMargin = Number.parseFloat(computedPaper.getPropertyValue("--resume-page-margin-y")) || 0;
          const configuredTopMargin = Number.parseFloat(computedPaper.getPropertyValue("--resume-page-margin-top"));
          const configuredBottomMargin = Number.parseFloat(computedPaper.getPropertyValue("--resume-page-margin-bottom"));
          const topMargin = Number.isFinite(configuredTopMargin) ? configuredTopMargin : defaultMargin;
          const bottomMargin = Number.isFinite(configuredBottomMargin) ? configuredBottomMargin : defaultMargin;
          const marginPx = (topMargin / 25.4) * 96;
          const bottomMarginPx = (bottomMargin / 25.4) * 96;
          const contentHeight = pageContentHeight(topMargin, bottomMargin);
          const sourceCandidates = paginationCandidates(editor);
          const collapsedPositions = paginationTrailingEmptyParagraphs(editor)
            .map((element) => editorView.posAtDOM(element, 0) - 1)
            .filter((position) => {
              const node = editorView.state.doc.nodeAt(position);
              return node?.type.name === "paragraph"
                && !(editorView.state.selection.from > position
                  && editorView.state.selection.from < position + node.nodeSize);
            });
          let measurementPaper: HTMLElement | null = null;
          let measurementEditor = editor;
          if (paper.classList.contains("pages-horizontal")) {
            measurementPaper = paper.cloneNode(true) as HTMLElement;
            measurementPaper.classList.remove("pages-horizontal");
            measurementPaper.classList.add("pagination-measure-paper");
            measurementPaper.setAttribute("aria-hidden", "true");
            measurementPaper.inert = true;
            measurementPaper.style.zoom = "1";
            paper.parentElement?.appendChild(measurementPaper);
            measurementEditor = measurementPaper.querySelector<HTMLElement>(".resume-content") ?? editor;
          }
          const editorRect = measurementEditor.getBoundingClientRect();
          const paperRect = measurementPaper?.getBoundingClientRect() ?? paper.getBoundingClientRect();
          // offsetHeight is rounded to an integer and changes when page-break
          // widgets are inserted. Deriving zoom from it feeds those changes back
          // into every measured block position, especially near an A4 seam.
          const zoom = Number.parseFloat(getComputedStyle(measurementPaper ?? paper).zoom);
          const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
          const markers = Array.from(measurementEditor.querySelectorAll<HTMLElement>(".workbench-page-break"));
          const candidates = paginationCandidates(measurementEditor);
          const markerMeasurements = markers.map((marker) => ({
            rect: marker.getBoundingClientRect(),
            height: marker.offsetHeight,
            flow: paginationFlow(marker),
          }));
          const blocks = candidates.flatMap((element, index) => {
            const sourceElement = sourceCandidates[index];
            if (!sourceElement) return [];
            try {
              const flow = paginationFlow(element);
              const flowMarkers = markerMeasurements.filter((marker) => marker.flow === flow);
              const rect = element.getBoundingClientRect();
              const insertedHeight = markerHeightBefore(flowMarkers, rect.top);
              // A whole-block break must sit before the node. Putting the widget
              // at the first text position leaves headings and their decorations
              // on the previous page while only the following body moves.
              const position = editorView.posAtDOM(sourceElement, 0) - 1;
              const normalizedHeight = rect.height / Math.max(scale, 0.01)
                - flowMarkers
                  .filter((marker) => marker.rect.top >= rect.top && marker.rect.top < rect.bottom)
                  .reduce((total, marker) => total + marker.height, 0);

              if (element.matches("li") || normalizedHeight > contentHeight) {
                const measurementNodes = paginationTextNodes(element);
                const sourceNodes = paginationTextNodes(sourceElement);
                const lines: PageBlock[] = [];
                measurementNodes.forEach((textNode, nodeIndex) => {
                  const sourceNode = sourceNodes[nodeIndex];
                  if (!sourceNode) return;
                  const textRange = document.createRange();
                  textRange.selectNodeContents(textNode);
                  const lineRects = Array.from(textRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
                  lineRects.forEach((lineRect) => {
                    const offset = firstOffsetOnLine(textNode, lineRect.top);
                    const top = (lineRect.top - editorRect.top) / Math.max(scale, 0.01)
                      - markerHeightBefore(flowMarkers, lineRect.top);
                    const height = lineRect.height / Math.max(scale, 0.01);
                    const previous = lines[lines.length - 1];
                    if (previous && Math.abs(previous.top - top) < 1) {
                      previous.height = Math.max(previous.height, height);
                      return;
                    }
                    const firstLine = lines.length === 0;
                    lines.push({
                      position: firstLine
                        ? Math.max(1, position)
                        : Math.max(1, editorView.posAtDOM(sourceNode, offset)),
                      top,
                      height,
                      flow,
                      ...(firstLine ? {} : {
                        continuation: true,
                        inlineOffset: (lineRect.left - paperRect.left) / Math.max(scale, 0.01),
                      }),
                    });
                  });
                });
                if (lines.length > 1) return lines;
              }

              return [{
                position: Math.max(1, position),
                top: (rect.top - editorRect.top) / Math.max(scale, 0.01) - insertedHeight,
                height: normalizedHeight,
                flow,
                ...(element.matches("h2, h3") ? { keepWithNext: true } : {}),
              }];
            } catch {
              return [];
            }
          });
          measurementPaper?.remove();
          const grouped = new Map<string, PageBlock[]>();
          blocks.forEach((block) => {
            const flow = block.flow ?? "root";
            if (!grouped.has(flow)) grouped.set(flow, []);
            grouped.get(flow)?.push(block);
          });
          const flowBreaks = Array.from(grouped.values()).map((flowBlocks) => (
            computePageBreaks(flowBlocks, contentHeight, A4_HEIGHT_CSS_PX + 24)
          ));
          const nextBreaks = flowBreaks.flat().sort((left, right) => left.position - right.position);
          setPageStripMetrics(paper, Math.max(1, ...nextBreaks.map((pageBreak) => pageBreak.page)));
          if (!sameBreaks(lastBreaks, nextBreaks)
            || !samePositions(lastCollapsedPositions, collapsedPositions)
            || Math.abs(lastMarginPx - marginPx) >= 0.5
            || Math.abs(lastBottomMarginPx - bottomMarginPx) >= 0.5) {
            lastBreaks = nextBreaks;
            lastCollapsedPositions = collapsedPositions;
            lastMarginPx = marginPx;
            lastBottomMarginPx = bottomMarginPx;
            editorView.dispatch(editorView.state.tr.setMeta(META_KEY, { breaks: nextBreaks, marginPx, bottomMarginPx, collapsedPositions }));
          }
        };

        const schedule = (relevantMeasure = true) => {
          pendingRelevantMeasure ||= relevantMeasure;
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(measure);
        };
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule(false));
        const paper = editorView.dom.closest<HTMLElement>(".resume-paper");
        const mutationObserver = typeof MutationObserver === "undefined" || !paper ? null : new MutationObserver((records) => {
          const relevantMeasure = records.some((record) => {
            const attributeName = record.attributeName;
            return paginationMutationRequiresMeasure(
              attributeName,
              record.oldValue,
              attributeName && record.target instanceof HTMLElement
                ? record.target.getAttribute(attributeName)
                : null,
            );
          });
          if (relevantMeasure) schedule(true);
        });
        const resumeDeferredMeasure = () => {
          if (!deferredRelevantMeasure) return;
          deferredRelevantMeasure = false;
          schedule(true);
        };
        const handleLoad = () => schedule(true);
        observer?.observe(editorView.dom);
        if (mutationObserver && paper) mutationObserver.observe(paper, {
          attributes: true,
          attributeFilter: ["class", "style"],
          attributeOldValue: true,
        });
        paper?.addEventListener("resume-arrangement-transition-end", resumeDeferredMeasure);
        editorView.dom.addEventListener("load", handleLoad, true);
        schedule(true);

        return {
          update() {
            schedule(true);
          },
          destroy() {
            if (frame) cancelAnimationFrame(frame);
            observer?.disconnect();
            mutationObserver?.disconnect();
            paper?.removeEventListener("resume-arrangement-transition-end", resumeDeferredMeasure);
            editorView.dom.removeEventListener("load", handleLoad, true);
          },
        };
      },
    })];
  },
});
