import * as routing from "../../routing";
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import {
  DATASET_UPLOAD_CONCURRENCY,
  DatasetsPage,
  datasetUploadErrorMessage,
} from "./DatasetsPage";

const record: DatasetRecord = {
  id: "1",
  folder_id: "f-batch",
  file_name: "岗位要求.md",
  file_format: "md",
  file_size: 1024,
  upload_status: "succeeded",
  parse_status: "succeeded",
  failure_reason: null,
  created_at: "2026-08-08T08:00:00Z",
};

const uploadBaseRecord = record;

const processingRecord: DatasetRecord = {
  ...record,
  id: "2",
  file_name: "进行中的资料.pdf",
  file_format: "pdf",
  parse_status: "processing",
};

const failedRecord: DatasetRecord = {
  ...record,
  id: "3",
  file_name: "失败资料.txt",
  file_format: "txt",
  parse_status: "failed",
  failure_reason: "service_unavailable",
};

const batchFolder = {
  id: "f-batch",
  name: "批量文件夹",
  dataset_count: 3,
  created_at: "2026-08-08T08:00:00Z",
  updated_at: "2026-08-08T08:00:00Z",
};

const batchRecord: DatasetRecord = { ...record, folder_id: "f-batch" };
const batchProcessingRecord: DatasetRecord = { ...processingRecord, folder_id: "f-batch" };
const batchFailedRecord: DatasetRecord = { ...failedRecord, folder_id: "f-batch" };
const audioRecord: DatasetRecord = {
  ...record,
  id: "4",
  file_name: "第一轮面试录音.mp3",
  file_format: "mp3",
  file_size: 8 * 1024 * 1024,
  asset_kind: "audio",
  parse_status: null,
  interview_label: "虚构测试公司 · 第一轮面试",
};

async function enterBatchFolder() {
  expect(screen.queryByRole("button", { name: "批量操作" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "打开文件夹「批量文件夹」" }));
  return await screen.findByRole("button", { name: "批量操作" });
}

beforeEach(() => {
  useResumeStore.setState({
    authStatus: "authenticated",
    user: {
      id: "1",
      email: "user@example.test",
      nickname: "测试用户",
      is_admin: false,
      avatar_url: null,
    },
  });
  vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [] });
  vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [], total_count: 0, uncategorized_count: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

// v3 确认弹窗（删除 / 批量删除 / 删除文件夹）：带「取消」按钮的 role=dialog
function confirmDialog() {
  const dialogs = screen.getAllByRole("dialog");
  const found = dialogs.find((dialog) => dialog.classList.contains("v3-confirm"));
  if (!found) throw new Error("未找到确认弹窗");
  return found;
}

async function findConfirmDialog() {
  return await waitFor(() => confirmDialog());
}

// 上传弹窗改为「先选文件，再点上传」：选择后点击底部主按钮提交
function submitUpload() {
  fireEvent.click(within(screen.getByRole("dialog", { name: "上传资料" })).getByRole("button", { name: "上传" }));
}

async function openUploadDialog() {
  await import("./DatasetUploadDialog");
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  await act(async () => {
    await Promise.resolve();
  });
  return screen.getByRole("dialog", { name: "上传资料" });
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText("选择资料文件"), { target: { files } });
  submitUpload();
}

describe("DatasetsPage", () => {
  it("删除非空文件夹先确认永久删除范围，取消不请求接口", async () => {
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    const remove = vi.spyOn(api, "deleteDatasetFolder").mockResolvedValue({ deleted: true, affected_dataset_count: 3 });
    render(<DatasetsPage />);
    fireEvent.click(await screen.findByRole("button", { name: `文件夹「${batchFolder.name}」操作菜单` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }));
    const dialog = confirmDialog();
    expect(dialog).toHaveTextContent("3 份资料，包括源文件和解析结果，删除后无法恢复");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `文件夹「${batchFolder.name}」操作菜单` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }));
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(batchFolder.id));
  });

  it("批量上传期间返回首页，后续文件仍上传到原文件夹", async () => {
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const pending: Array<() => void> = [];
    const upload = vi.spyOn(api, "uploadDataset").mockImplementation((file, _key, folderId) => new Promise((resolve) => {
      pending.push(() => resolve({ ...record, id: file.name, file_name: file.name, folder_id: folderId }));
    }));
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await screen.findByRole("heading", { name: batchFolder.name });
    await openUploadDialog();
    selectFiles([1, 2, 3, 4].map((index) => new File(["test"], `${index}.md`)));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    act(() => {
      window.history.replaceState(null, "", "/datasets");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await act(async () => { pending[0](); });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    expect(upload.mock.calls.every((call) => call[2] === batchFolder.id)).toBe(true);
    await act(async () => { pending.slice(1).forEach((resolve) => resolve()); });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });
  it("首页拖入文件只提示进入文件夹，不发起上传", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("还没有文件夹");
    expect(screen.queryByRole("button", { name: "上传资料" })).not.toBeInTheDocument();
    fireEvent.drop(document.querySelector(".ds-root")!, {
      dataTransfer: { files: [new File(["test"], "test.md")], types: ["Files"] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("请先进入文件夹再上传资料");
    expect(upload).not.toHaveBeenCalled();
  });
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.spyOn(api, "listDatasets").mockReturnValue(new Promise(() => undefined));

    const { container } = render(<DatasetsPage />);

    expect(screen.getByRole("status", { name: "正在加载资料…" })).toBeInTheDocument();
    expect(container.querySelector(".ds-head + .ds-body-slot .ds-loading")).toBeInTheDocument();
    expect(container.querySelector(".ds-body")).not.toBeInTheDocument();
    expect(container.querySelector(".ds-sub")).toHaveTextContent("");
  });

  it("资料先返回、文件夹后返回时不显示临时数量或空目录", async () => {
    let finish!: (value: Awaited<ReturnType<typeof api.listDatasetFolders>>) => void;
    vi.mocked(api.listDatasets).mockResolvedValue({ datasets: [batchRecord] });
    vi.mocked(api.listDatasetFolders).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { container } = render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await act(async () => undefined);
    expect(container.querySelector(".ds-title")).toHaveTextContent("");
    expect(container.querySelector(".ds-sub")).toHaveTextContent("");
    expect(container.querySelector(".ds-body")).not.toBeInTheDocument();
    await act(async () => { finish({ folders: [batchFolder], total_count: 1, uncategorized_count: 0 }); });
    expect(await screen.findByRole("heading", { name: batchFolder.name })).toBeInTheDocument();
    expect(container.querySelector(".ds-sub")).toHaveTextContent("共 1 份资料");
  });

  it("文件夹请求失败显示加载失败，不把已有资料误报成空目录", async () => {
    vi.mocked(api.listDatasetFolders).mockRejectedValue(new Error("offline"));
    render(<DatasetsPage />);
    expect(await screen.findByRole("heading", { name: "资料加载失败" })).toBeInTheDocument();
    expect(screen.queryByText("还没有文件夹")).not.toBeInTheDocument();
  });

  it("文件夹页头提供搜索、批量操作和唯一主按钮上传资料，列表展示名称、格式、大小与解析状态", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord, failedRecord] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    const { container } = render(<DatasetsPage initialFolderId={batchFolder.id} />);

    expect(await screen.findByRole("searchbox", { name: "搜索资料" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传资料" })).toHaveClass("v3-btn-dark");
    expect(container.querySelectorAll(".ds-actions .v3-btn-dark")).toHaveLength(1);

    expect(screen.getByText("岗位要求")).toBeInTheDocument();
    expect(screen.queryByText("岗位要求.md")).not.toBeInTheDocument();
    expect(screen.getAllByText("MD").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 KB")).toHaveLength(3);
    expect(screen.getByText("Markdown")).toBeInTheDocument();
    expect(screen.getByText("正在解析…")).toBeInTheDocument();
    expect(screen.getByText(/^解析失败 · 解析服务暂不可用/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /操作菜单/ })).toHaveLength(3);
    expect(container.querySelector(".ds-sub")).toHaveTextContent("共 3 份资料");
    // 右侧详情栏已去掉
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("搜索按去扩展名的资料显示名称过滤且兼容大小写", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.change(await screen.findByRole("searchbox", { name: "搜索资料" }), { target: { value: "岗位" } });
    expect(screen.getByText("岗位要求")).toBeInTheDocument();
    expect(screen.queryByText("进行中的资料")).not.toBeInTheDocument();
  });

  it("进入和退出批量模式，并在未选择资料时禁用删除", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 1, uncategorized_count: 0 });
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);

    expect(screen.getByRole("button", { name: "取消操作" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "全选当前筛选结果" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择「岗位要求」" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "删除资料（已选择 0 份）" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上传资料" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "取消操作" }));
    expect(screen.getByRole("button", { name: "批量操作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传资料" })).not.toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "全选当前筛选结果" })).not.toBeInTheDocument();
  });

  it("支持逐项选择，并且全选只添加当前筛选结果", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord, batchProcessingRecord, batchFailedRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择「岗位要求」" }));
    expect(screen.getByRole("button", { name: "删除资料（已选择 1 份）" })).not.toBeDisabled();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索资料" }), { target: { value: "进行中" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选结果" }));

    expect(screen.getByRole("checkbox", { name: "选择「进行中的资料」" })).toBeChecked();
    expect(screen.getByRole("button", { name: "删除资料（已选择 2 份）" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索资料" }), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "选择「岗位要求」" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择「进行中的资料」" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择「失败资料」" })).not.toBeChecked();
  });

  it("批量模式下选择控件和资料行不会打开预览，且隐藏行尾菜单", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 1, uncategorized_count: 0 });
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: batchRecord.id,
      file_name: batchRecord.file_name,
      file_format: batchRecord.file_format,
      markdown: "内容",
    });
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);
    const row = screen.getByText("岗位要求").closest("article");
    const rowCheckbox = screen.getByRole("checkbox", { name: "选择「岗位要求」" });
    expect(row).not.toHaveAttribute("role", "button");
    expect(rowCheckbox.closest(".ds-row-check")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "批量操作栏" })).getByRole("checkbox", { name: "全选当前筛选结果" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开「岗位要求」操作菜单/ })).not.toBeInTheDocument();
    fireEvent.click(rowCheckbox);
    fireEvent.click(row!);

    expect(getContent).not.toHaveBeenCalled();
  });

  it("确认后逐条删除选中资料并移除成功项", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord, batchFailedRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 2, uncategorized_count: 0 });
    const remove = vi.spyOn(api, "deleteDataset").mockResolvedValue({ deleted: true });
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "删除资料（已选择 2 份）" }));

    const dialog = await findConfirmDialog();
    expect(within(dialog).getByText("永久删除所选资料（2 份）？")).toBeInTheDocument();
    expect(within(dialog).getByText(/无法恢复/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除所选" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(remove).toHaveBeenNthCalledWith(1, "1");
    expect(remove).toHaveBeenNthCalledWith(2, "3");
    expect(screen.queryByText("岗位要求")).not.toBeInTheDocument();
    expect(screen.queryByText("失败资料")).not.toBeInTheDocument();
    expect(await screen.findByText("已删除 2 份资料。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量操作" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "全选当前筛选结果" })).not.toBeInTheDocument();
  });

  it("批量删除部分失败时保留失败项并展示失败反馈", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord, batchProcessingRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 2, uncategorized_count: 0 });
    const remove = vi.spyOn(api, "deleteDataset")
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new ApiRequestError(409, "DATASET_IN_PROGRESS"));
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);
    fireEvent.click(screen.getByRole("checkbox", { name: "全选当前筛选结果" }));
    fireEvent.click(screen.getByRole("button", { name: "删除资料（已选择 2 份）" }));
    fireEvent.click(within(await findConfirmDialog()).getByRole("button", { name: "永久删除所选" }));

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("岗位要求")).not.toBeInTheDocument();
    expect(screen.getByText("进行中的资料")).toBeInTheDocument();
    expect(await screen.findByText("已删除 1 份资料，1 份删除失败：进行中的资料：资料正在解析，处理完成后再删除"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量操作" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "选择「进行中的资料」" })).not.toBeInTheDocument();
  });

  it("外部首页不展示批量操作按钮，进入文件夹后才展示", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [batchFolder],
      total_count: 1,
      uncategorized_count: 0,
    });
    render(<DatasetsPage />);

    await screen.findByRole("button", { name: "打开文件夹「批量文件夹」" });
    expect(screen.queryByText("岗位要求")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量操作" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开文件夹「批量文件夹」" }));
    expect(screen.getByRole("button", { name: "批量操作" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回全部资料" }));
    expect(screen.queryByRole("button", { name: "批量操作" })).not.toBeInTheDocument();
  });

  it("点一行解析完成的文档直接打开只读预览，标题下展示格式、大小、上传日期与管理关联", async () => {
    vi.spyOn(api, "getDatasetContent").mockResolvedValue({id:record.id,file_name:record.file_name,file_format:record.file_format,markdown:"# 预览正文"});
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [{ ...record, interview_label: "虚构公司 · 二面" }] });
    const navigate=vi.spyOn(routing,"navigateTo").mockImplementation(()=>{});
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    await import("./DatasetPreviewDialog");
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开「岗位要求」解析预览" }));
    expect(navigate).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog", { name: "岗位要求" });
    expect(dialog).toHaveTextContent("MD · 1 KB · 上传于 2026-08-08");
    expect(dialog).toHaveTextContent("已关联：面试 · 虚构公司 · 二面");
    expect(within(dialog).getByRole("button", { name: "管理关联" })).toBeInTheDocument();
    expect(await within(dialog).findByText("预览正文")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", {name:"编辑"})).not.toBeInTheDocument();
  });

  it("上传完成的音频点一行直接下载，不显示等待解析", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [audioRecord] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 1, uncategorized_count: 0 });
    const download = vi.spyOn(api, "downloadDatasetSource").mockResolvedValue(new Blob(["audio"]));
    const createUrl = vi.fn(() => "blob:audio");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() }));
    const getContent = vi.spyOn(api, "getDatasetContent");
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    const row = await screen.findByRole("button", { name: "下载「第一轮面试录音」" });
    expect(screen.queryByText("等待解析")).not.toBeInTheDocument();
    expect(screen.getByText("音频 · 点击下载")).toBeInTheDocument();
    expect(screen.getByText("面试 · 虚构测试公司 · 第一轮面试")).toBeInTheDocument();
    fireEvent.click(row);
    await waitFor(() => expect(download).toHaveBeenCalledWith("4"));
    expect(getContent).not.toHaveBeenCalled();
  });

  it("菜单操作不会冒泡触发行预览，并按失败状态提供重试", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, failedRecord] });
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "内容",
    });
    const retry = vi.spyOn(api, "retryDataset").mockResolvedValue({ ...failedRecord, parse_status: "processing", failure_reason: null });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "打开「岗位要求」操作菜单" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["查看文件", "重命名", "移动到文件夹", "管理关联", "删除资料"]);
    expect(within(menu).queryByRole("menuitem", { name: "重新解析" })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "删除资料" }));
    expect(getContent).not.toHaveBeenCalled();
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "打开「失败资料」操作菜单" }));
    expect(screen.getByRole("menuitem", { name: "重新解析" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "查看文件" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("3"));
    expect(await screen.findByText("正在解析…")).toBeInTheDocument();
  });

  it("菜单打开时点击行只关闭菜单，再次点击才打开预览；菜单「查看文件」直接打开预览", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const navigate=vi.spyOn(routing,"navigateTo").mockImplementation(()=>{});
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "内容",
    });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    await import("./DatasetPreviewDialog");
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    const menuButton = await screen.findByRole("button", { name: /操作菜单/ });
    const row = screen.getByRole("button", { name: "打开「岗位要求」解析预览" });
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(getContent).not.toHaveBeenCalled();

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "查看文件" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: "岗位要求" })).toBeInTheDocument();
    await waitFor(() => expect(getContent).toHaveBeenCalledWith("1"));
    expect(row).toBeInTheDocument();
  });

  it("重命名调用独立 API，并只更新列表显示名称", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const rename = vi.spyOn(api, "renameDataset").mockResolvedValue({ ...record, file_name: "新的资料.md" });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: /操作菜单/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名资料" });
    const input = within(dialog).getByRole("textbox", { name: "资料名称" });
    fireEvent.change(input, { target: { value: "新的资料" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(rename).toHaveBeenCalledWith("1", "新的资料"));
    expect(await screen.findByText("新的资料")).toBeInTheDocument();
    expect(screen.queryByText("新的资料.md")).not.toBeInTheDocument();
  });

  it("删除先二次确认，成功后移除列表行", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const remove = vi.spyOn(api, "deleteDataset").mockResolvedValue({ deleted: true });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: /操作菜单/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除资料" }));
    const dialog = confirmDialog();
    expect(within(dialog).getByText(/永久删除「岗位要求」/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("1"));
    expect(screen.queryByText("岗位要求")).not.toBeInTheDocument();
  });

  it("删除处理中资料保留行并展示后端 409 反馈", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [processingRecord] });
    vi.spyOn(api, "deleteDataset").mockRejectedValue(new ApiRequestError(409, "DATASET_IN_PROGRESS"));
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: /操作菜单/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除资料" }));
    fireEvent.click(within(confirmDialog()).getByRole("button", { name: "永久删除" }));

    expect(await screen.findByText("资料正在解析，处理完成后再删除。")) .toBeInTheDocument();
    expect(screen.getByText("进行中的资料")).toBeInTheDocument();
  });

  it("上传弹窗按 06.1a：拖放区 + 上传到当前文件夹，选择文件后点「上传」提交", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const accepted = { ...record, id: "auto-upload", file_name: "自动上传.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);
    vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [accepted] });

    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    const dialog = await openUploadDialog();
    const input = screen.getByLabelText("选择资料文件");
    expect(input).toHaveAttribute("multiple");
    expect(dialog).toHaveTextContent("拖入资料文件，或点击选择");
    expect(dialog).toHaveTextContent("PDF、DOCX、Markdown、TXT 最大 10 MB；音视频最大 500 MB");
    expect(dialog).toHaveTextContent("上传到");
    expect(dialog).toHaveTextContent(batchFolder.name);
    expect(dialog).toHaveTextContent("未选择文件");
    expect(within(dialog).getByRole("button", { name: "上传" })).toBeDisabled();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();

    const file = new File(["# 自动上传"], "自动上传.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(dialog).toHaveTextContent("自动上传.md");
    expect(upload).not.toHaveBeenCalled();
    submitUpload();

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      file,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      batchFolder.id,
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
    expect(await screen.findByText("自动上传", { selector: ".ds-row-name strong" })).toBeInTheDocument();
  });

  it("StrictMode 下选择文件只触发一次上传", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "strict-mode",
      file_name: "严格模式.md",
      parse_status: "queued",
    });
    render(
      <StrictMode>
        <DatasetsPage initialFolderId={batchFolder.id} />
      </StrictMode>,
    );
    await openUploadDialog();
    selectFiles([new File(["# 严格模式"], "严格模式.md", { type: "text/markdown" })]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });

  it("内置浏览器缺少 Web Crypto 时仍生成规范幂等键并自动上传", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    vi.stubGlobal("crypto", undefined);
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "fallback-key",
      file_name: "兼容浏览器.md",
      parse_status: "queued",
    });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([new File(["# 兼容"], "兼容浏览器.md")]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      batchFolder.id,
    ));
  });

  it("幂等键生成异常时显示反馈而不是静默清空文件", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random unavailable");
    });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await screen.findByText("还没有资料");
    await openUploadDialog();
    selectFiles([new File(["# 失败"], "无法生成.md")]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法生成.md：无法创建上传请求，请刷新页面后重试");
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
  });

  it("失败提示展示三秒后自动移除", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    vi.useFakeTimers();
    try {
      render(<DatasetsPage initialFolderId={batchFolder.id} />);
      await openUploadDialog();
      await act(async () => {
        selectFiles([new File(["binary"], "不支持.exe")]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole("alert")).toHaveTextContent("不支持.exe");
      act(() => vi.advanceTimersByTime(2999));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("批量上传逐项校验、并发不超过三，失败原因显示在顶部提示条", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const upload = vi.spyOn(api, "uploadDataset");
    let active = 0;
    let maximumActive = 0;
    upload.mockImplementation(async (file) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      active -= 1;
      if (file.name === "失败.md") throw new ApiRequestError(502, "DATASET_UPLOAD_FAILED");
      return { ...record, file_name: file.name };
    });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([
      new File(["1"], "一.md"),
      new File(["2"], "二.md"),
      new File(["3"], "三.md"),
      new File(["4"], "四.md"),
      new File(["5"], "失败.md"),
      new File(["x"], "错误.exe"),
    ]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
    expect(maximumActive).toBeLessThanOrEqual(DATASET_UPLOAD_CONCURRENCY);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("部分文件上传失败：");
    expect(alert).toHaveTextContent("失败.md：上传失败，请稍后重试");
    expect(alert).toHaveTextContent("错误.exe：仅支持 DOCX、PDF、Markdown、TXT 和常见音视频文件");
    expect(alert.querySelector(".dataset-notice-message")?.textContent).not.toContain("\n");
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();

    expect(within(alert).queryByRole("button")).not.toBeInTheDocument();
  });

  it("上传请求失败后仍刷新列表，以显示服务端已保存的解析失败资料且不乐观插行", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const failedSaved = { ...failedRecord, folder_id: batchFolder.id, file_name: "队列失败.md", file_format: "md" };
    const list = vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [failedSaved] });
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValue(new ApiRequestError(502, "DATASET_QUEUE_UNAVAILABLE"));
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([new File(["# x"], "队列失败.md")]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), expect.stringMatching(/^[0-9a-f-]{36}$/), batchFolder.id));
    expect(await screen.findByText("队列失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("队列失败.md：资料已保存，但解析提交失败，请在列表中重新解析");
  });

  it("上传期间禁用文件选择和关闭按钮，避免重复提交", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    let resolveUpload: ((value: DatasetRecord) => void) | undefined;
    const upload = vi.spyOn(api, "uploadDataset").mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve; }),
    );
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    const dialog = await openUploadDialog();
    selectFiles([new File(["x"], "资料.md")]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("选择资料文件")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "关闭上传窗口" })).toBeDisabled();
    expect(within(dialog).getAllByText("正在上传…").length).toBeGreaterThan(0);
    resolveUpload?.(record);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
  });

  it("在具体文件夹内打开上传弹窗，不再选择文件夹并直接上传到当前文件夹", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [
        { id: "folder-1", name: "前端岗位", dataset_count: 0, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" },
        { id: "folder-2", name: "后端岗位", dataset_count: 0, created_at: "2026-03-01T00:00:00Z", updated_at: "2026-03-01T00:00:00Z" },
      ],
      total_count: 0,
      uncategorized_count: 0,
    });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "folder-upload",
      file_name: "简历.pdf",
      folder_id: "folder-1",
      parse_status: "queued",
    });

    render(<DatasetsPage />);

    // 进入「前端岗位」文件夹页面
    fireEvent.click(await screen.findByRole("button", { name: "打开文件夹「前端岗位」" }));
    expect(screen.getByRole("heading", { name: "前端岗位" })).toBeInTheDocument();

    // 点击上传资料
    const dialog = await openUploadDialog();
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();

    // 上传文件并验证 folder_id 传递
    const file = new File(["pdf content"], "简历.pdf", { type: "application/pdf" });
    selectFiles([file]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      file,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      "folder-1",
    ));
  });

  it("服务端接受后立即 upsert 正式列表并从上传框移除", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    let resolveRefresh: ((value: { datasets: DatasetRecord[] }) => void) | undefined;
    const accepted = { ...record, id: "accepted", file_name: "刚上传.md", parse_status: "queued" as const };
    vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);

    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([new File(["# x"], "刚上传.md", { type: "text/markdown" })]);

    await waitFor(() => expect(screen.getByText("刚上传")).toBeInTheDocument());
    expect(screen.getByText("等待解析")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "上传资料" })).toBeInTheDocument();

    resolveRefresh?.({ datasets: [accepted] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
  });

  it("列表同步失败时保留已接受行并提供重新刷新", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const accepted = { ...record, id: "accepted-sync", file_name: "同步失败.md", parse_status: "queued" as const };
    const list = vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockRejectedValueOnce(new Error("list unavailable"))
      .mockResolvedValue({ datasets: [accepted] });
    vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);

    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([new File(["# x"], "同步失败.md", { type: "text/markdown" })]);

    expect(await screen.findByText("同步失败")).toBeInTheDocument();
    expect(await screen.findByText("资料已接受，但列表同步失败")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "重新刷新" });
    expect(refreshButton).toBeInTheDocument();
    expect(refreshButton.parentElement).toHaveClass("ds-toast-action");
    fireEvent.click(refreshButton);
    await waitFor(() => expect(screen.queryByText("资料已接受，但列表同步失败")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("明确服务端失败后重新上传生成新幂等键", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const accepted = { ...record, id: "retry-key", file_name: "明确失败.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(new ApiRequestError(413, "DATASET_FILE_TOO_LARGE"))
      .mockResolvedValueOnce(accepted);
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    const file = new File(["# x"], "明确失败.md", { type: "text/markdown" });
    await openUploadDialog();
    selectFiles([file]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const firstKey = upload.mock.calls[0]?.[1];
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());

    await openUploadDialog();
    selectFiles([file]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1]?.[1]).toEqual(expect.any(String));
    expect(upload.mock.calls[1]?.[1]).not.toBe(firstKey);
    expect(await screen.findByText("明确失败")).toBeInTheDocument();
  });

  it("网络结果不明确时重试复用原幂等键", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const accepted = { ...record, id: "retry-network", file_name: "网络重试.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(accepted);
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    const file = new File(["# x"], "网络重试.md", { type: "text/markdown" });
    await openUploadDialog();
    selectFiles([file]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const firstKey = upload.mock.calls[0]?.[1];
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());

    await openUploadDialog();
    selectFiles([file]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1]?.[1]).toBe(firstKey);
    expect(await screen.findByText("网络重试")).toBeInTheDocument();
  });

  it("使用服务端 limits 校验单文件大小和批次数量", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    vi.spyOn(api, "listDatasets").mockResolvedValue({
      datasets: [],
      limits: { max_file_bytes: 2, max_files_per_batch: 2, allowed_extensions: [".md"] },
    });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "within-limit",
      file_name: "小文件.md",
      parse_status: "queued",
    });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await screen.findByText("还没有资料");
    await openUploadDialog();
    selectFiles([
      new File(["x"], "小文件.md"),
      new File(["xyz"], "超限.md"),
      new File(["z"], "被截断.md"),
    ]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]?.[0].name).toBe("小文件.md");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("超限.md：文件过大，最大支持 2 B");
    expect(alert).toHaveTextContent("一次最多选择 2 个文件，已保留前 2 个");
    expect(alert).not.toHaveTextContent("被截断.md");
  });

  it("正式列表将 queued 显示为等待解析并持续参与状态刷新", async () => {
    const queued = { ...record, id: "queued", file_name: "等待.md", parse_status: "queued" as const };
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [queued] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    const status = await screen.findByText("等待解析");
    expect(status).toHaveAttribute("data-status", "queued");
  });

  it("将资料上传与操作错误映射为稳定文案", () => {
    expect(datasetUploadErrorMessage(new ApiRequestError(413, "DATASET_TOO_LARGE"), "默认文案")).toContain("10 MB");
    expect(datasetUploadErrorMessage(new ApiRequestError(400, "UNSUPPORTED_DATASET_FORMAT"), "默认文案")).toContain("DOCX");
  });

  it("渲染文件夹卡片并支持点击文件夹进入分类视图", async () => {
    const d1 = { ...record, id: "1", file_name: "项目经历.md", file_format: "md", folder_id: "f1", parse_status: "succeeded" as const };
    const d2 = { ...record, id: "2", file_name: "杂项笔记.txt", file_format: "txt", folder_id: null, parse_status: "succeeded" as const };

    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [d1, d2] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [
        { id: "f1", name: "核心项目", dataset_count: 1, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      ],
      total_count: 2,
      uncategorized_count: 1,
    });

    render(<DatasetsPage />);

    // 首页渲染核心项目文件夹卡片，不再显示冗余的过滤按钮
    expect(await screen.findByRole("button", { name: "打开文件夹「核心项目」" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^全部资料/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^未分类/ })).not.toBeInTheDocument();

    // 首页只展示文件夹和历史未分类资料
    expect(screen.queryByText("项目经历")).not.toBeInTheDocument();
    expect(screen.queryByText("杂项笔记")).not.toBeInTheDocument();

    // 点击进入“核心项目”文件夹卡片，URL 携带 folder 参数并记录历史
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹「核心项目」" }));
    expect(window.location.search).toContain("folder=f1");
    expect(screen.getByText("项目经历")).toBeInTheDocument();
    expect(screen.queryByText("杂项笔记")).not.toBeInTheDocument();

    // 模拟浏览器后退（popstate）返回全部资料
    window.history.pushState(null, "", "/datasets");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => expect(screen.queryByText("杂项笔记")).not.toBeInTheDocument());
    expect(screen.queryByText("项目经历")).not.toBeInTheDocument();

    // 再次点击进入文件夹，然后通过返回按钮退出
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹「核心项目」" }));
    expect(screen.queryByText("杂项笔记")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回全部资料" }));
    expect(window.location.search).toBe("");
    expect(screen.queryByText("杂项笔记")).not.toBeInTheDocument();
  });

  it("支持新建文件夹并展示在首页文件夹网格中", async () => {
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [],
      total_count: 0,
      uncategorized_count: 0,
    });
    const createSpy = vi.spyOn(api, "createDatasetFolder").mockResolvedValue({
      id: "f-new",
      name: "新分类",
      dataset_count: 0,
      created_at: "2026-09-03T00:00:00Z",
      updated_at: "2026-09-03T00:00:00Z",
    });

    render(<DatasetsPage />);

    const addBtns = await screen.findAllByRole("button", { name: "新建文件夹" });
    fireEvent.click(addBtns[0]);

    const input = screen.getByLabelText("文件夹名称");
    fireEvent.change(input, { target: { value: "新分类" } });

    const submitBtn = screen.getByRole("button", { name: "创建文件夹" });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("新分类"));
  });

  it("支持单条资料移动到目标文件夹", async () => {
    const d1 = { ...record, id: "101", file_name: "个人履历.docx", file_format: "docx", folder_id: "f-source", parse_status: "succeeded" as const };
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [d1] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [
        { ...batchFolder, id: "f-source", name: "源文件夹" },
        { id: "f1", name: "工作经历", dataset_count: 0, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      ],
      total_count: 1,
      uncategorized_count: 1,
    });

    const moveSpy = vi.spyOn(api, "moveDataset").mockResolvedValue({
      ...d1,
      folder_id: "f1",
    });

    render(<DatasetsPage initialFolderId="f-source" />);

    expect(await screen.findByText("个人履历")).toBeInTheDocument();

    // 打开行操作菜单
    const menuBtn = screen.getByRole("button", { name: /打开「个人履历」操作菜单/ });
    fireEvent.click(menuBtn);

    // 点击移动到文件夹
    const moveItemBtn = screen.getByRole("menuitem", { name: /移动到文件夹/ });
    fireEvent.click(moveItemBtn);

    // 移动弹窗展示
    expect(screen.queryByRole("radio", { name: "未分类" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: /移动「个人履历」到文件夹/ })).toBeInTheDocument();

    // 选择“工作经历”分类
    const folderOption = screen.getByRole("radio", { name: /工作经历/ });
    fireEvent.click(folderOption);

    // 确认移动
    const confirmBtn = screen.getByRole("button", { name: "确定移动" });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith("101", "f1"));
  });

  it("支持批量选择资料并移动到目标文件夹", async () => {
    const d1 = { ...record, id: "201", file_name: "文件1.pdf", file_format: "pdf", parse_status: "succeeded" as const, folder_id: "f1" };
    const d2 = { ...record, id: "202", file_name: "文件2.pdf", file_format: "pdf", parse_status: "succeeded" as const, folder_id: "f1" };

    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [d1, d2] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({
      folders: [
        { id: "f1", name: "源文件夹", dataset_count: 2, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
        { id: "f2", name: "归档分类", dataset_count: 0, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" },
      ],
      total_count: 2,
      uncategorized_count: 0,
    });

    const batchMoveSpy = vi.spyOn(api, "batchMoveDatasets").mockResolvedValue({ moved_count: 2 });

    render(<DatasetsPage />);

    await screen.findByRole("button", { name: "打开文件夹「源文件夹」" });
    expect(screen.queryByText("文件1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量操作" })).not.toBeInTheDocument();

    // 进入“源文件夹”后展示批量操作
    fireEvent.click(screen.getByRole("button", { name: "打开文件夹「源文件夹」" }));

    // 开启批量操作模式
    const batchBtn = screen.getByRole("button", { name: "批量操作" });
    fireEvent.click(batchBtn);

    // 全选当前列表
    const selectAllCheckbox = screen.getByRole("checkbox", { name: "全选当前筛选结果" });
    fireEvent.click(selectAllCheckbox);

    // 点击底部悬浮栏批量移动按钮
    const batchMoveBtn = screen.getByRole("button", { name: /移动到文件夹（已选择 2 份）/ });
    fireEvent.click(batchMoveBtn);

    // 弹窗中选择“归档分类”
    const option = screen.getByRole("radio", { name: /归档分类/ });
    fireEvent.click(option);

    // 点击确定移动
    const submitBtn = screen.getByRole("button", { name: "确定移动" });
    fireEvent.click(submitBtn);

    await waitFor(() => expect(batchMoveSpy).toHaveBeenCalledWith(["201", "202"], "f2"));
  });

  it("首页展示文件夹卡片（数量 + 最近上传）与最近上传列表，点最近上传的文档打开预览", async () => {
    const recentDoc = { ...record, id: "r1", file_name: "近期资料.md", created_at: new Date().toISOString() };
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [recentDoc] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [{ ...batchFolder, dataset_count: 1 }], total_count: 1, uncategorized_count: 0 });
    vi.spyOn(api, "getDatasetContent").mockResolvedValue({ id: "r1", file_name: "近期资料.md", file_format: "md", markdown: "正文" });
    await import("./DatasetPreviewDialog");
    render(<DatasetsPage />);

    const card = await screen.findByRole("button", { name: `打开文件夹「${batchFolder.name}」` });
    expect(card).toHaveTextContent("1 份资料 · 最近上传 今天");
    const recent = screen.getByRole("list", { name: "最近上传" });
    const item = within(recent).getByRole("listitem", { name: `近期资料.md，位于「${batchFolder.name}」` });
    expect(item).toHaveTextContent(/今天 \d{2}:\d{2}/);
    fireEvent.click(item);
    expect(await screen.findByRole("dialog", { name: "近期资料" })).toBeInTheDocument();
  });

  it("管理关联：选择一场面试后调用 attach；已关联时换场次先解绑旧场次，也可取消关联", async () => {
    const sessionBase = {
      application_id: "a1", client_request_id: "c", stage_type: "interview" as const, round_no: 1, status: "scheduled" as const,
      round_result: "pending" as const, end_at: "2026-10-01T10:00:00Z", schedule_kind: "fixed_slot" as const, answer_plan_start_at: null,
      answer_plan_end_at: null, timezone: "Asia/Shanghai", mode: "video" as const, meeting_url: null, location: null, interviewer_name: null,
      interviewer_title: null, reminder_minutes: null, preparation_note: null, questions_markdown: null, review_summary: null,
      improvement_markdown: null, completed_at: null, cancelled_at: null, cancellation_reason: null, lock_version: 1,
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", calendar_color: "blue", application_stage_state: "active",
    };
    const sessions = [
      { ...sessionBase, id: "s1", company_name: "虚构甲公司", job_title: "后端开发", stage_label: "一面", start_at: "2026-10-01T08:00:00Z" },
      { ...sessionBase, id: "s2", company_name: "虚构乙公司", job_title: "数据开发", stage_label: "二面", start_at: "2026-10-02T08:00:00Z" },
    ];
    vi.spyOn(api, "listInterviewSessions").mockResolvedValue({ items: sessions as never, next_cursor: null });
    const linked = { ...record, interview_session_id: "s1", interview_label: "虚构甲公司 · 一面" };
    const list = vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [linked] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 1, uncategorized_count: 0 });
    const unlink = vi.spyOn(api, "unlinkSessionAsset").mockResolvedValue({ unlinked: true });
    const attach = vi.spyOn(api, "attachInterviewAsset").mockResolvedValue({ asset: {} as never });
    await import("./components/ManageAssociationDialog");
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "打开「岗位要求」操作菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "管理关联" }));
    const dialog = await screen.findByRole("dialog", { name: "管理关联" });
    const current = await within(dialog).findByRole("radio", { name: /虚构甲公司/ });
    expect(current).toHaveAttribute("aria-checked", "true");
    expect(current).toHaveTextContent("当前");
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();

    // 搜索过滤
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "搜索面试" }), { target: { value: "乙" } });
    expect(within(dialog).queryByRole("radio", { name: /虚构甲公司/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: /虚构乙公司/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(attach).toHaveBeenCalledWith("s2", "1"));
    expect(unlink).toHaveBeenCalledWith("s1", "1");
    expect(unlink.mock.invocationCallOrder[0]).toBeLessThan(attach.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "管理关联" })).not.toBeInTheDocument());
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);

    // 取消关联
    unlink.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "打开「岗位要求」操作菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "管理关联" }));
    const again = await screen.findByRole("dialog", { name: "管理关联" });
    fireEvent.click(within(again).getByRole("button", { name: "取消关联" }));
    await waitFor(() => expect(unlink).toHaveBeenCalledWith("s1", "1"));
    expect(await screen.findByText("已取消关联。")).toBeInTheDocument();
  });

  it("加载失败展示 10.3 错误卡并可重新加载", async () => {
    const list = vi.spyOn(api, "listDatasets").mockRejectedValueOnce(new Error("down")).mockResolvedValue({ datasets: [] });
    render(<DatasetsPage />);
    expect(await screen.findByRole("heading", { name: "资料加载失败" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText("还没有文件夹")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("同名冲突弹窗默认保留两份，改名后上传；也可切换为替换现有文件", async () => {
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const conflictError = new ApiRequestError(409, "DATASET_NAME_CONFLICT", {
      candidates: [{ id: "old", file_name: "同名.md", content_revision: "3", created_at: "2026-08-08T08:00:00Z", replaceable: true }],
      suggested_name: "同名 (1).md",
    });
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValue({ ...record, id: "renamed", file_name: "同名 (1).md", folder_id: batchFolder.id });
    await import("./DatasetUploadConflictDialog");
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    await openUploadDialog();
    selectFiles([new File(["x"], "同名.md")]);

    const dialog = await screen.findByRole("dialog", { name: "文件夹里已有同名文件" });
    expect(within(dialog).getByRole("radio", { name: "保留两份" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("textbox", { name: "新文件名称" })).toHaveValue("同名 (1).md");
    fireEvent.click(within(dialog).getByRole("button", { name: "上传" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls[1]?.[0].name).toBe("同名 (1).md");
    expect(upload.mock.calls[1]?.[2]).toBe(batchFolder.id);
  });
});
