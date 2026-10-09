import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroDemo } from "./HeroDemo";

describe("HeroDemo", () => {
  it("只有侧栏可点击：切换页面截图、查看对话记录，新建对话回到首页", () => {
    render(<HeroDemo />);
    const nav = screen.getByRole("navigation", { name: "演示侧栏" });
    expect(screen.getByRole("img", { name: "首页 · 示例数据" })).toHaveAttribute("src", expect.stringContaining("home"));
    expect(within(nav).getByRole("button", { name: "首页" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(nav).getByRole("button", { name: "岗位看板" }));
    expect(screen.getByRole("img", { name: "岗位看板 · 示例数据" })).toHaveAttribute("src", expect.stringContaining("jobs"));
    expect(within(nav).getByRole("button", { name: "岗位看板" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "首页" })).not.toHaveAttribute("aria-current");

    const chats = within(nav).getAllByRole("button", { name: /^查看对话记录：/ });
    expect(chats).toHaveLength(4);
    fireEvent.click(chats[1]);
    expect(screen.getByRole("img", { name: /示例数据$/ })).toHaveAttribute("src", expect.stringContaining("chat-1"));

    fireEvent.click(within(nav).getByRole("button", { name: "新建对话" }));
    expect(screen.getByRole("img", { name: "首页 · 示例数据" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "新建对话" })).not.toHaveAttribute("aria-current");
  });

  it("侧栏之外的区域没有可交互控件", () => {
    const { container } = render(<HeroDemo />);
    const interactive = container.querySelectorAll("button, a, input, textarea, [tabindex]");
    for (const element of Array.from(interactive)) expect(element.closest(".fl-demo-nav")).not.toBeNull();
  });
});
