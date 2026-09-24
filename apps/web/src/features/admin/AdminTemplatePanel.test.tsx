import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AdminResumeTemplate } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { AdminTemplatePanel } from "./AdminTemplatePanel";
import { buildClassificationExport } from "./TemplateStyleClassifier";

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: () => <div aria-label="管理员只读模板预览" />,
}));

const inactiveTemplate: AdminResumeTemplate = {
  id: "8",
  key: "modern-cn",
  name: "现代双栏",
  description: "虚构模板",
  style_categories: [],
  use_cases: [],
  style_review_status: "pending",
  sort_order: 1000,
  data: defaultCanonicalDocument,
  style: defaultCanonicalPresentation,
  active: false,
  valid: true,
  validation_error: null,
  switchable: true,
  incompatibility_reason: null,
};

describe("AdminTemplatePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("读取模板时使用统一的面板加载状态", () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockReturnValue(new Promise(() => {}));

    render(<AdminTemplatePanel notify={vi.fn()} />);

    expect(screen.getByRole("status", { name: "正在读取模板…" })).toHaveClass(
      "page-loading",
      "is-panel",
    );
  });

  it("使用统一上传区导入 JSON 模板包", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [] });
    const upload = vi.spyOn(api, "importAdminResumeTemplate").mockResolvedValue({
      template: inactiveTemplate,
    });
    const notify = vi.fn();
    render(<AdminTemplatePanel notify={notify} />);

    await screen.findByText("简历模板");
    expect(screen.getByText("点击上传或拖放文件")).toBeInTheDocument();
    const file = new File(["{}"], "template.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("选择 JSON 模板包"), { target: { files: [file] } });

    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(notify).toHaveBeenCalledWith("模板已导入，默认保持停用");
  });

  it("展示全部模板、提供只读预览并允许管理员启用", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({
      templates: [inactiveTemplate],
    });
    vi.spyOn(api, "updateAdminResumeTemplateStatus").mockResolvedValue({
      template: { ...inactiveTemplate, active: true },
    });
    const notify = vi.fn();
    render(<AdminTemplatePanel notify={notify} />);

    expect(await screen.findByText("现代双栏")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除|覆盖/ })).not.toBeInTheDocument();
    const thumbnail = screen.getByRole("button", { name: "查看现代双栏完整预览" });
    expect(thumbnail).toHaveClass("admin-template-thumbnail");
    expect(thumbnail).toContainElement(screen.getByLabelText("管理员只读模板预览"));

    fireEvent.click(thumbnail);
    expect(screen.getByRole("dialog", { name: "预览 现代双栏" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));

    fireEvent.click(screen.getByRole("button", { name: "启用" }));
    await waitFor(() => {
      expect(api.updateAdminResumeTemplateStatus).toHaveBeenCalledWith("8", true);
      expect(screen.getByText("已启用")).toBeInTheDocument();
      expect(notify).toHaveBeenCalledWith("模板已启用");
    });
  });

  it("结构无效的模板显示预览占位", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({
      templates: [{ ...inactiveTemplate, valid: false, data: null, style: null, layout_plan: null }],
    });
    render(<AdminTemplatePanel notify={vi.fn()} />);

    expect(await screen.findByRole("img", { name: "现代双栏无法预览" })).toHaveTextContent("无法预览");
    expect(screen.queryByRole("button", { name: "查看现代双栏完整预览" })).not.toBeInTheDocument();
  });

  it("保存展示顺序后按服务端排序值重排管理列表", async () => {
    const other = { ...inactiveTemplate, id: "9", key: "classic-cn", name: "经典单栏" };
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [inactiveTemplate, other] });
    const update = vi.spyOn(api, "updateAdminResumeTemplateSortOrder").mockResolvedValue({
      template: { ...other, sort_order: 0 },
    });
    const notify = vi.fn();
    render(<AdminTemplatePanel notify={notify} />);

    const input = await screen.findByRole("spinbutton", { name: "经典单栏的展示顺序" });
    fireEvent.change(input, { target: { value: "0" } });
    const row = input.closest(".admin-template-row");
    expect(row).not.toBeNull();
    fireEvent.click(row!.querySelector(".admin-template-sort button")!);
    await waitFor(() => expect(update).toHaveBeenCalledWith("9", 0));
    await waitFor(() => expect(screen.getAllByRole("article")[0]).toHaveTextContent("经典单栏"));
    expect(notify).toHaveBeenCalledWith("展示顺序已保存");
  });

  it("管理员多选分类后保存到接口，并在重新打开页面后读取服务端进度", async () => {
    let serverTemplate = { ...inactiveTemplate, active: true };
    vi.spyOn(api, "listAdminResumeTemplates").mockImplementation(async () => ({ templates: [serverTemplate] }));
    const update = vi.spyOn(api, "updateAdminResumeTemplateClassification").mockImplementation(async (_id, payload) => {
      serverTemplate = { ...serverTemplate, ...payload };
      return { template: serverTemplate };
    });
    const first = render(<AdminTemplatePanel notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "模板分类" }));
    await screen.findByRole("heading", { name: "逐套查看，标注风格与适用场景" });

    for (const name of ["现代", "简约", "实习", "社招"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true"));
    }
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(4);
    expect(serverTemplate).toMatchObject({
      style_categories: ["简约", "现代"],
      use_cases: ["实习", "社招"],
      style_review_status: "classified",
    });

    first.unmount();
    render(<AdminTemplatePanel notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "模板分类" }));
    expect(await screen.findByRole("button", { name: "现代" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "社招" })).toHaveAttribute("aria-pressed", "true");
  });

  it("导出服务端分类结果以稳定 key 标记状态", () => {
    const templates = [
      { ...inactiveTemplate, style_categories: ["简约", "现代"], use_cases: ["实习", "社招"], style_review_status: "classified" as const },
      { ...inactiveTemplate, id: "9", key: "classic-cn", name: "经典", use_cases: ["校招"], style_review_status: "unsure" as const },
      { ...inactiveTemplate, id: "10", key: "simple-cn", name: "简约" },
    ];

    expect(buildClassificationExport(templates).templates).toEqual([
      { key: "modern-cn", name: "现代双栏", style_categories: ["简约", "现代"], use_cases: ["实习", "社招"], style_review_status: "classified", use_case_review_status: "classified" },
      { key: "classic-cn", name: "经典", style_categories: [], use_cases: ["校招"], style_review_status: "unsure", use_case_review_status: "classified" },
      { key: "simple-cn", name: "简约", style_categories: [], use_cases: [], style_review_status: "pending", use_case_review_status: "pending" },
    ]);
  });

  it("保存失败保留服务端原值并提示重试", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({
      templates: [{ ...inactiveTemplate, active: true }],
    });
    vi.spyOn(api, "updateAdminResumeTemplateClassification").mockRejectedValue(new Error("network"));
    render(<AdminTemplatePanel notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "模板分类" }));

    fireEvent.click(await screen.findByRole("button", { name: "现代" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("分类保存失败");
    expect(screen.getByRole("button", { name: "现代" })).toHaveAttribute("aria-pressed", "false");
  });

  it("分类页读取失败时提供重试", async () => {
    vi.spyOn(api, "listAdminResumeTemplates")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ templates: [{ ...inactiveTemplate, active: true }] });
    render(<AdminTemplatePanel notify={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "模板分类" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("模板读取失败");
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("heading", { name: "逐套查看，标注风格与适用场景" })).toBeInTheDocument();
  });
});
