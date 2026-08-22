export type PageBlock = {
  position: number;
  top: number;
  height: number;
  continuation?: boolean;
  inlineOffset?: number;
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

/**
 * 按测量块计算分页边界。调用方可把超高文本块展开成带 continuation 的文本行；
 * 无法展开的超高块仍允许溢出，并从它的底部开始计算下一页。
 */
export function computePageBreaks(blocks: PageBlock[], pageContentHeight: number): PageBreak[] {
  if (!Number.isFinite(pageContentHeight) || pageContentHeight <= 0) return [];

  const breaks: PageBreak[] = [];
  let pageStart = 0;
  let page = 1;
  let breakBeforeNextBlock = false;

  const pushBreak = (block: PageBlock, contentOffset: number) => {
    const consumedHeight = Math.max(0, contentOffset - pageStart);
    const remainingContentHeight = Math.max(0, pageContentHeight - consumedHeight);
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

  for (const block of blocks) {
    const top = Math.max(0, block.top);
    const height = Math.max(0, block.height);
    const bottom = top + height;

    if (breakBeforeNextBlock) {
      pushBreak(block, top);
      breakBeforeNextBlock = false;
    } else if (top > pageStart && bottom - pageStart > pageContentHeight) {
      pushBreak(block, top);
    }

    if (height > pageContentHeight && !block.continuation) {
      breakBeforeNextBlock = true;
    }
  }

  return breaks;
}

export function pageContentHeight(verticalMarginMm: number) {
  const marginPx = (Math.max(0, verticalMarginMm) / 25.4) * 96;
  return Math.max(1, A4_HEIGHT_CSS_PX - marginPx * 2);
}
