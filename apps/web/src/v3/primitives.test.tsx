import { useRef, useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateTimeField, Dialog, Popover } from "./primitives";

function NestedDate({ onChange = vi.fn() }: { onChange?: (value: Date) => void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <Dialog label="安排面试" width={600} onClose={vi.fn()}>
    <button ref={anchorRef} onClick={() => setOpen(true)}>设置计划</button>
    <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="作答计划">
      <DateTimeField label="开始时间" value={new Date(2030, 9, 1, 9, 0)} onChange={onChange} />
    </Popover>
  </Dialog>;
}

describe("嵌套日期浮层", () => {
  it("选择 portal 中的小时和分钟后保留日期与计划，确认才提交", async () => {
    const user = userEvent.setup(); const onChange = vi.fn();
    render(<NestedDate onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "设置计划" }));
    await user.click(screen.getByRole("button", { name: "开始时间" }));
    await user.click(screen.getByRole("button", { name: "小时" }));
    await user.click(screen.getByRole("option", { name: "14" }));
    expect(screen.getByRole("dialog", { name: "开始时间" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "作答计划" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "分钟" }));
    await user.click(screen.getByRole("option", { name: "30" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "开始时间" })).getByRole("button", { name: "确定" }));
    expect(onChange).toHaveBeenCalledWith(new Date(2030, 9, 1, 14, 30));
    expect(screen.queryByRole("dialog", { name: "开始时间" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "作答计划" })).toBeInTheDocument();
  });
  it("Escape 逐层收起，不把父层和主弹窗一并关闭", async () => {
    const user = userEvent.setup(); render(<NestedDate />);
    await user.click(screen.getByRole("button", { name: "设置计划" }));
    await user.click(screen.getByRole("button", { name: "开始时间" }));
    await user.click(screen.getByRole("button", { name: "小时" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "开始时间" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "开始时间" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "作答计划" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "作答计划" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "安排面试" })).toBeInTheDocument();
  });
});
