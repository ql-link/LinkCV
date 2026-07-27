import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import { SmartOnePageAction, versionOperationErrorMessage } from "./ResumeWorkbench";

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

describe("ResumeWorkbench 版本上限提示", () => {
  it("创建版本达到上限时提示用户手动删除", () => {
    const error = new ApiRequestError(409, "RESUME_VERSION_LIMIT_REACHED");

    expect(versionOperationErrorMessage(error, "create")).toContain("请删除一个旧版本");
    expect(versionOperationErrorMessage(error, "restore")).toContain("恢复操作没有执行");
  });

  it("其他错误继续使用通用失败提示", () => {
    expect(versionOperationErrorMessage(new Error("HTTP_500"), "create")).toBeNull();
  });
});
