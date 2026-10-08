import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import { defaultCanonicalPresentation } from "../../api/resumeContract";
import {
  ResumeWorkbench,
  ImportWarningBanner,
  FontPreviewSelect,
  normalizeVersionName,
  SettingsSlider,
  steppedSettingValue,
  VersionRenameAction,
  WorkbenchPageBar,
  WorkbenchScorePill,
  WorkbenchToolRail,
  WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM,
  versionRenameErrorMessage,
  setRestoredEditorContent,
  setWorkbenchEditorEditable,
  versionNameValidationMessage,
  truncateWorkbenchTitle,
  ZoomFeedback,
  WorkbenchSaveStatus,
  WorkbenchTitleInput,
  workbenchCanvasClassName,
  versionOperationErrorMessage,
  resumeWorkbenchStyle,
} from "./ResumeWorkbench";
import { resumePdfExportErrorMessage } from "../preview/pdfExport";
import { evaluateResumeCompleteness } from "./resumeCompleteness";

describe("ResumeWorkbench 顶部工具栏显示范围", () => {
  it("AI 助手内嵌模式不显示 V3 外框和顶部工具栏", () => {
    render(<ResumeWorkbench embedded />);
    expect(screen.queryByRole("button", { name: "返回全部简历" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "简历模板" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出 PDF" })).not.toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("独立简历编辑页将页面设置收进右侧排版面板", async () => {
    render(<ResumeWorkbench />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回全部简历" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 PDF" })).toHaveClass("v3-btn-dark");
    expect(document.querySelectorAll(".v3-btn-dark")).toHaveLength(1);
    const rail = screen.getByRole("navigation", { name: "编辑工具" });
    expect(within(rail).getAllByRole("button").map((button) => button.querySelector("span")?.textContent)).toEqual(["大纲", "模板", "排版", "检查"]);
    expect(screen.queryByRole("button", { name: /智能助手/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("toolbar", { name: "页面设置" })).not.toBeInTheDocument();
    await userEvent.click(within(rail).getByRole("button", { name: "排版" }));
    const panel = await screen.findByRole("region", { name: "设置" });
    expect(within(panel).getByRole("toolbar", { name: "页面设置" })).toBeInTheDocument();
    expect(within(panel).queryByText("模块顺序")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "增大正文字号" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "减小上下边距" })).toBeInTheDocument();
  });
});

describe("ResumeWorkbench 标题", () => {
  it("把持久化强调色注入可编辑简历根节点", () => {
    const style = resumeWorkbenchStyle({
      fontFamily: "sans-serif",
      fontSize: 9.5,
      lineHeight: 1.25,
      pageMargin: 11,
      verticalPageMargin: 9,
    }, "#202632");

    expect(style).toMatchObject({
      "--preview-accent": "#202632",
      "--resume-font-size": "9.5pt",
      "--resume-line-height": 1.25,
    });
  });

  it("页面边距本地修改后立即覆盖尚未保存的规范样式", () => {
    const persistedStyle = {
      ...defaultCanonicalPresentation,
      template_scoped: {
        "classic-cn": {
          page_margin_top_mm: 8,
          page_margin_right_mm: 14,
          page_margin_bottom_mm: 10,
          page_margin_left_mm: 12,
        },
      },
    };

    const unchanged = resumeWorkbenchStyle({
      fontFamily: "serif",
      fontSize: 10,
      lineHeight: 1.3,
      pageMargin: 12,
      verticalPageMargin: 8,
    }, "#202632", persistedStyle);
    expect(unchanged).toMatchObject({
      "--resume-page-margin-top": "8mm",
      "--resume-page-margin-right": "14mm",
      "--resume-page-margin-bottom": "10mm",
      "--resume-page-margin-left": "12mm",
    });

    const horizontalChanged = resumeWorkbenchStyle({
      fontFamily: "serif",
      fontSize: 10,
      lineHeight: 1.3,
      pageMargin: 16,
      verticalPageMargin: 8,
    }, "#202632", persistedStyle);
    expect(horizontalChanged).toMatchObject({
      "--resume-page-margin-top": "8mm",
      "--resume-page-margin-right": "16mm",
      "--resume-page-margin-bottom": "10mm",
      "--resume-page-margin-left": "16mm",
    });

    const verticalChanged = resumeWorkbenchStyle({
      fontFamily: "serif",
      fontSize: 10,
      lineHeight: 1.3,
      pageMargin: 12,
      verticalPageMargin: 12,
    }, "#202632", persistedStyle);
    expect(verticalChanged).toMatchObject({
      "--resume-page-margin-top": "12mm",
      "--resume-page-margin-right": "14mm",
      "--resume-page-margin-bottom": "12mm",
      "--resume-page-margin-left": "12mm",
    });
  });

  it("只在标题超过 30 个字符时省略", () => {
    const thirtyCharacters = "简".repeat(30);
    const thirtyOneCharacters = `${thirtyCharacters}历`;

    expect(truncateWorkbenchTitle(thirtyCharacters)).toBe(thirtyCharacters);
    expect(truncateWorkbenchTitle(thirtyOneCharacters)).toBe(`${thirtyCharacters}…`);
    expect(truncateWorkbenchTitle("😀".repeat(31))).toBe(`${"😀".repeat(30)}…`);
  });

  it("始终保留完整受控值，并允许连续修改长标题", async () => {
    const user = userEvent.setup();
    const fullTitle = `${"开发演示简历".repeat(5)}完整标题`;
    function ControlledTitle() {
      const [value, setValue] = useState(fullTitle);
      return <WorkbenchTitleInput value={value} disabled={false} onChange={setValue} />;
    }
    render(<ControlledTitle />);

    const input = screen.getByRole("textbox", { name: "简历标题" });
    expect(input).toHaveValue(fullTitle);
    expect(input).toHaveAttribute("title", fullTitle);

    await user.click(input);
    await user.keyboard("{Control>}a{/Control}前端开发投递版");
    expect(input).toHaveValue("前端开发投递版");
    expect(input).not.toHaveAttribute("title");
  });
});

describe("ResumeWorkbench 面板布局", () => {
  it("面板打开时画布进入让位状态", () => {
    expect(workbenchCanvasClassName(null)).toBe("workbench-canvas");
    expect(workbenchCanvasClassName("outline")).toBe("workbench-canvas has-drawer");
    expect(workbenchCanvasClassName("quality")).toBe("workbench-canvas has-drawer");
  });
});

describe("ResumeWorkbench 右侧工具卡片", () => {
  it("点击工具项切换对应面板，并标出当前打开的一项", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<WorkbenchToolRail mode={null} pendingChecks={3} onToggle={onToggle} />);

    await user.click(screen.getByRole("button", { name: "大纲" }));
    await user.click(screen.getByRole("button", { name: "简历模板" }));
    await user.click(screen.getByRole("button", { name: "排版" }));
    await user.click(screen.getByRole("button", { name: "简历检查" }));
    expect(onToggle.mock.calls.map(([mode]) => mode)).toEqual(["outline", "template", "type", "quality"]);
    expect(screen.getByRole("button", { name: "简历检查" })).toHaveTextContent("3");

    rerender(<WorkbenchToolRail mode="template" pendingChecks={0} onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "简历模板" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "简历模板" })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "简历检查" })).toHaveTextContent(/^检查$/);
  });

  it("保存或版本操作期间禁用模板入口", () => {
    render(<WorkbenchToolRail mode={null} pendingChecks={0} templateDisabled onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "简历模板" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "大纲" })).toBeEnabled();
  });

  it("顶栏完整度胶囊显示分数与等级并打开简历检查", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const result = evaluateResumeCompleteness("");
    render(<WorkbenchScorePill result={result} active={false} onClick={onClick} />);
    const pill = screen.getByRole("button", { name: new RegExp(`简历完整度 ${result.score} 分`) });
    expect(pill).toHaveTextContent(`${result.score}${result.level}`);
    await user.click(pill);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("ResumeWorkbench 字体选择", () => {
  it("只显示候选字体名称并允许选择", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const serifFont = '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif';

    render(<FontPreviewSelect value={serifFont} onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "字体" });
    expect(trigger).toHaveTextContent("思源宋体");

    await user.click(trigger);
    const wenkaiOption = screen.getByRole("option", { name: /霞鹜文楷/ });
    await user.click(wenkaiOption);
    expect(onChange).toHaveBeenCalledWith('"LXGW WenKai", KaiTi, STKaiti, "Songti SC", serif');
  });

  it("版本操作期间禁用字体选择", () => {
    render(<FontPreviewSelect value="missing-font" onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "字体" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "字体" })).toHaveTextContent("思源宋体");
  });
});

describe("ResumeWorkbench 排版滑杆", () => {
  it("按指定步长增大或减小当前数值", () => {
    expect(steppedSettingValue(10.5, -1, 8, 16, 0.5)).toBe(10);
    expect(steppedSettingValue(10.5, 1, 8, 16, 0.5)).toBe(11);
    expect(steppedSettingValue(1.3500000000000001, -1, 1.1, 1.8, 0.05)).toBe(1.3);
  });

  it("拖动滑杆时吸附到步长，数值不显示浮点尾数", () => {
    const onChange = vi.fn();
    render(<>
      <SettingsSlider label="正文字号" unit="pt" value={10.500000000000002} min={8} max={16} step={0.5} digits={1} onChange={onChange} />
      <SettingsSlider label="正文行距" unit="" value={1.3500000000000001} min={1.1} max={1.8} step={0.05} digits={2} onChange={onChange} />
    </>);
    expect(screen.getByLabelText("正文字号当前值")).toHaveTextContent(/^10\.5 pt$/);
    expect(screen.getByLabelText("正文行距当前值")).toHaveTextContent(/^1\.35$/);
    fireEvent.change(screen.getByRole("slider", { name: "正文字号" }), { target: { value: "11.2" } });
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent.change(screen.getByRole("slider", { name: "正文行距" }), { target: { value: "1.3" } });
    expect(onChange).toHaveBeenLastCalledWith(1.3);
  });

  it("允许上下页边距减小到 6 毫米", () => {
    const onChange = vi.fn();
    render(
      <SettingsSlider label="上下边距" unit="mm" value={8} min={WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM} max={30} step={2} onChange={onChange} />,
    );
    const slider = screen.getByRole("slider", { name: "上下边距" });
    expect(slider).toHaveAttribute("min", "6");
    fireEvent.change(slider, { target: { value: "6" } });
    expect(onChange).toHaveBeenCalledWith(6);
  });
});

describe("ResumeWorkbench 页面栏", () => {
  const renderBar = (overrides: Partial<ComponentProps<typeof WorkbenchPageBar>> = {}) => {
    const handlers = {
      onArrangementChange: vi.fn(),
      onSmartOnePageChange: vi.fn(),
    };
    const view = render(
      <WorkbenchPageBar arrangement="vertical" smartOnePage={false} {...handlers} {...overrides} />,
    );
    return { ...handlers, ...view };
  };

  it("在页面栏选择上下、左右或智能一页", async () => {
    const user = userEvent.setup();
    const { onArrangementChange, onSmartOnePageChange, rerender } = renderBar();

    expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上下排列" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "左右排列" }));
    expect(onArrangementChange).toHaveBeenCalledWith("horizontal");
    await user.click(screen.getByRole("switch", { name: "智能一页" }));
    expect(onSmartOnePageChange).toHaveBeenCalledWith(true);

    onArrangementChange.mockClear();
    onSmartOnePageChange.mockClear();
    rerender(
      <WorkbenchPageBar arrangement="horizontal" smartOnePage onArrangementChange={onArrangementChange} onSmartOnePageChange={onSmartOnePageChange} />,
    );
    expect(screen.queryByText("共 1 页")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "左右排列" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("switch", { name: "智能一页" })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "上下排列" }));
    expect(onSmartOnePageChange).toHaveBeenCalledWith(false);
    expect(onArrangementChange).toHaveBeenCalledWith("vertical");
  });

  it("不显示页数或缩放控件", () => {
    renderBar();
    expect(screen.queryByText(/第 \d+ \/ \d+ 页/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "缩小" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放大" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("当前缩放")).not.toBeInTheDocument();
  });

  it("版本操作期间禁用全部页面布局选择", () => {
    renderBar({ disabled: true });
    expect(screen.getByRole("button", { name: "上下排列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "左右排列" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "智能一页" })).toBeDisabled();
  });
});

describe("ResumeWorkbench 预览缩放", () => {
  it("缩放发生时在屏幕中央展示当前比例", () => {
    render(<ZoomFeedback scale={0.88} />);
    expect(screen.getByRole("status")).toHaveTextContent("88%");
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

    rerender(
      <WorkbenchSaveStatus
        dirty
        saveStatus="error"
        error="RESUME_PDF_ASSETS_TOO_LARGE"
      />,
    );
    expect(screen.getByRole("status"))
      .toHaveTextContent("保存失败 · 简历中引用的图片总大小不能超过 10MB");
  });

  it("编辑冲突时提示简历已在其他地方修改", () => {
    render(<WorkbenchSaveStatus dirty saveStatus="error" error="RESUME_EDIT_CONFLICT" />);
    expect(screen.getByRole("status")).toHaveTextContent("保存失败 · 简历已在其他地方修改");
  });
});

describe("ResumeWorkbench PDF 导出错误", () => {
  it("把服务端快照过期错误显示为可重试提示", () => {
    expect(resumePdfExportErrorMessage(new ApiRequestError(409, "RESUME_PDF_SNAPSHOT_STALE")))
      .toBe("简历内容已变化，请重新导出");
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

  it("恢复版本时展示图片契约错误", () => {
    const error = new ApiRequestError(413, "RESUME_PDF_ASSETS_TOO_LARGE");

    expect(versionOperationErrorMessage(error, "restore"))
      .toBe("简历中引用的图片总大小不能超过 10MB");
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
