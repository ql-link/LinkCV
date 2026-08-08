import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ResumeTemplate } from "../../api/client";
import { defaultSemanticDocument, defaultSemanticStyle } from "../../api/resumeContract";
import { TemplatePicker } from "./TemplatePicker";

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: ({ mode = "card" }: { mode?: string }) => (
    <div aria-label={`只读预览-${mode}`} />
  ),
}));

const template: ResumeTemplate = {
  id: "8",
  key: "modern-cn",
  name: "现代双栏",
  description: "虚构模板",
  data: defaultSemanticDocument,
  style: { ...defaultSemanticStyle, template_key: "modern-cn" },
};

describe("TemplatePicker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("加载真实模板、选择模板并打开只读完整预览", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [template] });
    const onSelect = vi.fn();
    render(<TemplatePicker selectedTemplateId={null} onSelect={onSelect} />);

    expect(await screen.findByText("现代双栏")).toBeInTheDocument();
    expect(screen.getByLabelText("只读预览-card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /现代双栏/ }));
    expect(onSelect).toHaveBeenCalledWith(template);

    fireEvent.click(screen.getByRole("button", { name: "完整预览" }));
    expect(screen.getByRole("dialog", { name: "现代双栏完整预览" })).toBeInTheDocument();
    expect(screen.getByLabelText("只读预览-full")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("按 URL 中的模板 ID 自动选择可用模板", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates: [template] });
    const onSelect = vi.fn();
    render(
      <TemplatePicker
        selectedTemplateId={null}
        initialTemplateId="8"
        onSelect={onSelect}
      />,
    );

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(template));
  });
});
