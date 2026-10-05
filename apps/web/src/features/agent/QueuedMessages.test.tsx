import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageQueue } from "./QueuedMessages";
import { emptyQueue, type QueueItem } from "./messageQueue";

type Controller = ComponentProps<typeof MessageQueue>["controller"];
const queued = (itemId: string, content: string): QueueItem => ({ itemId, version: 1, request: { content, contexts: [] }, mode: "follow_up", state: "queued" });
const controller = (items: QueueItem[]): Controller => ({
  queue: { ...emptyQueue(), items }, error: null, editingId: null,
  resume: vi.fn(), pause: vi.fn(), move: vi.fn(), remove: vi.fn(), steer: vi.fn(),
  unblock: vi.fn().mockResolvedValue(undefined), recover: vi.fn(), retryOriginal: vi.fn(),
});

describe("排队消息操作区", () => {
  it("普通消息保留编辑与插入入口，不重复状态或渲染零引用数量", async () => {
    const user = userEvent.setup();
    const first = queued("first", "第一条消息");
    const controls = controller([first]);
    const onEdit = vi.fn();
    render(<MessageQueue controller={controls} running onEdit={onEdit} />);
    const region = screen.getByRole("region", { name: "待发送消息" });
    expect(region).toHaveTextContent("1 条排队消息");
    expect(region).not.toHaveTextContent("排队中");
    expect(within(region).getByRole("listitem")).toHaveTextContent(/^第一条消息插入$/);
    await user.click(screen.getByRole("button", { name: "编辑排队消息 1" }));
    expect(onEdit).toHaveBeenCalledWith(first);
    await user.click(screen.getByRole("button", { name: "插入" }));
    expect(controls.steer).toHaveBeenCalledWith("first");
  });

  it("更多菜单按相邻消息状态限制排序，并能移动和删除对应消息", async () => {
    const user = userEvent.setup();
    const controls = controller([queued("first", "第一条"), queued("second", "第二条")]);
    render(<MessageQueue controller={controls} running={false} onEdit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "排队消息 1 的更多操作" }));
    expect(screen.getByRole("menu")).toHaveAttribute("data-ui-theme", "light");
    expect(screen.getByRole("menuitem", { name: "上移" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "下移" }));
    expect(controls.move).toHaveBeenCalledWith("first", 1);
    await user.click(screen.getByRole("button", { name: "排队消息 2 的更多操作" }));
    expect(screen.getByRole("menuitem", { name: "下移" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "删除消息" }));
    expect(controls.remove).toHaveBeenCalledWith("second");
  });

  it("键盘能打开更多菜单，已提交的相邻消息不能被跨越", async () => {
    const user = userEvent.setup();
    const controls = controller([
      { ...queued("frozen", "正在提交的消息"), state: "submitting", submissionKey: "original-key" },
      queued("second", "第二条"),
    ]);
    render(<MessageQueue controller={controls} running onEdit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "编辑排队消息 1" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "排队消息 2 的更多操作" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "上移" })).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("暂停原因和异常保持可见，未确认提交仅显示核实与原提交重试", async () => {
    const user = userEvent.setup();
    const controls = controller([{ ...queued("uncertain", "结果未知的消息"), state: "uncertain", submissionKey: "original-key" }]);
    controls.queue.paused = true;
    controls.queue.pauseReason = "网络中断，消息已保留";
    controls.error = "请先核实发送结果";
    render(<MessageQueue controller={controls} running={false} onEdit={vi.fn()} />);
    expect(screen.getByText("网络中断，消息已保留")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("请先核实发送结果");
    expect(screen.queryByRole("button", { name: "编辑排队消息 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "核实状态" }));
    expect(controls.recover).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "重试原提交" }));
    expect(controls.retryOriginal).toHaveBeenCalledWith("uncertain");
  });
});
