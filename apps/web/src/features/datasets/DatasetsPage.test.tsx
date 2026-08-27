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
    expect(screen.getByText("可用")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /操作菜单/ })).toHaveLength(3);
    expect(screen.queryByText("共 3 份资料")).not.toBeInTheDocument();
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

  it("点击菜单外区域会关闭菜单，点击资料行时只关闭而不打开预览", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "内容",
    });
    render(<DatasetsPage />);

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
    await waitFor(() => expect(getContent).toHaveBeenCalledWith("1"));
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

  it("上传弹窗只保留单层选择区域，选择文件后立即上传", async () => {
    const accepted = { ...record, id: "auto-upload", file_name: "自动上传.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);
    vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [accepted] });

    render(<DatasetsPage />);
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
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
    expect(await screen.findByText("自动上传")).toBeInTheDocument();
  });

  it("StrictMode 下选择文件只触发一次上传", async () => {
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "strict-mode",
      file_name: "严格模式.md",
      parse_status: "queued",
    });
    render(
      <StrictMode>
        <DatasetsPage />
      </StrictMode>,
    );
    openUploadDialog();
    selectFiles([new File(["# 严格模式"], "严格模式.md", { type: "text/markdown" })]);

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  });

  it("内置浏览器缺少 Web Crypto 时仍生成规范幂等键并自动上传", async () => {
    vi.stubGlobal("crypto", undefined);
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue({
      ...record,
      id: "fallback-key",
      file_name: "兼容浏览器.md",
      parse_status: "queued",
    });
    render(<DatasetsPage />);
    openUploadDialog();
    selectFiles([new File(["# 兼容"], "兼容浏览器.md")]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(
      expect.any(File),
      expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    ));
  });

  it("幂等键生成异常时显示反馈而不是静默清空文件", async () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("random unavailable");
    });
    render(<DatasetsPage />);
    await screen.findByText("还没有资料");
    openUploadDialog();
    selectFiles([new File(["# 失败"], "无法生成.md")]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法生成.md：无法创建上传请求，请刷新页面后重试");
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
  });

  it("失败提示展示五秒后淡出并自动移除", async () => {
    vi.useFakeTimers();
    try {
      render(<DatasetsPage />);
      openUploadDialog();
      await act(async () => {
        selectFiles([new File(["binary"], "不支持.exe")]);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole("alert")).toHaveTextContent("不支持.exe");
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByRole("alert").parentElement).toHaveClass("is-fading");
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("批量上传逐项校验、并发不超过三，失败原因显示在顶部提示条", async () => {
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
    const failedSaved = { ...failedRecord, file_name: "队列失败.md", file_format: "md" };
    const list = vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockResolvedValue({ datasets: [failedSaved] });
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValue(new ApiRequestError(502, "DATASET_QUEUE_UNAVAILABLE"));
    render(<DatasetsPage />);
    openUploadDialog();
    selectFiles([new File(["# x"], "队列失败.md")]);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(expect.any(File), expect.stringMatching(/^[0-9a-f-]{36}$/)));
    expect(await screen.findByText("队列失败")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("队列失败.md：资料已保存，但解析提交失败，请在列表中重新解析");
  });

  it("上传期间禁用文件选择和关闭按钮，避免重复提交", async () => {
    let resolveUpload: ((value: DatasetRecord) => void) | undefined;
    const upload = vi.spyOn(api, "uploadDataset").mockImplementation(
      () => new Promise((resolve) => { resolveUpload = resolve; }),
    );
    render(<DatasetsPage />);
    const dialog = openUploadDialog();
    selectFiles([new File(["x"], "资料.md")]);
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("选择资料文件")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "关闭上传窗口" })).toBeDisabled();
    expect(within(dialog).getByText("正在上传…")).toBeInTheDocument();
    resolveUpload?.(record);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
  });

  it("服务端接受后立即 upsert 正式列表并从上传框移除", async () => {
    let resolveRefresh: ((value: { datasets: DatasetRecord[] }) => void) | undefined;
    const accepted = { ...record, id: "accepted", file_name: "刚上传.md", parse_status: "queued" as const };
    vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);

    render(<DatasetsPage />);
    openUploadDialog();
    selectFiles([new File(["# x"], "刚上传.md", { type: "text/markdown" })]);

    await waitFor(() => expect(screen.getByText("刚上传")).toBeInTheDocument());
    expect(screen.getByText("等待解析")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "上传资料" })).toBeInTheDocument();

    resolveRefresh?.({ datasets: [accepted] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传资料" })).not.toBeInTheDocument());
  });

  it("列表同步失败时保留已接受行并提供重新刷新", async () => {
    const accepted = { ...record, id: "accepted-sync", file_name: "同步失败.md", parse_status: "queued" as const };
    const list = vi.spyOn(api, "listDatasets")
      .mockResolvedValueOnce({ datasets: [] })
      .mockRejectedValueOnce(new Error("list unavailable"))
      .mockResolvedValue({ datasets: [accepted] });
    vi.spyOn(api, "uploadDataset").mockResolvedValue(accepted);

    render(<DatasetsPage />);
    openUploadDialog();
    selectFiles([new File(["# x"], "同步失败.md", { type: "text/markdown" })]);

    expect(await screen.findByText("同步失败")).toBeInTheDocument();
    expect(await screen.findByText("资料已接受，但列表同步失败")).toBeInTheDocument();
    const refreshButton = screen.getByRole("button", { name: "重新刷新" });
    expect(refreshButton).toBeInTheDocument();
    fireEvent.click(refreshButton);
    await waitFor(() => expect(screen.queryByText("资料已接受，但列表同步失败")).not.toBeInTheDocument());
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("明确服务端失败后重新上传生成新幂等键", async () => {
    const accepted = { ...record, id: "retry-key", file_name: "明确失败.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(new ApiRequestError(413, "DATASET_FILE_TOO_LARGE"))
      .mockResolvedValueOnce(accepted);
    render(<DatasetsPage />);
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
    const accepted = { ...record, id: "retry-network", file_name: "网络重试.md", parse_status: "queued" as const };
    const upload = vi.spyOn(api, "uploadDataset")
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(accepted);
    render(<DatasetsPage />);
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
    render(<DatasetsPage />);
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
    render(<DatasetsPage />);

    const status = await screen.findByText("等待解析");
    expect(status).toHaveAttribute("data-status", "queued");
  });

  it("将资料上传与操作错误映射为稳定文案", () => {
    expect(datasetUploadErrorMessage(new ApiRequestError(413, "DATASET_TOO_LARGE"), "默认文案")).toContain("10 MB");
    expect(datasetUploadErrorMessage(new ApiRequestError(400, "UNSUPPORTED_DATASET_FORMAT"), "默认文案")).toContain("DOCX");
  });
});
