import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { JobSmartImportDialog } from "./JobSmartImportDialog";

afterEach(() => vi.restoreAllMocks());

describe("JobSmartImportDialog", () => {
  it("默认打开岗位文字并提供可访问的三栏切换", () => {
    render(<JobSmartImportDialog unified onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "岗位导入方式" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "手工填写" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "粘贴岗位文字" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "上传岗位截图" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByLabelText("岗位文字")).toBeInTheDocument();
    expect(screen.queryByText("岗位信息", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("系统只提取岗位核心信息，创建后仍可在求职记录中修改。")).toBeInTheDocument();
  });

  it("在同一个弹窗内切换到紧凑手工表单", () => {
    render(<JobSmartImportDialog unified onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "导入岗位" });

    fireEvent.click(screen.getByRole("tab", { name: "手工填写" }));

    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBe(dialog);
    expect(screen.getByRole("tab", { name: "手工填写" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("职位名称")).toBeInTheDocument();
    expect(screen.getByLabelText("公司名称")).toBeInTheDocument();
    expect(screen.getByLabelText("职位描述")).not.toBeRequired();
    expect(screen.getByText("必填 2 项")).toBeInTheDocument();
    for (const heading of ["基本信息", "任职要求", "工作与薪酬", "公司与联系人", "来源与备注"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    for (const label of [
      "技能", "用工类型", "学历要求", "经验要求", "工作城市", "详细地址", "工作方式",
      "工作安排", "薪资范围", "行业", "公司规模", "融资阶段", "招聘者姓名", "招聘者职位",
      "来源链接（可选）", "个人备注",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const label of ["最低薪资", "最高薪资", "币种", "计薪周期", "每年薪资月数", "公司工商全称", "公司简介"]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
    expect(screen.getByLabelText("薪资范围").compareDocumentPosition(screen.getByLabelText("工作城市")))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByLabelText("技能").closest(".job-smart-manual-field")).not.toHaveClass("is-wide");
    expect(screen.getByLabelText("薪资范围").closest(".job-smart-manual-field")).not.toHaveClass("is-wide");
    expect(screen.getByLabelText("工作城市").closest(".job-smart-manual-field")).toHaveClass("is-wide");
    expect(screen.queryByRole("heading", { name: "薪资明细" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建岗位" })).toBeInTheDocument();
  });

  it("职位描述留空时仍可创建岗位", async () => {
    const create = vi.spyOn(api, "createJobDescription").mockResolvedValue({
      job_description: { id: "42" } as never,
    });
    render(<JobSmartImportDialog unified onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "手工填写" }));
    fireEvent.change(screen.getByLabelText("职位名称"), { target: { value: "平台工程师" } });
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "示例科技" } });
    fireEvent.click(screen.getByRole("button", { name: "创建岗位" }));

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      job_title: "平台工程师",
      company_name: "示例科技",
      description: "",
    })));
  });

  it("识别完成后在同一弹窗切到手工页并回填草稿", async () => {
    vi.spyOn(api, "parseJobDescriptionDraft").mockResolvedValue({
      draft: { job_title: "平台工程师", company_name: "示例科技", description: "负责平台建设", skills: ["Go"] },
      warnings: ["请补充工作城市。"], inputType: "text", callId: "llmcall_unified",
    });
    render(<JobSmartImportDialog unified onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "导入岗位" });
    fireEvent.change(screen.getByLabelText("岗位文字"), { target: { value: "示例岗位文字" } });
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    expect(await screen.findByDisplayValue("平台工程师")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "导入岗位" })).toBe(dialog);
    expect(screen.getByRole("tab", { name: "手工填写" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByDisplayValue("示例科技")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("请补充工作城市");
  });

  it("拒绝不受支持的图片且保留已有文字", () => {
    render(<JobSmartImportDialog onClose={vi.fn()} onParsed={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "智能填写岗位信息" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回" })).not.toBeInTheDocument();
    const text = screen.getByLabelText("岗位文字");
    fireEvent.change(text, { target: { value: "一段有效岗位文字" } });

    fireEvent.click(screen.getByRole("tab", { name: "上传岗位截图" }));
    const input = screen.getByLabelText("选择岗位截图");
    expect(input.parentElement).toHaveClass("file-upload-picker");
    expect(screen.queryByText("选择图片")).not.toBeInTheDocument();
    expect(screen.getByText(/点击此区域上传岗位截图/)).toBeInTheDocument();
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
        warnings: ["未识别出公司名称，请在创建前补充。"],
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
      ["未识别出公司名称，请在创建前补充。"],
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
