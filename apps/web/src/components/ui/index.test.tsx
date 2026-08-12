import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Brand, Button, NumberStepper, TextField, TogglePill } from ".";

describe("LinkCV UI components", () => {
  it("按钮默认不会提交所在表单", () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("type", "button");
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
    render(<Brand compact />);
    expect(screen.getByLabelText("LinkCV")).not.toHaveTextContent("LinkCV");
  });
});
