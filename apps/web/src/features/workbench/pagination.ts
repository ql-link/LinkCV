export type PageBlock = {
  position: number;
  top: number;
  height: number;
  continuation?: boolean;
  inlineOffset?: number;
  flow?: string;
  keepWithNext?: boolean;
};

export type PageBreak = {
  position: number;
  page: number;
  contentOffset: number;
  remainingContentHeight: number;
  continuation?: boolean;
  inlineOffset?: number;
};

export const A4_HEIGHT_CSS_PX = (297 / 25.4) * 96;
export const PAGE_CONTINUATION_INSET_PX = 12;
const TEXT_CLIP_GUARD_PX = 3;

/**
 * 按测量块计算分页边界。调用方可把超高文本块展开成带 continuation 的文本行；
 * 无法展开的超高块仍允许溢出，并从它的底部开始计算下一页。
 */
export function computePageBreaks(blocks: PageBlock[], pageContentHeight: number, pagePeriod?: number, continuationInset = 0): PageBreak[] {
  if (!Number.isFinite(pageContentHeight) || pageContentHeight <= 0) return [];

  const breaks: PageBreak[] = [];
  let pageStart = 0;
  let page = 1;
  let breakBeforeNextBlock = false;
  let previousBottom = 0;

  const pushBreak = (block: PageBlock, contentOffset: number) => {
    const consumedHeight = Math.max(0, contentOffset - pageStart);
    // A break may start just beyond the page edge (for example after a block
    // margin). Preserve that overshoot so the next page starts at its actual
    // A4 position instead of drifting farther down on every page.
    // The first break moves content past the next page's top inset. Later
    // breaks already start after that inset, so they must not add it again.
    const remainingContentHeight = pageContentHeight - consumedHeight + (page === 1 ? continuationInset : 0);
    page += 1;
    pageStart = contentOffset;
    breaks.push({
      position: block.position,
      page,
      contentOffset,
      remainingContentHeight,
      ...(block.continuation ? { continuation: true, inlineOffset: block.inlineOffset } : {}),
    });
  };

  for (const [index, block] of blocks.entries()) {
    const top = Math.max(0, block.top);
    const height = Math.max(0, block.height);
    const bottom = top + height;

    // A parallel column group can occupy whole pages between two root-flow
    // blocks. Resume on its physical page rather than inventing a new page at
    // the first block after the columns.
    if (pagePeriod && top - previousBottom > pageContentHeight) {
      const physicalPage = Math.floor(top / pagePeriod);
      if (physicalPage * pagePeriod > pageStart) {
        pageStart = physicalPage * pagePeriod;
        page = physicalPage + 1;
        breakBeforeNextBlock = false;
      }
    }

    let nextRequiredHeight = 0;
    if (block.keepWithNext) {
      let previousBottom = bottom;
      for (const next of blocks.slice(index + 1)) {
        if (next.top < previousBottom) break;
        nextRequiredHeight += Math.max(0, next.top - previousBottom);
        nextRequiredHeight += next.keepWithNext ? Math.max(0, next.height) : Math.min(Math.max(0, next.height), 80);
        previousBottom = next.top + next.height;
        if (!next.keepWithNext) break;
      }
    }

    if (breakBeforeNextBlock) {
      pushBreak(block, top);
      breakBeforeNextBlock = false;
    } else if (top > pageStart && bottom + nextRequiredHeight - pageStart > pageContentHeight - (page > 1 ? continuationInset : 0) - TEXT_CLIP_GUARD_PX) {
      pushBreak(block, top);
    }

    if (height > pageContentHeight && !block.continuation) {
      breakBeforeNextBlock = true;
    }
    previousBottom = bottom;
  }

  return breaks;
}

export function pageContentHeight(topMarginMm: number, bottomMarginMm = topMarginMm) {
  const topPx = (Math.max(0, topMarginMm) / 25.4) * 96;
  const bottomPx = (Math.max(0, bottomMarginMm) / 25.4) * 96;
  return Math.max(1, A4_HEIGHT_CSS_PX - topPx - bottomPx);
}
