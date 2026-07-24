import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Brand, Button, Pill, Stepper, TextInput } from ".";

describe("LinkCV design system components", () => {
  it("按钮默认不会提交所在表单", () => {
    render(<Button>保存</Button>);

    expect(screen.getByRole("button", { name: "保存" })).toHaveAttribute("type", "button");
  });

  it("Pill 通过 aria-pressed 暴露选中状态", () => {
    render(<Pill active>智能一页</Pill>);

    expect(screen.getByRole("button", { name: "智能一页" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Stepper 不会突破最大值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stepper label="字号" value={14} min={8} max={14} step={0.5} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "字号增大" }));

    expect(onChange).toHaveBeenCalledWith(14);
  });

  it("文本输入框保留可访问标签", () => {
    render(<TextInput label="邮箱" type="email" />);

    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveAttribute("type", "email");
  });

  it("Brand 可以在不同页面复用登录页品牌锁定组合", () => {
    render(<Brand className="landing-brand" />);

    const brand = screen.getByLabelText("LinkCV");
    expect(brand).toHaveClass("ds-brand", "landing-brand");
    expect(brand.querySelector(".ds-brand-mark")).toBeInTheDocument();
    expect(screen.getByText("LinkCV")).toBeInTheDocument();
  });
});
