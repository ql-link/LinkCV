import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeroDemo } from "./HeroDemo";

describe("HeroDemo scroll boundary", () => {
  it("只转发来自当前同源演示框的滚动，卸载后停止接收", () => {
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const { unmount } = render(<HeroDemo />);
    const frame = screen.getByTitle("LinkResume 产品互动演示 · 示例数据") as HTMLIFrameElement;
    const source = frame.contentWindow;
    const send = (origin: string, from: Window | null, data: unknown) => {
      window.dispatchEvent(new MessageEvent("message", { origin, source: from, data }));
    };
    send("https://example.test", source, { type: "linkresume:landing-scroll", deltaY: 100 });
    send(location.origin, window, { type: "linkresume:landing-scroll", deltaY: 100 });
    send(location.origin, source, { type: "other", deltaY: 100 });
    send(location.origin, source, { type: "linkresume:landing-scroll", deltaY: NaN });
    expect(scroll).not.toHaveBeenCalled();
    send(location.origin, source, { type: "linkresume:landing-scroll", deltaY: 100 });
    expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
    send(location.origin, source, { type: "linkresume:landing-scroll", deltaY: 1e9 });
    expect(scroll).toHaveBeenLastCalledWith({ top: window.innerHeight * 3, behavior: "instant" });
    unmount();
    send(location.origin, source, { type: "linkresume:landing-scroll", deltaY: 100 });
    expect(scroll).toHaveBeenCalledTimes(2);
  });
});
