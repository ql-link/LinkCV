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

function openUploadDialog() {
  fireEvent.click(screen.getByRole("button", { name: "上传资料" }));
  return screen.getByRole("dialog", { name: "上传资料" });
}

function selectFiles(files: File[]) {
  fireEvent.change(screen.getByLabelText("选择资料文件"), { target: { files } });
}

describe("DatasetsPage", () => {
  it("删除非空文件夹先确认永久删除范围，取消不请求接口", async () => {
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    const remove = vi.spyOn(api, "deleteDatasetFolder").mockResolvedValue({ deleted: true, affected_dataset_count: 3 });
    render(<DatasetsPage />);
    fireEvent.click(await screen.findByRole("button", { name: `文件夹「${batchFolder.name}」操作菜单` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("3 份资料，包括源文件和解析结果，删除后无法恢复");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `文件夹「${batchFolder.name}」操作菜单` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /删除/ }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "确认删除" }));
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
    openUploadDialog();
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
    fireEvent.drop(screen.getByRole("main"), {
      dataTransfer: { files: [new File(["test"], "test.md")], types: ["Files"] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("请先进入文件夹再上传资料");
    expect(upload).not.toHaveBeenCalled();
  });
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.spyOn(api, "listDatasets").mockReturnValue(new Promise(() => undefined));

    const { container } = render(<DatasetsPage />);

    expect(screen.getByRole("status", { name: "正在加载资料…" })).toBeInTheDocument();
    expect(container.querySelector(".datasets-page > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".datasets-body")).not.toBeInTheDocument();
  });

  it("在 hero actions 复用可展开搜索，文件卡片展示格式但隐藏大小和查看按钮", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord, failedRecord] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    expect(await screen.findByRole("button", { name: "搜索资料" })).toBeInTheDocument();
    const actions = screen.getByRole("button", { name: "搜索资料" }).parentElement;
    expect(actions?.className).toContain("page-hero-actions");
    expect(screen.getByRole("button", { name: "上传资料" })).toBeInTheDocument();

    expect(screen.getByText("岗位要求")).toBeInTheDocument();
    expect(screen.queryByText("岗位要求.md")).not.toBeInTheDocument();
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.queryByText("1 KB")).not.toBeInTheDocument();
    expect(screen.queryByText("查看结果")).not.toBeInTheDocument();
    expect(screen.getByText("正在解析")).toBeInTheDocument();
    expect(screen.queryByText("可用")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /操作菜单/ })).toHaveLength(3);
    expect(screen.getByText("共 3 份资料")).toBeInTheDocument();
  });

  it("搜索按去扩展名的资料显示名称过滤且兼容大小写", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord] });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    fireEvent.click(await screen.findByRole("button", { name: "搜索资料" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索资料" }), { target: { value: "岗位" } });
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

  it("支持逐项选择，并且表头全选只添加当前筛选结果", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [batchRecord, batchProcessingRecord, batchFailedRecord] });
    vi.spyOn(api, "listDatasetFolders").mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage />);

    const batchBtn = await enterBatchFolder();
    fireEvent.click(batchBtn);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择「岗位要求」" }));
    expect(screen.getByRole("button", { name: "删除资料（已选择 1 份）" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "搜索资料" }));
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
    const headerCheckbox = screen.getByRole("checkbox", { name: "全选当前筛选结果" });
    expect(row).not.toHaveAttribute("role", "button");
    expect(row?.firstElementChild).toHaveClass("dataset-cell-name");
    expect(rowCheckbox.closest(".dataset-row-actions")).not.toBeNull();
    expect(rowCheckbox.closest(".dataset-row-selection")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "批量操作栏" })).getByRole("checkbox", { name: "全选当前筛选结果" })).toBe(headerCheckbox);
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

    const dialog = await screen.findByRole("alertdialog");
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
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "永久删除所选" }));

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

  it("点击解析完成的文件打开只读预览弹窗", async () => {
    vi.spyOn(api, "getDatasetContent").mockResolvedValue({id:record.id,file_name:record.file_name,file_format:record.file_format,markdown:"# 预览正文"});
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const navigate=vi.spyOn(routing,"navigateTo").mockImplementation(()=>{});
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "打开「岗位要求」解析预览" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", {name:"编辑"})).not.toBeInTheDocument();
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

    const menuButtons = await screen.findAllByRole("button", { name: /操作菜单/ });
    fireEvent.click(menuButtons[0]);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "重新解析" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(getContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("3"));
    expect(await screen.findByText("正在解析")).toBeInTheDocument();
  });

  it("点击菜单外区域会关闭菜单，点击资料行时只关闭而不打开预览", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const navigate=vi.spyOn(routing,"navigateTo").mockImplementation(()=>{});
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "内容",
    });
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 3, uncategorized_count: 0 });
    render(<DatasetsPage initialFolderId={batchFolder.id} />);

    const menuButton = await screen.findByRole("button", { name: /操作菜单/ });
    const row = screen.getByRole("button", { name: "打开「岗位要求」解析预览" });
    fireEvent.click(menuButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(getContent).not.toHaveBeenCalled();

    fireEvent.click(menuButton);
    fireEvent.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(row);
    expect(navigate).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = screen.getByRole("alertdialog");
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
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));

    expect(await screen.findByText("资料正在解析，处理完成后再删除。")) .toBeInTheDocument();
    expect(screen.getByText("进行中的资料")).toBeInTheDocument();
  });

  it("上传弹窗只保留单层选择区域，选择文件后立即上传", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    const accepted = { ...record, id: "auto-upload", file_name: "自动上传.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);
    vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [accepted] });

    render(<DatasetsPage initialFolderId={batchFolder.id} />);
    const dialog = openUploadDialog();
    const input = screen.getByLabelText("选择资料文件");
    expect(input).toHaveAttribute("multiple");
    expect(dialog.querySelector(".dataset-file-upload")).toBeInTheDocument();
    expect(dialog.querySelector(".dataset-upload-queue")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "上传资料" })).not.toBeInTheDocument();

    const file = new File(["# 自动上传"], "自动上传.md", { type: "text/markdown" });
    selectFiles([file]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      file,
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      batchFolder.id,
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
    expect(await screen.findByText("自动上传", { selector: "strong.dataset-name" })).toBeInTheDocument();
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
    openUploadDialog();
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
    openUploadDialog();
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
    openUploadDialog();
    selectFiles([new File(["# 失败"], "无法生成.md")]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法生成.md：无法创建上传请求，请刷新页面后重试");
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
  });

  it("失败提示展示五秒后淡出并自动移除", async () => {
    const record = { ...uploadBaseRecord, folder_id: batchFolder.id };
    vi.mocked(api.listDatasetFolders).mockResolvedValue({ folders: [batchFolder], total_count: 0, uncategorized_count: 0 });
    vi.useFakeTimers();
    try {
      render(<DatasetsPage initialFolderId={batchFolder.id} />);
      openUploadDialog();
      await act(async () => {
        selectFiles([new File(["binary"], "不支持.exe")]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole("alert")).toHaveTextContent("不支持.exe");
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole("alert")).toHaveClass("is-fading");
      act(() => vi.advanceTimersByTime(300));
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
    openUploadDialog();
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
    expect(alert).toHaveTextContent("错误.exe：仅支持 DOCX、PDF、Markdown 和 TXT 文件");
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
    openUploadDialog();
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
    const dialog = openUploadDialog();
    selectFiles([new File(["x"], "资料.md")]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("选择资料文件")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "关闭上传窗口" })).toBeDisabled();
    expect(within(dialog).getByText("正在上传…")).toBeInTheDocument();
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
    const dialog = openUploadDialog();
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
    openUploadDialog();
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
    openUploadDialog();
    selectFiles([new File(["# x"], "同步失败.md", { type: "text/markdown" })]);

    expect(await screen.findByText("同步失败")).toBeInTheDocument();
    expect(await screen.findByText("资料已接受，但列表同步失败")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "重新刷新" });
    expect(refreshButton).toBeInTheDocument();
    expect(refreshButton.parentElement).toHaveClass("ui-feedback-notice-action");
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
    openUploadDialog();
    selectFiles([file]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const firstKey = upload.mock.calls[0]?.[1];
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());

    openUploadDialog();
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
    openUploadDialog();
    selectFiles([file]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const firstKey = upload.mock.calls[0]?.[1];
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());

    openUploadDialog();
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
    openUploadDialog();
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
    expect(screen.getByRole("dialog", { name: /移动「个人履历」到文件夹/ })).toBeInTheDocument();

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
});
