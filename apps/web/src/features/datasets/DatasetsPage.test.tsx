import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type DatasetRecord } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { DatasetsPage, datasetUploadErrorMessage } from "./DatasetsPage";

const record: DatasetRecord = {
  id: "1",
  file_name: "岗位要求.md",
  file_format: "md",
  file_size: 1024,
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

    expect(await screen.findByText("资料库还是空的")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "上传第一份资料" }),
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
  });

  it("选择文件后展示预览，确认后才上传", async () => {
    const list = vi
      .spyOn(api, "listDatasets")
      .mockResolvedValue({ datasets: [] });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(record);
    render(<DatasetsPage />);
    await screen.findByText("资料库还是空的");

    const file = new File(["# 岗位要求"], "岗位要求.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByLabelText("待上传的文件")).toBeInTheDocument();
    expect(screen.getByText("岗位要求.md")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "上传" }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    expect(await screen.findByText(/已上传「岗位要求\.md」/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("取消选择后不上传", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("资料库还是空的");

    const file = new File(["# 岗位要求"], "岗位要求.md", {
      type: "text/markdown",
    });
    fireEvent.change(screen.getByLabelText("选择资料文件"), {
      target: { files: [file] },
    });

    expect(await screen.findByLabelText("待上传的文件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByLabelText("待上传的文件")).not.toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("空文件在上传前被拦截", async () => {
    const upload = vi.spyOn(api, "uploadDataset");
    render(<DatasetsPage />);
    await screen.findByText("资料库还是空的");

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
    await screen.findByText("资料库还是空的");

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
    await screen.findByText("资料库还是空的");

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
      expect(screen.getByText("资料库还是空的")).toBeInTheDocument();

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
      fireEvent.click(screen.getByRole("button", { name: "上传" }));
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
