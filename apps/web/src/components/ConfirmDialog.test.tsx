import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui";

describe("ConfirmDialog", () => {
  it("使用站内弹窗确认删除，不调用浏览器原生确认", async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(window, "confirm");
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        kind="delete"
        title="删除版本 v1？"
        description="删除后无法恢复。"
        confirmLabel="永久删除"
        busyLabel="正在删除…"
        busy={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "永久删除" }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
