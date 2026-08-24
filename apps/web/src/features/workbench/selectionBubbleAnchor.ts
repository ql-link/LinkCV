export type SelectionRange = {
  from: number;
  to: number;
};

export type SelectionRectReader = () => DOMRect;
export type SelectionPositionUpdater = () => void;

export function shouldShowSelectionAgentBubble({
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
      if (!activeRange) return false;
      rect = readRect();
      return true;
    },
    getRect(readRect: SelectionRectReader) {
      if (!rect) rect = readRect();
      return rect;
    },
  };
}

export function refreshSelectionBubblePosition(
  anchor: ReturnType<typeof createSelectionBubbleAnchor>,
  readRect: SelectionRectReader,
  updatePosition: SelectionPositionUpdater,
) {
  if (!anchor.refresh(readRect)) return false;
  updatePosition();
  return true;
}
