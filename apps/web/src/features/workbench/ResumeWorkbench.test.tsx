import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type ResumeTemplate } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import {
  ImportWarningBanner,
  AgentFloatingEntry,
  clampAgentDrawerWidth,
  clampAgentFloatingPosition,
  defaultWorkbenchDrawerMode,
  ExportPdfAction,
  FontPreviewSelect,
  normalizeVersionName,
  PageArrangementControl,
  SettingsStepper,
  SaveResumeAction,
  SaveVersionAction,
  ResumeTemplateSwitcher,
  semanticSectionDisplayTitle,
  VersionRenameAction,
  WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM,
  versionRenameErrorMessage,
  setRestoredEditorContent,
  setWorkbenchEditorEditable,
  versionNameValidationMessage,
  truncateWorkbenchTitle,
  ZoomFeedback,
  WorkbenchSaveStatus,
  WorkbenchDesignAction,
  WorkbenchPanelSwitcher,
  WorkbenchTitleInput,
  workbenchCanvasClassName,
  versionOperationErrorMessage,
  resumeWorkbenchStyle,
} from "./ResumeWorkbench";
import { resumePdfExportErrorMessage } from "../preview/pdfExport";

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

  it("在章节类型面板隐藏内部图标标记", () => {
    expect(semanticSectionDisplayTitle(":icon[GraduationCap]: 教育经历")).toBe("教育经历");
    expect(semanticSectionDisplayTitle(":icon[Star]: 自我评价")).toBe("自我评价");
    expect(semanticSectionDisplayTitle(":icon[Star]:")).toBe("未命名章节");
  });

  it("只在标题超过 30 个字符时省略", () => {
    const thirtyCharacters = "简".repeat(30);
    const thirtyOneCharacters = `${thirtyCharacters}历`;

    expect(truncateWorkbenchTitle(thirtyCharacters)).toBe(thirtyCharacters);
    expect(truncateWorkbenchTitle(thirtyOneCharacters)).toBe(`${thirtyCharacters}…`);
    expect(truncateWorkbenchTitle("😀".repeat(31))).toBe(`${"😀".repeat(30)}…`);
  });

  it("聚焦编辑时恢复完整标题，失焦后重新省略", async () => {
    const user = userEvent.setup();
    const fullTitle = `${"开发演示简历".repeat(5)}完整标题`;
    const onChange = vi.fn();
    render(<WorkbenchTitleInput value={fullTitle} disabled={false} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "简历标题" });
    expect(input).toHaveValue(truncateWorkbenchTitle(fullTitle));
    expect(input).toHaveAttribute("title", fullTitle);

    await user.click(input);
    expect(input).toHaveValue(fullTitle);
    expect(input).not.toHaveAttribute("title");

    await user.tab();
    expect(input).toHaveValue(truncateWorkbenchTitle(fullTitle));
  });
});

describe("ResumeWorkbench AI 悬浮入口", () => {
  it("用同一个低打扰入口打开和收起智能助手", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<AgentFloatingEntry open={false} onToggle={onToggle} />);

    const openButton = screen.getByRole("button", { name: "打开智能助手" });
    expect(openButton).toHaveTextContent("AI 助手");
    await user.click(openButton);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<AgentFloatingEntry open onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "收起智能助手" })).toHaveTextContent("AI 助手");
  });

  it("允许拖动到工作台内的新位置且松手时不会误打开助手", () => {
    const onToggle = vi.fn();
    render(<AgentFloatingEntry open={false} onToggle={onToggle} />);

    const entry = screen.getByRole("button", { name: "打开智能助手" });
    const canvas = entry.parentElement as HTMLElement;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 400 },
    });
    Object.defineProperties(entry, {
      offsetWidth: { configurable: true, value: 120 },
      offsetHeight: { configurable: true, value: 56 },
    });
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400, x: 0, y: 0, toJSON: () => ({}),
    });
    vi.spyOn(entry, "getBoundingClientRect").mockReturnValue({
      left: 360, top: 320, right: 480, bottom: 376, width: 120, height: 56, x: 360, y: 320, toJSON: () => ({}),
    });

    const dispatchPointer = (type: string, values: Record<string, number | boolean>) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, { configurable: true, value }]),
      ));
      fireEvent(entry, event);
    };
    dispatchPointer("pointerdown", { button: 0, isPrimary: true, pointerId: 1, clientX: 400, clientY: 340 });
    dispatchPointer("pointermove", { pointerId: 1, clientX: 100, clientY: 90 });
    dispatchPointer("pointerup", { pointerId: 1, clientX: 100, clientY: 90 });
    fireEvent.click(entry);

    expect(entry).toHaveClass("has-custom-position");
    expect(entry).toHaveStyle({ left: "60px", top: "70px" });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("将拖动位置限制在工作台可视边界内", () => {
    expect(clampAgentFloatingPosition(
      { left: -100, top: 900 },
      { width: 500, height: 400, entryWidth: 120, entryHeight: 56 },
    )).toEqual({ left: 8, top: 336 });
  });
});

describe("ResumeWorkbench 抽屉布局", () => {
  it("为普通抽屉和更宽的智能助手抽屉提供对应画布状态", () => {
    expect(workbenchCanvasClassName(null)).toBe("workbench-canvas");
    expect(workbenchCanvasClassName("settings")).toBe("workbench-canvas has-drawer");
    expect(workbenchCanvasClassName("history")).toBe("workbench-canvas has-drawer");
    expect(workbenchCanvasClassName("agent")).toBe("workbench-canvas has-drawer has-agent-drawer");
  });

  it("把智能助手宽度限制在桌面范围和当前视口内", () => {
    expect(clampAgentDrawerWidth(200, 1440)).toBe(320);
    expect(clampAgentDrawerWidth(900, 1440)).toBe(640);
    expect(clampAgentDrawerWidth(600, 500)).toBe(476);
    expect(clampAgentDrawerWidth(390, 300)).toBe(320);
  });

  it("桌面默认展开设置，小屏默认保留完整编辑画布", () => {
    expect(defaultWorkbenchDrawerMode(1440)).toBe("settings");
    expect(defaultWorkbenchDrawerMode(1024)).toBe("settings");
    expect(defaultWorkbenchDrawerMode(980)).toBeNull();
    expect(defaultWorkbenchDrawerMode(390)).toBeNull();
  });
});

describe("ResumeWorkbench 编辑面板入口", () => {
  it("从顶部设计按钮打开或收起编辑面板", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<WorkbenchDesignAction panelOpen={false} onToggle={onToggle} />);

    const design = screen.getByRole("button", { name: "设计" });
    expect(design).toHaveAttribute("aria-expanded", "false");
    await user.click(design);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<WorkbenchDesignAction panelOpen onToggle={onToggle} />);
    expect(screen.getByRole("button", { name: "设计" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "设计" })).toHaveClass("is-active");
  });

  it("在右侧面板内切换页面设置和版本记录", async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    const onHistory = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkbenchPanelSwitcher
        activePanel="settings"
        onSettings={onSettings}
        onHistory={onHistory}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("tab", { name: "页面设置" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "版本记录" })).toHaveAttribute("aria-selected", "false");
    await user.click(screen.getByRole("tab", { name: "页面设置" }));
    await user.click(screen.getByRole("tab", { name: "版本记录" }));
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "页面设置" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "关闭编辑面板" }));
    expect(onSettings).toHaveBeenCalledTimes(2);
    expect(onHistory).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ResumeWorkbench 简历模板", () => {
  it("展示现有模板并在切换时保留当前模板状态", async () => {
    const user = userEvent.setup();
    const templates: ResumeTemplate[] = [
      {
        id: "1",
        key: "classic-cn",
        name: "经典模板",
        description: "清晰稳妥的单栏结构",
        data: defaultCanonicalDocument,
        style: defaultCanonicalPresentation,
        switchable: true,
        incompatibility_reason: null,
      },
      {
        id: "2",
        key: "creative-orange-cn",
        name: "创意橙色",
        description: "强调视觉层级的创意版式",
        data: defaultCanonicalDocument,
        style: {
          ...defaultCanonicalPresentation,
          template_snapshot: {
            ...defaultCanonicalPresentation.template_snapshot,
            template_key: "creative-orange-cn",
          },
        },
        switchable: true,
        incompatibility_reason: null,
      },
    ];
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates });
    const onApply = vi.fn();

    render(
      <ResumeTemplateSwitcher
        currentTemplateKey="classic-cn"
        onApply={onApply}
      />,
    );

    await user.click(screen.getByRole("button", { name: "简历模板" }));
    const previewDialog = await screen.findByRole("dialog", { name: "经典模板" });
    expect(previewDialog).toHaveClass("template-preview-dialog");
    expect(screen.getByRole("button", { name: "当前模板" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "下一个模板：创意橙色" }));
    expect(await screen.findByRole("dialog", { name: "创意橙色" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用模板" }));
    expect(onApply).toHaveBeenCalledWith(templates[1]);
    expect(screen.queryByRole("dialog", { name: "创意橙色" })).not.toBeInTheDocument();
  });

  it("模板加载失败时保留弹窗并允许重新加载", async () => {
    const user = userEvent.setup();
    const listTemplates = vi
      .spyOn(api, "listResumeTemplates")
      .mockRejectedValueOnce(new Error("HTTP_503"))
      .mockResolvedValueOnce({
        templates: [{
          id: "1",
          key: "classic-cn",
          name: "经典模板",
          description: null,
          data: defaultCanonicalDocument,
          style: defaultCanonicalPresentation,
          switchable: true,
          incompatibility_reason: null,
        }],
      });

    render(
      <ResumeTemplateSwitcher
        currentTemplateKey="creative-orange-cn"
        onApply={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "简历模板" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("模板暂时无法加载");
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("dialog", { name: "经典模板" })).toHaveClass("template-preview-dialog");
    expect(screen.getByRole("button", { name: "应用模板" })).toBeEnabled();
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });
});

describe("ResumeWorkbench 字体选择", () => {
  it("只显示候选字体名称并允许选择", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const serifFont = '"Source Han Serif SC", "Songti SC", STSong, SimSun, serif';

    render(<FontPreviewSelect value={serifFont} onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: "字体" });
    expect(trigger).toHaveTextContent("简历宋体");
    expect(trigger).not.toHaveTextContent("张三的简历 Resume");

    await user.click(trigger);
    expect(screen.getByRole("listbox")).toHaveAttribute("data-ui-theme", "light");
    const wenkaiOption = screen.getByRole("option", { name: /霞鹜文楷/ });
    expect(wenkaiOption).toHaveTextContent("霞鹜文楷");
    expect(wenkaiOption).not.toHaveTextContent("张三的简历 Resume");
    expect(wenkaiOption.querySelector(".workbench-font-option-copy")).toHaveStyle({
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
  it("按指定步长增大或减小当前数值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SettingsStepper label="正文字号" unit="pt" value={10.5} min={8} max={16} step={0.5} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "正文字号减小" }));
    await user.click(screen.getByRole("button", { name: "正文字号增大" }));

    expect(onChange).toHaveBeenNthCalledWith(1, 10);
    expect(onChange).toHaveBeenNthCalledWith(2, 11);
  });

  it("允许上下页边距减小到 6 毫米", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <SettingsStepper
        label="上下边距"
        unit="mm"
        value={8}
        min={WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM}
        max={30}
        step={2}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "上下边距减小" }));
    expect(onChange).toHaveBeenCalledWith(6);

    rerender(
      <SettingsStepper
        label="上下边距"
        unit="mm"
        value={6}
        min={WORKBENCH_VERTICAL_PAGE_MARGIN_MIN_MM}
        max={30}
        step={2}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("button", { name: "上下边距减小" })).toBeDisabled();
  });
});

describe("ResumeWorkbench 页面排列", () => {
  it("在页面设置中明确选择上下、左右或智能一页", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onSmartOnePageChange = vi.fn();

    const { rerender } = render(<PageArrangementControl value="vertical" onChange={onChange} onSmartOnePageChange={onSmartOnePageChange} />);

    const verticalButton = screen.getByRole("button", { name: "上下排列" });
    const horizontalButton = screen.getByRole("button", { name: "左右排列" });
    expect(verticalButton).toHaveAttribute("aria-pressed", "true");
    expect(verticalButton.querySelector('[data-arrangement="vertical"]')).toBeInTheDocument();
    await user.click(horizontalButton);
    expect(onChange).toHaveBeenCalledWith("horizontal");
    await user.click(screen.getByRole("button", { name: "智能一页" }));
    expect(onSmartOnePageChange).toHaveBeenCalledWith(true);

    onChange.mockClear();
    onSmartOnePageChange.mockClear();
    rerender(<PageArrangementControl value="horizontal" onChange={onChange} smartOnePage onSmartOnePageChange={onSmartOnePageChange} />);
    expect(screen.getByRole("button", { name: "左右排列" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "智能一页" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "上下排列" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "左右排列" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "上下排列" }));
    expect(onSmartOnePageChange).toHaveBeenCalledWith(false);
    expect(onChange).toHaveBeenCalledWith("vertical");
  });

  it("版本操作期间禁用全部页面布局选择", () => {
    render(<PageArrangementControl value="horizontal" onChange={vi.fn()} onSmartOnePageChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "上下排列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "左右排列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "智能一页" })).toBeDisabled();
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
  });

  it("顶部保存简历按钮触发主记录保存并在保存期间禁用重复操作", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(<SaveResumeAction pending={false} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "保存简历" }));
    expect(onSave).toHaveBeenCalledOnce();

    rerender(<SaveResumeAction pending onSave={onSave} />);
    expect(screen.getByRole("button", { name: "正在保存简历" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在保存简历" })).toHaveTextContent("保存中…");
  });

  it("页面设置中的保存版本入口保留命名版本操作", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(<SaveVersionAction pending={false} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "保存版本" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByText(/可命名、可恢复/)).toBeInTheDocument();

    rerender(<SaveVersionAction pending onSave={onSave} />);
    expect(screen.getByRole("button", { name: "正在保存版本" })).toBeDisabled();
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
