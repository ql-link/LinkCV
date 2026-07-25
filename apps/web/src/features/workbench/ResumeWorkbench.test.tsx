import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SmartOnePageAction } from "./ResumeWorkbench";

describe("ResumeWorkbench 智能一页入口", () => {
  it("显示当前状态并允许切换", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(<SmartOnePageAction active onToggle={onToggle} />);

    const action = screen.getByRole("button", { name: "智能一页" });
    expect(action).toHaveAttribute("aria-pressed", "true");

    await user.click(action);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
