import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { JobSmartImportDialog } from "./JobSmartImportDialog";

afterEach(() => vi.restoreAllMocks());

describe("JobSmartImportDialog", () => {
  it("拒绝不受支持的图片且保留已有文字", () => {
    render(<JobSmartImportDialog onClose={vi.fn()} onParsed={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "智能填写岗位信息" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回" })).not.toBeInTheDocument();
    const text = screen.getByLabelText("岗位文字");
    fireEvent.change(text, { target: { value: "一段有效岗位文字" } });

    const input = screen.getByLabelText("选择岗位截图");
    fireEvent.change(input, {
      target: { files: [new File(["gif"], "job.gif", { type: "image/gif" })] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent("仅支持 PNG、JPEG 或 WebP 图片");
    expect(text).toHaveValue("一段有效岗位文字");
  });

  it("模型失败后保留文字并允许显式重试", async () => {
    const parse = vi.spyOn(api, "parseJobDescriptionDraft")
      .mockRejectedValueOnce(new ApiRequestError(504, "JD_IMPORT_PARSE_TIMEOUT"))
      .mockResolvedValueOnce({
        draft: { job_title: "后端工程师" },
        warnings: ["未识别出公司名称、职位描述，请在创建前补充。"],
        inputType: "text",
        callId: "llmcall_retry",
      });
    const parsed = vi.fn();
    render(<JobSmartImportDialog onClose={vi.fn()} onParsed={parsed} />);
    const text = screen.getByLabelText("岗位文字");
    fireEvent.change(text, { target: { value: "招聘后端工程师" } });

    fireEvent.click(screen.getByRole("button", { name: "开始识别" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("识别超时");
    expect(text).toHaveValue("招聘后端工程师");
    expect(parse).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "开始识别" }));
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(2));
    expect(parsed).toHaveBeenCalledWith(
      { job_title: "后端工程师" },
      ["未识别出公司名称、职位描述，请在创建前补充。"],
    );
  });

  it("识别中关闭会取消请求并忽略迟到结果", async () => {
    let resolveRequest:
      | ((value: Awaited<ReturnType<typeof api.parseJobDescriptionDraft>>) => void)
      | undefined;
    const parse = vi.spyOn(api, "parseJobDescriptionDraft").mockImplementation(
      ({ signal }) => new Promise((resolve, reject) => {
        resolveRequest = resolve;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );
    const onClose = vi.fn();
    const onParsed = vi.fn();
    render(
      <JobSmartImportDialog
        onClose={onClose}
        onParsed={onParsed}
      />,
    );

    fireEvent.change(screen.getByLabelText("岗位文字"), {
      target: { value: "虚构岗位内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始识别" }));
    await waitFor(() => expect(parse).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parse.mock.calls[0][0].signal?.aborted).toBe(true);
    resolveRequest?.({
      draft: { job_title: "不应回填" },
      warnings: [],
      inputType: "text",
      callId: "late",
    });
    await Promise.resolve();
    expect(onParsed).not.toHaveBeenCalled();
  });

  it("粘贴图片后切换为图片输入并显示本地预览", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    render(<JobSmartImportDialog onClose={vi.fn()} onParsed={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("岗位文字"), { target: { value: "旧文字" } });
    const image = new File(["png"], "job.png", { type: "image/png" });

    fireEvent.paste(screen.getByRole("dialog"), {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => image }],
      },
    });

    expect(screen.getByAltText("待识别岗位截图预览")).toHaveAttribute("src", "blob:preview");
    expect(screen.queryByLabelText("岗位文字")).not.toBeInTheDocument();
    expect(screen.getByText("job.png")).toBeInTheDocument();
  });
});
