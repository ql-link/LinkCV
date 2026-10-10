import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeroShowcase } from "./HeroShowcase";

describe("HeroShowcase", () => {
  afterEach(() => vi.restoreAllMocks());

  it("首屏只显示封面，进入视口前不下载视频", () => {
    const { container } = render(<HeroShowcase />);
    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("poster", expect.stringContaining("zh-CN/poster"));
    expect(video).toHaveAttribute("preload", "none");
    expect(video).toHaveProperty("muted", true);
    expect(video).not.toHaveAttribute("loop");
    expect(screen.getByRole("button", { name: "跳过短片" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "演示侧栏" })).not.toBeInTheDocument();
  });

  it("短片播完后切换为互动演示，并可以重看短片", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const { container } = render(<HeroShowcase />);

    fireEvent.ended(container.querySelector("video")!);
    expect(screen.getByRole("navigation", { name: "演示侧栏" })).toBeInTheDocument();
    expect(screen.getByText("互动演示 · 示例数据")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重看短片" }));
    expect(screen.queryByRole("navigation", { name: "演示侧栏" })).not.toBeInTheDocument();
    expect(container.querySelector("video")).toHaveAttribute("src", expect.stringMatching(/zh-CN\/teaser-(720|1080)\.mp4/));
    expect(play).toHaveBeenCalled();
  });
});
