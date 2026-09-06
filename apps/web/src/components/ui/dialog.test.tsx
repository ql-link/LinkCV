import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogTitle } from "./dialog";

describe("Dialog", () => {
  it("让 Portal 中的遮罩和面板继承工作区浅色主题", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>测试弹窗</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toHaveAttribute("data-ui-theme", "light");
    expect(screen.getByRole("dialog", { name: "测试弹窗" })).toHaveClass("text-foreground");
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveAttribute("data-ui-theme", "light");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveAttribute("data-slot", "dialog-close");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveClass("bg-transparent", "hover:bg-transparent");
    expect(screen.getByRole("button", { name: "关闭" })).not.toHaveClass("rounded-full");
  });
});
