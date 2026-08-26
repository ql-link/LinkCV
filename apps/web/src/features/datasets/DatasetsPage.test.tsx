import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import {
  DATASET_UPLOAD_CONCURRENCY,
  DatasetsPage,
  MAX_DATASET_BATCH_FILES,
  datasetUploadErrorMessage,
} from "./DatasetsPage";

const record: DatasetRecord = {
  id: "1",
  file_name: "岗位要求.md",
  file_format: "md",
  file_size: 1024,
  upload_status: "succeeded",
  parse_status: "succeeded",
  failure_reason: null,
  created_at: "2026-08-08T08:00:00Z",
};

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
});

afterEach(() => {
  vi.restoreAllMocks();
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
  it("首次读取时在页头下方展示统一加载状态", () => {
    vi.spyOn(api, "listDatasets").mockReturnValue(new Promise(() => undefined));

    const { container } = render(<DatasetsPage />);

    expect(screen.getByRole("status", { name: "正在加载资料…" })).toBeInTheDocument();
    expect(container.querySelector(".datasets-page > .page-loading")).toBeInTheDocument();
    expect(container.querySelector(".datasets-body")).not.toBeInTheDocument();
  });

  it("在 hero actions 复用可展开搜索，并在统一列表中隐藏格式、图标和查看按钮", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord, failedRecord] });
    render(<DatasetsPage />);

    expect(await screen.findByRole("button", { name: "搜索资料" })).toBeInTheDocument();
    const actions = screen.getByRole("button", { name: "搜索资料" }).parentElement;
    expect(actions?.className).toContain("page-hero-actions");
    expect(screen.getByRole("button", { name: "上传资料" }).parentElement).toBe(actions);

    expect(screen.getByText("岗位要求")).toBeInTheDocument();
    expect(screen.queryByText("岗位要求.md")).not.toBeInTheDocument();
    expect(screen.queryByText("MD")).not.toBeInTheDocument();
    expect(screen.queryByText("查看结果")).not.toBeInTheDocument();
    expect(screen.getByText("正在解析")).toBeInTheDocument();
    expect(screen.getByText("解析完成")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /操作菜单/ })).toHaveLength(3);
  });

  it("搜索按去扩展名的资料显示名称过滤且兼容大小写", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record, processingRecord] });
    render(<DatasetsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "搜索资料" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索资料" }), { target: { value: "岗位" } });
    expect(screen.getByText("岗位要求")).toBeInTheDocument();
    expect(screen.queryByText("进行中的资料")).not.toBeInTheDocument();
  });

  it("点击解析完成的整行直接打开安全 Markdown 预览", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "# 解析标题\n\n- 第一项\n\n<script>window.bad = true</script>\n\n![架构图](https://example.test/a.png)",
    });
    render(<DatasetsPage />);

    const row = await screen.findByRole("button", { name: "打开「岗位要求」解析预览" });
    fireEvent.click(row);

    const dialog = await screen.findByRole("dialog");
    expect(getContent).toHaveBeenCalledWith("1");
    expect(within(dialog).getByRole("heading", { name: "解析标题" })).toBeInTheDocument();
    expect(within(dialog).getByText("第一项")).toBeInTheDocument();
    expect(within(dialog).getByText("[图片：架构图]")).toBeInTheDocument();
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(row).toHaveFocus();
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
    render(<DatasetsPage />);

    const menuButtons = await screen.findAllByRole("button", { name: /操作菜单/ });
    fireEvent.click(menuButtons[0]);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "重新解析" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(getContent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(menuButtons[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "重新解析" }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("3"));
    expect(await screen.findByText("正在解析")).toBeInTheDocument();
  });

  it("重命名调用独立 API，并只更新列表显示名称", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const rename = vi.spyOn(api, "renameDataset").mockResolvedValue({ ...record, file_name: "新的资料.md" });
    render(<DatasetsPage />);

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
    render(<DatasetsPage />);

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
    render(<DatasetsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /操作菜单/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "永久删除" }));

    expect(await screen.findByText("资料正在解析，处理完成后再删除。")) .toBeInTheDocument();
    expect(screen.getByText("进行中的资料")).toBeInTheDocument();
  });

  it("上传弹窗支持多选、拖放、逐项移除和最多十个文件", async () => {
    render(<DatasetsPage />);
    const dialog = openUploadDialog();
    const input = screen.getByLabelText("选择资料文件");
    expect(input).toHaveAttribute("multiple");

    const files = Array.from({ length: MAX_DATASET_BATCH_FILES + 1 }, (_, index) => (
      new File([`# ${index}`], `资料-${index}.md`, { type: "text/markdown" })
    ));
    selectFiles(files);
    expect(await within(dialog).findByText(`待上传文件（${MAX_DATASET_BATCH_FILES}/${MAX_DATASET_BATCH_FILES}）`)).toBeInTheDocument();
    expect(screen.getByText(/一次最多选择 10 个文件/)).toBeInTheDocument();

    fireEvent.drop(screen.getByRole("button", { name: /点击上传或拖放多个文件/ }), {
      dataTransfer: { files: [new File(["x"], "extra.md")] },
    });
    expect(screen.getAllByRole("button", { name: /^移除 / })).toHaveLength(MAX_DATASET_BATCH_FILES);
    fireEvent.click(screen.getByRole("button", { name: "移除 资料-0.md" }));
    expect(screen.queryByText("资料-0.md")).not.toBeInTheDocument();
  });

  it("批量上传逐项校验、并发不超过三且部分失败留在弹窗", async () => {
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
    render(<DatasetsPage />);
    const dialog = openUploadDialog();
    selectFiles([
      new File(["1"], "一.md"),
      new File(["2"], "二.md"),
      new File(["3"], "三.md"),
      new File(["4"], "四.md"),
      new File(["5"], "失败.md"),
      new File(["x"], "错误.exe"),
    ]);
    fireEvent.click(within(dialog).getByRole("button", { name: "上传资料" }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(5));
    expect(maximumActive).toBeLessThanOrEqual(DATASET_UPLOAD_CONCURRENCY);
    expect(await within(dialog).findByText("上传失败，请稍后重试。")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "重试上传 失败.md" })).toBeInTheDocument();
    expect(within(dialog).getByText("仅支持 DOCX、PDF、Markdown 和 TXT 文件。")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "上传资料" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "重试上传 失败.md" }));
    expect(within(dialog).queryByText("上传失败，请稍后重试。")).not.toBeInTheDocument();
  });

  it("上传请求失败后仍刷新列表，以显示服务端已保存的解析失败资料且不乐观插行", async () => {
    const failedSaved = { ...failedRecord, file_name: "队列失败.md", file_format: "md" };
    const list = vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [failedSaved] });
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValue(new ApiRequestError(502, "DATASET_QUEUE_UNAVAILABLE"));
    render(<DatasetsPage />);
    const dialog = openUploadDialog();
    selectFiles([new File(["# x"], "队列失败.md")]);
    fireEvent.click(within(dialog).getByRole("button", { name: "上传资料" }));

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File)));
    expect(await screen.findByText("队列失败")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
    expect(screen.getByText("1 份资料已保存但解析提交失败，请在列表中重新解析。")).toBeInTheDocument();
  });

  it("上传期间重复提交不会产生重复请求", async () => {
    let resolveUpload: ((value: DatasetRecord) => void) | undefined;
    const upload = vi.spyOn(api, "uploadDataset").mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve; }),
    );
    render(<DatasetsPage />);
    const dialog = openUploadDialog();
    selectFiles([new File(["x"], "资料.md")]);
    const submit = within(dialog).getByRole("button", { name: "上传资料" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(upload).toHaveBeenCalledTimes(1);
    resolveUpload?.(record);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
  });

  it("将资料上传与操作错误映射为稳定文案", () => {
    expect(datasetUploadErrorMessage(new ApiRequestError(413, "DATASET_TOO_LARGE"), "默认文案")).toContain("10 MB");
    expect(datasetUploadErrorMessage(new ApiRequestError(400, "UNSUPPORTED_DATASET_FORMAT"), "默认文案")).toContain("DOCX");
  });
});
