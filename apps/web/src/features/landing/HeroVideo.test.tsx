import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroVideo } from "./HeroVideo";

describe("HeroVideo", () => {
  afterEach(() => vi.restoreAllMocks());

  it("首屏只显示封面，进入视口前不下载视频", () => {
    render(<HeroVideo />);
    const video = screen.getByLabelText("LinkResume 产品短片");
    expect(video).toHaveAttribute("poster", expect.stringContaining("zh-CN/poster"));
    expect(video).toHaveAttribute("preload", "none");
    expect(video).not.toHaveAttribute("src");
    expect(video).toHaveProperty("muted", true);
  });

  it("点击播放时才加载视频，播放中可以暂停", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event("pause"));
    });
    render(<HeroVideo />);
    const video = screen.getByLabelText("LinkResume 产品短片");

    fireEvent.click(screen.getByRole("button", { name: "播放短片" }));
    expect(video).toHaveAttribute("src", expect.stringMatching(/zh-CN\/teaser-(720|1080)\.mp4/));
    expect(play).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "暂停短片" }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "播放短片" })).toBeInTheDocument();
  });
});
