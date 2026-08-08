import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type AdminResumeTemplate } from "../../api/client";
import { defaultSemanticDocument, defaultSemanticStyle } from "../../api/resumeContract";
import { AdminTemplatePanel } from "./AdminTemplatePanel";

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: () => <div aria-label="管理员只读模板预览" />,
}));

const inactiveTemplate: AdminResumeTemplate = {
  id: "8",
  key: "modern-cn",
  name: "现代双栏",
  description: "虚构模板",
  data: defaultSemanticDocument,
  style: defaultSemanticStyle,
  active: false,
  valid: true,
  validation_error: null,
};

describe("AdminTemplatePanel", () => {
  afterEach(() => vi.restoreAllMocks());

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

    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(screen.getByRole("dialog", { name: "预览 现代双栏" })).toBeInTheDocument();
    expect(screen.getByLabelText("管理员只读模板预览")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));

    fireEvent.click(screen.getByRole("button", { name: "启用" }));
    await waitFor(() => {
      expect(api.updateAdminResumeTemplateStatus).toHaveBeenCalledWith("8", true);
      expect(screen.getByText("已启用")).toBeInTheDocument();
      expect(notify).toHaveBeenCalledWith("模板已启用");
    });
  });
});
