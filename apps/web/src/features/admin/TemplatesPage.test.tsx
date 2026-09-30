import { createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type AdminResumeTemplate } from "../../api/client";
import { AdminConsoleProvider } from "./kit";
import { nearestSlot } from "./kit";
import { TemplatesPage, buildClassificationExport, moveTemplate } from "./TemplatesPage";

vi.mock("../preview/ResumePreview", () => ({ ResumePreview: () => <div data-testid="preview" /> }));

function template(id: string, overrides: Partial<AdminResumeTemplate> = {}): AdminResumeTemplate {
  return {
    id,
    key: `tpl-${id}`,
    name: `模板 ${id}`,
    description: null,
    style_categories: [],
    use_cases: [],
    style_review_status: "pending",
    sort_order: Number(id) * 10,
    data: {} as AdminResumeTemplate["data"],
    style: {} as AdminResumeTemplate["style"],
    layout_plan: null,
    active: true,
    valid: true,
    validation_error: null,
    switchable: true,
    incompatibility_reason: null,
    ...overrides,
  };
}

/** jsdom has no DragEvent, so pointer coordinates are attached by hand. */
function dragOverAt(target: Element, clientX: number, clientY: number, dataTransfer: object) {
  const event = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperties(event, { clientX: { value: clientX }, clientY: { value: clientY } });
  fireEvent(target, event);
}

const notify = vi.fn();
const wrap = (node: ReactNode) => <AdminConsoleProvider value={{ notify, onSessionExpired: vi.fn(), navigate: vi.fn() }}>{node}</AdminConsoleProvider>;

afterEach(() => { vi.restoreAllMocks(); notify.mockReset(); });

describe("moveTemplate", () => {
  it("moves an id to the target index", () => {
    expect(moveTemplate(["1", "2", "3", "4"], "4", 1)).toEqual(["1", "4", "2", "3"]);
    expect(moveTemplate(["1", "2", "3"], "1", 2)).toEqual(["2", "3", "1"]);
    expect(moveTemplate(["1", "2"], "9", 0)).toEqual(["1", "2"]);
  });
});

describe("nearestSlot", () => {
  const slots = [{ left: 0, right: 100, top: 0, bottom: 100 }, { left: 120, right: 220, top: 0, bottom: 100 }, { left: 0, right: 100, top: 120, bottom: 220 }] as DOMRect[];
  it("returns the slot under the pointer or the closest one in a gap", () => {
    expect(nearestSlot(slots, 150, 50)).toBe(1);
    expect(nearestSlot(slots, 108, 50)).toBe(0);
    expect(nearestSlot(slots, 40, 180)).toBe(2);
    expect(nearestSlot([], 0, 0)).toBeNull();
  });
});

describe("TemplatesPage", () => {
  it("renders cards in order with status counts", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [template("1"), template("2", { active: false }), template("3", { valid: false, active: false })] });
    render(wrap(<TemplatesPage />));
    const list = await screen.findByRole("list", { name: "模板列表" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("模板 1"), expect.stringContaining("模板 2"), expect.stringContaining("模板 3"),
    ]);
    expect(screen.getByRole("tab", { name: /已停用 1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /结构无效 1/ })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "启用模板 3" })).toBeDisabled();
  });

  it("saves the whole order in one request when a card is dragged", async () => {
    const templates = [template("1"), template("2"), template("3")];
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates });
    const reorder = vi.spyOn(api, "reorderAdminResumeTemplates").mockResolvedValue({ templates: [templates[2], templates[0], templates[1]] });
    render(wrap(<TemplatesPage />));
    const grid = await screen.findByRole("list", { name: "模板列表" });
    const cards = within(grid).getAllByRole("listitem");
    // Three cards in a row, 200px wide with 20px gaps.
    cards.forEach((card, index) => { card.getBoundingClientRect = () => ({ left: index * 220, right: index * 220 + 200, top: 0, bottom: 300 }) as DOMRect; });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(cards[2], { dataTransfer });
    // The placeholder takes the dragged card's slot once the drag image has been captured.
    await waitFor(() => expect(grid.querySelector(".is-placeholder")).not.toBeNull());
    dragOverAt(grid, 10, 100, dataTransfer);
    expect(grid.children[0]).toHaveClass("is-placeholder");
    fireEvent.drop(grid, { dataTransfer });
    await waitFor(() => expect(reorder).toHaveBeenCalledWith(["3", "1", "2"]));
    expect(notify).toHaveBeenCalledWith("展示顺序已保存");
  });

  it("does not save when a card is dropped back on its own slot", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [template("1"), template("2")] });
    const reorder = vi.spyOn(api, "reorderAdminResumeTemplates");
    render(wrap(<TemplatesPage />));
    const grid = await screen.findByRole("list", { name: "模板列表" });
    const cards = within(grid).getAllByRole("listitem");
    cards.forEach((card, index) => { card.getBoundingClientRect = () => ({ left: index * 220, right: index * 220 + 200, top: 0, bottom: 300 }) as DOMRect; });
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(cards[1], { dataTransfer });
    await waitFor(() => expect(grid.querySelector(".is-placeholder")).not.toBeNull());
    dragOverAt(grid, 300, 100, dataTransfer);
    fireEvent.drop(grid, { dataTransfer });
    expect(reorder).not.toHaveBeenCalled();
    expect(grid.querySelector(".is-placeholder")).toBeNull();
  });

  it("moves a card with the keyboard handle", async () => {
    const templates = [template("1"), template("2")];
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates });
    const reorder = vi.spyOn(api, "reorderAdminResumeTemplates").mockResolvedValue({ templates: [templates[1], templates[0]] });
    render(wrap(<TemplatesPage />));
    fireEvent.keyDown(await screen.findByRole("button", { name: /调整模板 1的顺序/ }), { key: "ArrowRight" });
    await waitFor(() => expect(reorder).toHaveBeenCalledWith(["2", "1"]));
  });

  it("reverts and reloads when the order is stale", async () => {
    const templates = [template("1"), template("2")];
    const list = vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates });
    vi.spyOn(api, "reorderAdminResumeTemplates").mockRejectedValue(new ApiRequestError(409, "TEMPLATE_ORDER_STALE"));
    render(wrap(<TemplatesPage />));
    fireEvent.keyDown(await screen.findByRole("button", { name: /调整模板 1的顺序/ }), { key: "ArrowRight" });
    await waitFor(() => expect(notify).toHaveBeenCalledWith("模板列表已被其他管理员修改，已重新加载", "error"));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("disables drag while a filter is active", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [template("1"), template("2", { active: false })] });
    render(wrap(<TemplatesPage />));
    await screen.findByRole("list", { name: "模板列表" });
    fireEvent.click(screen.getByRole("tab", { name: /已启用/ }));
    expect(screen.queryByRole("button", { name: /调整.*顺序/ })).not.toBeInTheDocument();
    expect(screen.getByText(/筛选或搜索时不能拖动排序/)).toBeInTheDocument();
  });

  it("classifies a template from the detail modal and walks to the next one", async () => {
    const templates = [template("1"), template("2")];
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates });
    const classify = vi.spyOn(api, "updateAdminResumeTemplateClassification").mockResolvedValue({
      template: template("1", { style_categories: ["现代"], style_review_status: "classified" }),
    });
    render(wrap(<TemplatesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "查看模板 1详情" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "现代" }));
    await waitFor(() => expect(classify).toHaveBeenCalledWith("1", { style_categories: ["现代"], use_cases: [], style_review_status: "classified" }));
    expect(await within(dialog).findByText("已自动保存")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "现代" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "下一个 →" }));
    expect(within(dialog).getByText(/tpl-2/)).toBeInTheDocument();
  });

  it("deletes a template from the detail modal after confirmation", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [template("1"), template("2")] });
    const remove = vi.spyOn(api, "deleteAdminResumeTemplate").mockResolvedValue(undefined);
    render(wrap(<TemplatesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "查看模板 1详情" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("1"));
    expect(notify).toHaveBeenCalledWith("模板已删除");
    await waitFor(() => expect(screen.queryByRole("button", { name: "查看模板 1详情" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "查看模板 2详情" })).toBeInTheDocument();
  });

  it("explains why a template in use cannot be deleted", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [template("1")] });
    vi.spyOn(api, "deleteAdminResumeTemplate").mockRejectedValue(new ApiRequestError(409, "TEMPLATE_IN_USE"));
    render(wrap(<TemplatesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "查看模板 1详情" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "删除" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除" }));
    expect(await within(dialog).findByText(/已被用户简历或导入任务使用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看模板 1详情", hidden: true })).toBeInTheDocument();
  });

  it("marks a template as unsure, clearing styles", async () => {
    const templates = [template("1", { style_categories: ["简约"], style_review_status: "classified" })];
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates });
    const classify = vi.spyOn(api, "updateAdminResumeTemplateClassification").mockResolvedValue({ template: template("1", { style_review_status: "unsure" }) });
    render(wrap(<TemplatesPage />));
    fireEvent.click(await screen.findByRole("button", { name: "查看模板 1详情" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "待讨论" }));
    await waitFor(() => expect(classify).toHaveBeenCalledWith("1", { style_categories: [], use_cases: [], style_review_status: "unsure" }));
  });

  it("imports a template package from the modal", async () => {
    const list = vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [] });
    const upload = vi.spyOn(api, "importAdminResumeTemplate").mockResolvedValue({ template: template("9", { active: false }) });
    render(wrap(<TemplatesPage />));
    fireEvent.click((await screen.findAllByRole("button", { name: "导入模板" }))[0]);
    const file = new File(["{}"], "template.json", { type: "application/json" });
    fireEvent.change(within(await screen.findByRole("dialog")).getByLabelText("选择 JSON 模板包"), { target: { files: [file] } });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(notify).toHaveBeenCalledWith("模板已导入，默认保持停用");
  });

  it("shows why an import was rejected", async () => {
    vi.spyOn(api, "listAdminResumeTemplates").mockResolvedValue({ templates: [] });
    vi.spyOn(api, "importAdminResumeTemplate").mockRejectedValue(new ApiRequestError(409, "TEMPLATE_KEY_CONFLICT"));
    render(wrap(<TemplatesPage />));
    fireEvent.click((await screen.findAllByRole("button", { name: "导入模板" }))[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("选择 JSON 模板包"), { target: { files: [new File(["{}"], "t.json")] } });
    expect(await within(dialog).findByText(/已有相同 key 的模板/)).toBeInTheDocument();
  });
});

describe("buildClassificationExport", () => {
  it("exports active, valid templates keyed by template key", () => {
    const result = buildClassificationExport([
      template("1", { style_categories: ["现代"], use_cases: ["社招"], style_review_status: "classified" }),
      template("2", { active: false }),
      template("3", { valid: false }),
    ]);
    expect(result.schema_version).toBe("template-classification.v3");
    expect(result.templates).toEqual([{ key: "tpl-1", name: "模板 1", style_categories: ["现代"], use_cases: ["社招"], style_review_status: "classified", use_case_review_status: "classified" }]);
  });
});
