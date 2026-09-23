import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { api, type ResumeTemplate } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation } from "../../api/resumeContract";
import { WorkbenchTemplatePanel } from "./WorkbenchTemplatePanel";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: { ...actual.api, listResumeTemplates: vi.fn() },
  };
});

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: () => <div data-testid="resume-preview" />,
}));

function buildTemplate(id: string, key: string, name: string): ResumeTemplate {
  return {
    id,
    key,
    name,
    description: null,
    data: defaultCanonicalDocument,
    style: {
      ...defaultCanonicalPresentation,
      template_snapshot: { ...defaultCanonicalPresentation.template_snapshot, template_key: key },
    },
    switchable: true,
    incompatibility_reason: null,
  };
}

const templates = [
  buildTemplate("1", "classic-cn", "经典单栏"),
  buildTemplate("2", "modern-two-column-cn", "现代双栏"),
];

function renderPanel(overrides: Partial<ComponentProps<typeof WorkbenchTemplatePanel>> = {}) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const view = render(
    <WorkbenchTemplatePanel
      currentTemplateKey="classic-cn"
      onApply={onApply}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onApply, onClose, ...view };
}

describe("WorkbenchTemplatePanel", () => {
  it("加载完成后网格展示模板并标记当前模板", async () => {
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates });
    renderPanel();

    const grid = await screen.findByRole("list", { name: "可用简历模板" });
    const cards = screen.getAllByRole("button").filter((button) => button.textContent?.trim());

    expect(grid).toBeInTheDocument();
    expect(cards.map((card) => card.textContent)).toEqual(["经典单栏", "现代双栏"]);
    expect(screen.getByRole("button", { name: "经典单栏（当前模板）" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "应用模板：现代双栏" })).toHaveAttribute("aria-pressed", "false");
  });

  it("打开侧栏时定位当前模板，之后切换选中项不抢用户的滚动位置", async () => {
    let resolveLoad!: (value: { templates: ResumeTemplate[] }) => void;
    vi.mocked(api.listResumeTemplates).mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    const { container, rerender } = renderPanel({ currentTemplateKey: "modern-two-column-cn" });
    const body = container.querySelector<HTMLElement>(".workbench-template-panel-body")!;
    Object.defineProperty(body, "clientHeight", { configurable: true, value: 200 });
    const rect = (top: number, height: number) => ({ top, height }) as DOMRect;
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this === body) return rect(100, 200);
      if (this.classList.contains("is-selected")) return rect(480, 100);
      return rect(0, 0);
    });

    try {
      resolveLoad({ templates });
      await screen.findByRole("button", { name: "现代双栏（当前模板）" });
      await vi.waitFor(() => expect(body.scrollTop).toBe(330));

      body.scrollTop = 410;
      rerender(
        <WorkbenchTemplatePanel
          currentTemplateKey="classic-cn"
          onApply={vi.fn().mockResolvedValue(undefined)}
          onClose={vi.fn()}
        />,
      );
      expect(body.scrollTop).toBe(410);
    } finally {
      measure.mockRestore();
    }
  });

  it("点击非当前模板立即应用，点击当前模板不触发", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates });
    const { onApply } = renderPanel();

    await user.click(await screen.findByRole("button", { name: "经典单栏（当前模板）" }));
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "应用模板：现代双栏" }));
    expect(onApply).toHaveBeenCalledWith(templates[1]);
  });

  it("应用期间禁用全部模板卡片", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates });
    let release: () => void = () => undefined;
    const onApply = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    renderPanel({ onApply });

    await user.click(await screen.findByRole("button", { name: "应用模板：现代双栏" }));

    expect(screen.getByRole("button", { name: "应用模板：现代双栏" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "经典单栏（当前模板）" })).toBeDisabled();

    release();
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: "应用模板：现代双栏" })).toBeEnabled();
    });
  });

  it("加载失败后可以重新加载", async () => {
    const user = userEvent.setup();
    const listTemplates = vi
      .mocked(api.listResumeTemplates)
      .mockRejectedValueOnce(new Error("HTTP_503"))
      .mockResolvedValueOnce({ templates });
    renderPanel();

    expect(await screen.findByRole("alert")).toHaveTextContent("模板暂时无法加载");
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("list", { name: "可用简历模板" })).toBeInTheDocument();
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });

  it("面板关闭按钮触发关闭回调", async () => {
    const user = userEvent.setup();
    vi.mocked(api.listResumeTemplates).mockResolvedValue({ templates });
    const { onClose } = renderPanel();

    await user.click(screen.getByRole("button", { name: "关闭简历模板面板" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
