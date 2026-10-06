import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageActions } from "./MessageActions";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).execCommand;
});

describe("MessageActions clipboard compatibility", () => {
  it("copies the complete message without the Clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    let copiedText = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => {
        copiedText = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      }),
    });
    render(<MessageActions content={"**修改建议**\n保留原文 😀"} createdAt="2026-10-06T08:00:00Z" timeLabel="16:00" />);

    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));

    expect(await screen.findByRole("button", { name: "已复制消息" })).toBeInTheDocument();
    expect(copiedText).toBe("**修改建议**\n保留原文 😀");
  });

  it("shows failure instead of success when the browser rejects copying", async () => {
    vi.stubGlobal("navigator", {});
    Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
    render(<MessageActions content="message" createdAt="2026-10-06T08:00:00Z" timeLabel="16:00" />);

    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));

    expect(await screen.findByRole("button", { name: "复制失败，重试" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "已复制消息" })).not.toBeInTheDocument();
  });
});
