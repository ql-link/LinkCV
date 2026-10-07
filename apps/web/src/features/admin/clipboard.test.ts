import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./kit";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).execCommand;
});

describe("后台 ID 复制", () => {
  it.each([true, false])("HTTP 下复制实际 ID 并反馈实际结果（成功：%s）", async (success) => {
    vi.stubGlobal("navigator", {});
    let copiedText = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        copiedText = (document.activeElement as HTMLTextAreaElement).value;
        return success;
      },
    });
    const notify = vi.fn();

    await copyText("route_demo_12", notify, "已复制线路 ID");

    expect(copiedText).toBe("route_demo_12");
    expect(notify).toHaveBeenCalledOnce();
    if (success) expect(notify).toHaveBeenCalledWith("已复制线路 ID：route_demo_12");
    else expect(notify).toHaveBeenCalledWith("复制失败", "error");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
