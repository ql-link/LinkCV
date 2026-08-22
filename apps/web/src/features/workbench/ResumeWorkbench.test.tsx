import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import {
  ImportWarningBanner,
  ExportPdfAction,
  FontPreviewSelect,
  normalizeVersionName,
  PageArrangementControl,
  SettingsSlider,
  SaveVersionAction,
  VersionRenameAction,
  versionRenameErrorMessage,
  setRestoredEditorContent,
  setWorkbenchEditorEditable,
  SmartOnePageAction,
  versionNameValidationMessage,
  WorkbenchSaveStatus,
  versionOperationErrorMessage,
} from "./ResumeWorkbench";

describe("ResumeWorkbench 字体选择", () => {
  it("用每个候选字体展示统一样例并允许选择", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const serifFont = '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif';

    render(<FontPreviewSelect value={serifFont} onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: "字体" });
    expect(trigger).toHaveTextContent("简历宋体");
    expect(screen.getByText("张三的简历 Resume")).toHaveStyle({ fontFamily: serifFont });

    await user.click(trigger);
    expect(screen.getByRole("listbox")).toHaveAttribute("data-ui-theme", "light");
    const wenkaiOption = screen.getByRole("option", { name: /霞鹜文楷/ });
    expect(wenkaiOption).toHaveTextContent("张三的简历 Resume");
    expect(wenkaiOption.querySelector(".workbench-font-option-copy > span")).toHaveStyle({
      fontFamily: '"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif',
    });

    await user.click(wenkaiOption);
    expect(onChange).toHaveBeenCalledWith('"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif');
  });

  it("版本操作期间禁用字体选择", () => {
    render(<FontPreviewSelect value="missing-font" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("combobox", { name: "字体" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "字体" })).toHaveTextContent("简历宋体");
  });
});

describe("ResumeWorkbench 页面设置步进按钮", () => {
  it("按滑杆步长增大或减小当前数值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SettingsSlider label="正文字号" unit="pt" value={10.5} min={8} max={16} step={0.5} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "正文字号减小" }));
    await user.click(screen.getByRole("button", { name: "正文字号增大" }));

    expect(onChange).toHaveBeenNthCalledWith(1, 10);
    expect(onChange).toHaveBeenNthCalledWith(2, 11);
  });
});

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

describe("ResumeWorkbench 页面排列", () => {
  it("使用一个按钮切换排列并随当前方向改变图标", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(<PageArrangementControl value="vertical" onChange={onChange} />);

    const verticalButton = screen.getByRole("button", { name: "当前上下排列，切换为左右排列" });
    expect(verticalButton.querySelector('[data-arrangement="vertical"]')).toBeInTheDocument();
    await user.click(verticalButton);
    expect(onChange).toHaveBeenCalledWith("horizontal");

    rerender(<PageArrangementControl value="horizontal" onChange={onChange} />);
    const horizontalButton = screen.getByRole("button", { name: "当前左右排列，切换为上下排列" });
    expect(horizontalButton.querySelector('[data-arrangement="horizontal"]')).toBeInTheDocument();
  });

  it("智能一页开启时禁用排列选择", () => {
    render(<PageArrangementControl value="horizontal" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "当前左右排列，切换为上下排列" })).toBeDisabled();
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

describe("ResumeWorkbench PDF 导出按钮", () => {
  it("点击按钮直接导出文字版 PDF", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ExportPdfAction onExport={onExport} />);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "导出 PDF" }));
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("PDF 生成期间禁用重复下载", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ExportPdfAction onExport={onExport} pending />);

    const pdfAction = screen.getByRole("button", { name: "正在导出 PDF" });
    expect(pdfAction).toBeDisabled();
    await user.click(pdfAction);
    expect(onExport).not.toHaveBeenCalled();
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
    expect(versionOperationErrorMessage(error, "restore")).toBeNull();
  });

  it("其他错误继续使用通用失败提示", () => {
    expect(versionOperationErrorMessage(new Error("HTTP_500"), "create")).toBeNull();
  });
});

describe("ResumeWorkbench 版本侧边栏", () => {
  it("在正式版本名称旁提供行内重命名入口", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();

    render(<VersionRenameAction name="产品经理投递版" versionNo={2} onRename={onRename} />);

    expect(screen.getByText("产品经理投递版")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重命名版本 2" }));
    const input = screen.getByRole("textbox", { name: "版本 2 名称" });
    expect(screen.queryByText("按 Enter 保存，Esc 取消")).not.toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "产品经理终版");
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledWith("产品经理终版");
  });

  it("把重命名冲突转换为可行动提示", () => {
    expect(versionRenameErrorMessage(new ApiRequestError(400, "INVALID_RESUME_VERSION_NAME"))).toBe("版本名称不能为空且不能超过 80 个字符。");
  });

  it("空名称提交时保留输入并提示用户", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();

    render(<VersionRenameAction name="产品经理投递版" versionNo={2} onRename={onRename} />);

    await user.click(screen.getByRole("button", { name: "重命名版本 2" }));
    const input = screen.getByRole("textbox", { name: "版本 2 名称" });
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent("请填写版本名称");
    expect(onRename).not.toHaveBeenCalled();
  });
});

describe("ResumeWorkbench 恢复版本", () => {
  it("刷新编辑器内容时不触发编辑更新", () => {
    const setContent = vi.fn();
    const restoredContent = "<h1>历史版本</h1>";

    setRestoredEditorContent({ commands: { setContent } }, restoredContent);

    expect(setContent).toHaveBeenCalledWith(restoredContent, false);
  });

  it("切换恢复期间的编辑状态时不触发编辑更新", () => {
    const setEditable = vi.fn();

    setWorkbenchEditorEditable({ commands: { setContent: vi.fn() }, setEditable }, false);

    expect(setEditable).toHaveBeenCalledWith(false, false);
  });
});

describe("ResumeWorkbench 正式版本命名", () => {
  it("会整理首尾和连续空白", () => {
    expect(normalizeVersionName("  投递\t产品 经理  ")).toBe("投递 产品 经理");
    expect(versionNameValidationMessage(" \n\t ")).toBe("请填写版本名称");
  });

  it("拒绝超过 80 个字符的名称", () => {
    expect(versionNameValidationMessage("版".repeat(81))).toBe("版本名称不能超过 80 个字符");
  });
});
