import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type ResumeSummary } from "../../api/client";
import { HomeScreen } from "./HomePage";

vi.mock("./TemplatePicker", () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (template: object) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          id: "8",
          key: "blank-cn",
          name: "空白简历",
          description: null,
          data: {},
          style: {},
        })
      }
    >
      选择空白模板
    </button>
  ),
}));

const resumes: ResumeSummary[] = [
  {
    id: "1",
    title: "Frontend Resume",
    source_type: "template",
    lock_version: 1,
    created_at: "2026-07-20T08:00:00Z",
    updated_at: "2026-07-24T08:00:00Z",
  },
  {
    id: "2",
    title: "产品经理",
    source_type: "template",
    lock_version: 1,
    created_at: "2026-07-20T08:00:00Z",
    updated_at: "2026-07-23T08:00:00Z",
  },
];

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props: React.ComponentProps<typeof HomeScreen> = {
    resumes,
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onCreate: vi.fn(),
    onImport: vi.fn().mockResolvedValue("1"),
    ...overrides,
  };
  return { ...render(<HomeScreen {...props} />), props };
}

describe("HomeScreen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("按名称筛选简历并从新建按钮进入创建流程", () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.change(screen.getByPlaceholderText("搜索简历"), {
      target: { value: "frontend" },
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建简历" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("导入必须同时选择模板和文件，成功后打开正式简历", async () => {
    const onImport = vi.fn().mockResolvedValue("3");
    const onOpen = vi.fn();
    const file = new File(["# Zhang San"], "resume.md", { type: "text/markdown" });
    renderHome({ onImport, onOpen });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    const submit = screen.getByRole("button", { name: "开始导入" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file, "8"));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("3"));
    expect(screen.getByText("简历导入成功。")).toBeInTheDocument();
  });

  it("结构化模型未配置时在导入弹窗内显示具体错误", async () => {
    const onImport = vi.fn().mockRejectedValue(
      new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE"),
    );
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("内容结构化模型未配置或凭据不可用，请联系管理员配置后重试。");
    expect(screen.getByRole("dialog", { name: "导入简历" })).toContainElement(error);
    expect(screen.getByText("张三简历.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始导入" })).toBeEnabled();
  });

  it("同步导入等待响应时显示处理中状态并防止关闭弹窗", async () => {
    let resolveImport: ((resumeId: string) => void) | undefined;
    const onImport = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveImport = resolve;
      }),
    );
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    const onOpen = vi.fn();
    renderHome({ onImport, onOpen });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    expect(screen.getByRole("button", { name: "正在导入…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭" })).toBeDisabled();

    resolveImport?.("3");
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("3"));
  });

  it("未知导入错误会显示服务端错误码而不是无响应", async () => {
    const onImport = vi.fn().mockRejectedValue(new ApiRequestError(502, "IMPORT_PROVIDER_FAILED"));
    const file = new File(["# 张三"], "张三简历.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.click(screen.getByRole("button", { name: "选择空白模板" }));
    fireEvent.change(screen.getByLabelText(/选择 Markdown/), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "导入失败（IMPORT_PROVIDER_FAILED），请稍后重试。",
    );
  });

  it("通过站内确认弹窗删除正式简历", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderHome({ onDelete });
    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    expect(screen.getByRole("alertdialog", { name: "删除“Frontend Resume”？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("1"));
  });
});
