import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { PreviewPanel, type PreviewTab } from "./PreviewPanel";

const callbacks = () => ({ onActivate: vi.fn(), onCloseTab: vi.fn(), onClose: vi.fn() });
const tab: PreviewTab = { kind: "dataset", id: "d1", label: "示例岗位.md" };
afterEach(() => vi.restoreAllMocks());

describe("文件预览", () => {
  it("网络失败可以重试，引用片段标出已引用", async () => {
    vi.spyOn(api, "getDatasetContent").mockRejectedValueOnce(new ApiRequestError(500, "INTERNAL_ERROR")).mockResolvedValueOnce({ id: "d1", file_name: tab.label, file_format: "md", markdown: "# 示例岗位\n\n- 负责调度系统设计\n- 具备后端经验" });
    render(<PreviewPanel tabs={[{ ...tab, excerpts: ["负责调度系统设计"] }]} activeKey="dataset:d1" {...callbacks()} />);
    expect(await screen.findByText("预览加载失败")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("负责调度系统设计")).toHaveAttribute("data-citation", "已引用");
    expect(screen.getByText("只读预览 · AI 本次引用了 1 条内容")).toBeInTheDocument();
  });
  it("已删除和无权限都反馈不可用，不自动重试", async () => {
    vi.spyOn(api, "getDatasetContent").mockRejectedValue(new ApiRequestError(403, "FORBIDDEN"));
    const onUnavailable = vi.fn();
    render(<PreviewPanel tabs={[tab]} activeKey="dataset:d1" onUnavailable={onUnavailable} {...callbacks()} />);
    expect(await screen.findByText("这个文件已不可用")).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalledWith("dataset:d1");
    expect(screen.queryByRole("button", { name: "重试" })).not.toBeInTheDocument();
  });
  it("不支持的文件显示下载入口", async () => {
    vi.spyOn(api, "getDatasetContent").mockResolvedValue({ id: "d1", file_name: "示例.docx", file_format: "docx", markdown: "解析结果" });
    render(<PreviewPanel tabs={[{ ...tab, label: "示例.docx" }]} activeKey="dataset:d1" {...callbacks()} />);
    expect(await screen.findByText("暂不支持预览此格式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载文件" })).toBeEnabled();
  });
  it("截图支持缩放、复位，面板支持键盘调整宽度", async () => {
    const onWidthChange = vi.fn();
    render(<PreviewPanel tabs={[{ kind: "image", id: "i1", label: "截图.png", url: "data:image/png;base64,AA==" }]} activeKey="image:i1" width={520} onWidthChange={onWidthChange} {...callbacks()} />);
    await userEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByRole("button", { name: "恢复图片大小" })).toHaveTextContent("125%");
    await userEvent.click(screen.getByRole("button", { name: "恢复图片大小" }));
    expect(screen.getByRole("button", { name: "恢复图片大小" })).toHaveTextContent("100%");
    fireEvent.keyDown(screen.getByRole("separator", { name: "调整预览宽度" }), { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenCalledWith(540);
    await userEvent.click(screen.getByRole("button", { name: "全屏查看" }));
    expect(screen.getByRole("button", { name: "恢复面板大小" })).toHaveAttribute("aria-pressed", "true");
  });
  it("生成文档复制真实正文，保存回调带正确文档 ID", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onSaveGenerated = vi.fn();
    render(<PreviewPanel tabs={[{ kind: "generated", id: "g1", label: "准备.md", content: "# 准备文档\n\n文档内容" }]} activeKey="generated:g1" onSaveGenerated={onSaveGenerated} {...callbacks()} />);
    await user.click(screen.getByRole("button", { name: "复制" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("# 准备文档\n\n文档内容"));
    await user.click(screen.getByRole("button", { name: "保存到资料库" }));
    expect(onSaveGenerated).toHaveBeenCalledWith("g1");
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
  });
});
