import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import {
  ImportWarningBanner,
  SaveVersionAction,
  SmartOnePageAction,
  WorkbenchSaveStatus,
  versionOperationErrorMessage,
} from "./ResumeWorkbench";

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

describe("ResumeWorkbench 顶部保存反馈", () => {
  it("区分编辑中、保存中和已保存状态", () => {
    const { rerender } = render(<WorkbenchSaveStatus dirty saveStatus="idle" />);
    expect(screen.getByRole("status")).toHaveTextContent("编辑中");

    rerender(<WorkbenchSaveStatus dirty saveStatus="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("保存中…");

    rerender(<WorkbenchSaveStatus dirty={false} saveStatus="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("已保存");
  });

  it("保存版本期间禁用重复操作并保留明确文案", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(<SaveVersionAction pending={false} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "保存版本" }));
    expect(onSave).toHaveBeenCalledOnce();

    rerender(<SaveVersionAction pending onSave={onSave} />);
    expect(screen.getByRole("button", { name: "正在保存版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在保存版本" })).toHaveTextContent("保存中…");
  });
});

describe("ResumeWorkbench 导入质量提示", () => {
  it("展示 OCR 等质量提示并允许关闭", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <ImportWarningBanner
        warnings={["pdf_ocr_applied", "source_quote_not_found"]}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("请检查导入结果")).toBeInTheDocument();
    expect(screen.getByText(/PDF 已使用 OCR/)).toBeInTheDocument();
    expect(screen.getByText(/部分结构化内容无法定位到原文短句/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭导入质量提示" }));
    expect(onDismiss).toHaveBeenCalledOnce();
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
