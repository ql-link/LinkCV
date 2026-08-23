import { describe, expect, it, vi } from "vitest";
import { createSelectionBubbleAnchor, shouldShowSelectionAgentBubble } from "./selectionBubbleAnchor";

function rect(left: number) {
  return { left } as DOMRect;
}

describe("selectionBubbleAnchor", () => {
  it("只在可编辑状态选中文字后显示 AI 提示", () => {
    expect(shouldShowSelectionAgentBubble({ editable: true, selectionEmpty: false })).toBe(true);
    expect(shouldShowSelectionAgentBubble({ editable: true, selectionEmpty: true })).toBe(false);
    expect(shouldShowSelectionAgentBubble({ editable: false, selectionEmpty: false })).toBe(false);
  });

  it("同一选区格式变化时保持原锚点", () => {
    const anchor = createSelectionBubbleAnchor();
    const first = vi.fn(() => rect(120));
    const changedLayout = vi.fn(() => rect(108));

    anchor.observe({ from: 2, to: 8 }, first);
    anchor.observe({ from: 2, to: 8 }, changedLayout);

    expect(anchor.getRect(changedLayout).left).toBe(120);
    expect(first).toHaveBeenCalledOnce();
    expect(changedLayout).not.toHaveBeenCalled();
  });

  it("选区变化或滚动刷新时更新锚点", () => {
    const anchor = createSelectionBubbleAnchor();
    anchor.observe({ from: 2, to: 8 }, () => rect(120));
    anchor.observe({ from: 10, to: 14 }, () => rect(260));
    expect(anchor.getRect(() => rect(0)).left).toBe(260);

    anchor.refresh(() => rect(240));
    expect(anchor.getRect(() => rect(0)).left).toBe(240);

    anchor.observe({ from: 10, to: 10 }, () => rect(0));
    expect(anchor.getRect(() => rect(320)).left).toBe(320);
  });
});
