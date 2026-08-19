import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { DatasetsPage, datasetUploadErrorMessage } from "./DatasetsPage";

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

describe("DatasetsPage", () => {
  it("资料为空时展示空状态", async () => {
    render(<DatasetsPage />);

    expect(await screen.findByText("先上传一份资料")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /拖拽文件到这里/ }),
    ).toBeInTheDocument();
  });

  it("上传区说明支持的格式与大小上限", async () => {
    render(<DatasetsPage />);

    expect(
      await screen.findByText(/支持 DOCX、PDF、Markdown 和 TXT/),
    ).toBeInTheDocument();
    expect(screen.getByText(/不超过 10 MB/)).toBeInTheDocument();
  });

  it("展示已上传资料的清单", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    render(<DatasetsPage />);

    expect(await screen.findByText("岗位要求.md")).toBeInTheDocument();
    expect(screen.getByText("MD")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getByText("解析完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看「岗位要求.md」的解析结果" })).toBeInTheDocument();
  });

  it("点击解析完成的资料后展示安全渲染的 Markdown", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const getContent = vi.spyOn(api, "getDatasetContent").mockResolvedValue({
      id: record.id,
      file_name: record.file_name,
      file_format: record.file_format,
      markdown: "# 解析标题\n\n- 第一项\n\n<script>window.bad = true</script>\n\n![架构图](https://example.test/a.png)",
    });
    render(<DatasetsPage />);

    const trigger = await screen.findByRole("button", { name: "查看「岗位要求.md」的解析结果" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(getContent).toHaveBeenCalledWith("1");
    expect(within(dialog).getByRole("heading", { name: "解析标题" })).toBeInTheDocument();
    expect(within(dialog).getByText("第一项")).toBeInTheDocument();
    expect(within(dialog).getByText("[图片：架构图]")).toBeInTheDocument();
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("解析结果读取失败时允许重新加载", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [record] });
    const getContent = vi.spyOn(api, "getDatasetContent")
      .mockRejectedValueOnce(new ApiRequestError(502, "DATASET_CONTENT_READ_FAILED"))
      .mockResolvedValueOnce({
        id: record.id,
        file_name: record.file_name,
        file_format: record.file_format,
        markdown: "读取成功",
      });
    render(<DatasetsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "查看「岗位要求.md」的解析结果" }));
    expect(await screen.findByText("解析结果读取失败，请稍后重试。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByText("读取成功")).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledTimes(2);
  });

  it("未解析完成的资料不提供查看入口", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({
      datasets: [{ ...record, parse_status: "processing" }],
    });
    render(<DatasetsPage />);

    await screen.findByText("解析中");
    expect(screen.queryByRole("button", { name: /查看.*解析结果/ })).not.toBeInTheDocument();
  });

  it.each([
    [{ ...record, upload_status: "uploading" as const, parse_status: null }, "排队中"],
    [{ ...record, parse_status: "processing" as const }, "解析中"],
    [{ ...record, parse_status: "succeeded" as const }, "解析完成"],
  ])("展示资料处理状态", async (dataset, label) => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({ datasets: [dataset] });
    render(<DatasetsPage />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("展示具体解析失败原因", async () => {
    vi.spyOn(api, "listDatasets").mockResolvedValue({
      datasets: [{ ...record, parse_status: "failed", failure_reason: "service_unavailable" }],
    });
    render(<DatasetsPage />);

    expect(await screen.findByText("解析失败")).toBeInTheDocument();
    expect(screen.getByText("解析服务暂不可用，请稍后重新上传。")).toBeInTheDocument();
  });

  it("选择文件后展示预览，确认后才上传", async () => {
    const list = vi
      .spyOn(api, "listDatasets")
      .mockResolvedValue({ datasets: [] });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(record);
    render(<DatasetsPage />);
    await screen.findByText("先上传一份资料");

    const file = new File(["# 岗位要求"], "岗位要求.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByLabelText("待上传的文件")).toBeInTheDocument();
    expect(screen.getByText("岗位要求.md")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "上传资料" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/已上传「岗位要求\.md」/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("取消选择后不上传", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("先上传一份资料");

    const file = new File(["# 岗位要求"], "岗位要求.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByLabelText("待上传的文件")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消" }));

    expect(screen.queryByLabelText("待上传的文件")).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("空文件在上传前被拦截", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("先上传一份资料");

    const empty = new File([], "empty.md", { type: "text/markdown" });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [empty] },
    });

    expect(await screen.findByText("文件为空，请重新选择。")).toBeInTheDocument();
    expect(screen.queryByLabelText("待上传的文件")).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("不支持的格式在上传前被拦截", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("先上传一份资料");

    const exe = new File(["MZ"], "malware.exe", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [exe] },
    });

    expect(
      await screen.findByText("仅支持 DOCX、PDF、Markdown 和 TXT 文件。"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("待上传的文件")).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("超过 10MB 的文件在上传前被拦截", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("先上传一份资料");

    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf");
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [big] },
    });

    expect(await screen.findByText(/最大支持 10 MB/)).toBeInTheDocument();
    expect(screen.queryByLabelText("待上传的文件")).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("后端错误映射为可读文案", () => {
    const tooLarge = new ApiRequestError(400, "DATASET_TOO_LARGE");
    expect(datasetUploadErrorMessage(tooLarge, "默认文案")).toContain("10 MB");
    const unsupported = new ApiRequestError(400, "UNSUPPORTED_DATASET_FORMAT");
    expect(datasetUploadErrorMessage(unsupported, "默认文案")).toContain("DOCX");
  });

  it("上传提示会在 3 秒后渐变消失", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, "uploadDataset").mockResolvedValue(record);
      render(<DatasetsPage />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("先上传一份资料")).toBeInTheDocument();

      const file = new File(["# 岗位要求"], "岗位要求.md", {
        type: "text/markdown",
      });
      fireEvent.change(screen.getByLabelText("选择资料文件"), {
        target: { files: [file] },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByLabelText("待上传的文件")).toBeInTheDocument();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "上传资料" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const toast = screen.getByText(/已上传「岗位要求\.md」/);
      expect(toast).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByText(/已上传「岗位要求\.md」/)).toBeInTheDocument();
      expect(toast.closest(".datasets-toast")).toHaveClass("is-fading");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(screen.queryByText(/已上传「岗位要求\.md」/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
