export type SelectionRange = {
  from: number;
  to: number;
};

export type SelectionRectReader = () => DOMRect;

export function shouldShowWorkbenchBubbleMenu({
  editable,
  selectionEmpty,
}: {
  editable: boolean;
  selectionEmpty: boolean;
}) {
  return editable && !selectionEmpty;
}

export function createSelectionBubbleAnchor() {
  let activeRange: SelectionRange | null = null;
  let rect: DOMRect | null = null;

  return {
    observe(range: SelectionRange, readRect: SelectionRectReader) {
      if (range.from === range.to) {
        activeRange = null;
        rect = null;
        return;
      }

      const rangeChanged = activeRange?.from !== range.from || activeRange?.to !== range.to;
      if (rangeChanged || !rect) rect = readRect();
      activeRange = range;
    },
    refresh(readRect: SelectionRectReader) {
      if (activeRange) rect = readRect();
    },
    getRect(readRect: SelectionRectReader) {
      if (!rect) rect = readRect();
      return rect;
    },
  };
}
