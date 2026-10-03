import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type DatasetFolder, type DatasetRecord } from "@/api/client";
import { GeneratedDocumentSaveDialog } from "./GeneratedDocumentSaveDialog";
import type { GeneratedDocument } from "./PreviewPanel";

const document: GeneratedDocument = { kind: "generated", id: "generated-1", label: "示例.md", content: "# 示例正文" };
const folder = { id: "folder-1", name: "示例资料", dataset_count: 0 } as DatasetFolder;
const props = () => ({ document, onClose: vi.fn(), onSaved: vi.fn() });

beforeEach(() => {
  vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [folder], total_count: 0, uncategorized_count: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe("GeneratedDocumentSaveDialog", () => {
  it("requires a destination and uploads the original content with that folder", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({ id: "dataset-1", file_name: "示例.md" } as DatasetRecord);
    const handlers = props();
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...handlers} />);
    const confirm = screen.getByRole("button", { name: "确认保存" });
    expect(confirm).toBeDisabled();
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    await user.click(confirm);
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "dataset-1" })));
    const [file, key, folderId] = upload.mock.calls[0];
    expect(file.name).toBe("示例.md");
    expect(folderId).toBe("folder-1");
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    const content = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(file); });
    expect(content).toBe("# 示例正文");
  });

  it("supports an account with no folders by creating and selecting a real folder", async () => {
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [], total_count: 0, uncategorized_count: 0 });
    const create = vi.spyOn(api, "createDatasetFolder").mockResolvedValue(folder);
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({ id: "dataset-1" } as DatasetRecord);
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...props()} />);
    expect(await screen.findByText("还没有文件夹，请先新建一个。")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "文件夹名称" }), "示例资料");
    await user.click(screen.getByRole("button", { name: "新建文件夹" }));
    expect(await screen.findByRole("radio", { name: "示例资料" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), expect.any(String), "folder-1"));
    expect(create).toHaveBeenCalledWith("示例资料");
  });

  it("keeps the same request and destination across a network failure and reopening", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValueOnce(new TypeError("network interrupted")).mockResolvedValueOnce({ id: "dataset-1" } as DatasetRecord);
    const user = userEvent.setup();
    const handlers = props();
    const { rerender } = render(<GeneratedDocumentSaveDialog {...handlers} />);
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存到资料库失败");
    expect(screen.getByRole("radio", { name: "示例资料" })).toBeDisabled();
    expect(handlers.onSaved).not.toHaveBeenCalled();
    rerender(<GeneratedDocumentSaveDialog {...handlers} document={null} />);
    rerender(<GeneratedDocumentSaveDialog {...handlers} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "确认保存" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[1]).toEqual(upload.mock.calls[0]);
  });

  it("reuses the renamed file and key if the keep-both upload is interrupted", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValueOnce(new ApiRequestError(409, "DATASET_NAME_CONFLICT")).mockRejectedValueOnce(new TypeError("network interrupted")).mockResolvedValueOnce({ id: "dataset-2" } as DatasetRecord);
    const handlers = props();
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...handlers} />);
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("保存到资料库失败");
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[1][0].name).toMatch(/^示例-\d+-[0-9a-f]+\.md$/);
    expect(upload.mock.calls[1][1]).not.toBe(upload.mock.calls[0][1]);
    expect(upload.mock.calls[2]).toEqual(upload.mock.calls[1]);
  });

  it("retains the request when the server reports an upload already in progress", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValueOnce(new ApiRequestError(409, "DATASET_UPLOAD_IN_PROGRESS")).mockResolvedValueOnce({ id: "dataset-1" } as DatasetRecord);
    const user = userEvent.setup();
    const handlers = props();
    render(<GeneratedDocumentSaveDialog {...handlers} />);
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    await waitFor(() => expect(handlers.onSaved).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[1]).toEqual(upload.mock.calls[0]);
  });

  it("does not submit while folder loading fails and can reload the list", async () => {
    vi.mocked(api.listDatasetFolders).mockRejectedValueOnce(new Error("offline"));
    const upload = vi.spyOn(api, "uploadDataset");
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...props()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("文件夹列表加载失败");
    expect(screen.getByRole("button", { name: "确认保存" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByRole("radio", { name: "示例资料" })).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("allows reselection after a missing folder is explicitly rejected", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValue(new ApiRequestError(404, "FOLDER_NOT_FOUND"));
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...props()} />);
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    await user.click(screen.getByRole("button", { name: "确认保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目标文件夹已不可用");
    expect(screen.getByRole("button", { name: "确认保存" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "示例资料" })).toBeEnabled();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate submissions while saving and does not close the dialog", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockReturnValue(new Promise(() => {}));
    const handlers = props();
    const user = userEvent.setup();
    render(<GeneratedDocumentSaveDialog {...handlers} />);
    await user.click(await screen.findByRole("radio", { name: "示例资料" }));
    const confirm = screen.getByRole("button", { name: "确认保存" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});
