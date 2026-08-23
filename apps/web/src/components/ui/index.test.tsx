import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Brand, Button, IconButton, NumberStepper, TextField, TogglePill } from ".";

describe("LinkCV UI components", () => {
  it("按钮默认不会提交所在表单", () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("type", "button");
  });

  it("次要文字按钮统一使用透明圆弧样式，纯图标按钮保持原样", () => {
    render(
      <>
        <Button variant="outline">返回</Button>
        <Button variant="secondary">取消</Button>
        <Button variant="ghost">导入简历</Button>
        <IconButton label="更多">+</IconButton>
      </>,
    );

    expect(screen.getByRole("button", { name: "返回" })).toHaveClass("ui-button-transparent", "rounded-full");
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("ui-button-transparent", "rounded-full");
    expect(screen.getByRole("button", { name: "导入简历" })).toHaveClass("ui-button-transparent", "rounded-full");
    expect(screen.getByRole("button", { name: "更多" })).not.toHaveClass("ui-button-transparent");
  });

  it("TogglePill 通过 aria-pressed 暴露选中状态", () => {
    render(<TogglePill active>智能一页</TogglePill>);
    expect(screen.getByRole("button", { name: "智能一页" })).toHaveAttribute("aria-pressed", "true");
  });

  it("NumberStepper 不会突破最大值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberStepper label="字号" value={14} min={8} max={14} step={0.5} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "字号增大" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("文本输入框保留可访问标签", () => {
    render(<TextField label="邮箱" type="email" />);
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute("type", "email");
  });

  it("紧凑品牌只保留图形标识", () => {
    const { rerender } = render(<Brand compact />);
    expect(screen.getByLabelText("LinkResume").querySelectorAll("img")).toHaveLength(1);
    expect(screen.getByLabelText("LinkResume").querySelector("img")).toHaveClass("ui-brand-mark");

    rerender(<Brand />);
    expect(screen.getByLabelText("LinkResume").querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByLabelText("LinkResume").querySelector(".ui-brand-wordmark")).toBeInTheDocument();
  });
});
