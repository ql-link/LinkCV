import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError, type PublicSharePayload } from "../../api/client";
import {
  defaultCanonicalDocument,
  defaultCanonicalPresentation,
  type LayoutPlan,
} from "../../api/resumeContract";
import { SharePage } from "./SharePage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      fetchPublicShare: vi.fn(),
      downloadPublicSharePdf: vi.fn(),
    },
  };
});

const mockedFetch = vi.mocked(api.fetchPublicShare);
const mockedDownload = vi.mocked(api.downloadPublicSharePdf);

const layoutPlan: LayoutPlan = {
  schema_version: "layout-plan.v1",
  content_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  template_key: "classic-technical-cn",
  regions: [{
    region_id: "main",
    order: 0,
    nodes: [{
      node_id: defaultCanonicalDocument.identity.node_id,
      semantic_kind: "identity",
      slot_id: "main_content",
    }],
  }],
};

const publicPayload: PublicSharePayload = {
  data: {
    ...defaultCanonicalDocument,
    identity: {
      ...defaultCanonicalDocument.identity,
      name: { node_id: "node_name000000000001", value: "张三", source_refs: [] },
      avatar: {
        node_id: "node_avatar00000000001",
        source_refs: [],
        media_kind: "avatar",
        src: "/api/resumes/1/assets/avatar.png",
        alt: "虚构头像",
        width: 96,
        width_unit: "px",
        height_px: null,
        align: null,
        system_fallback: false,
      },
    },
  },
  style: {
    ...defaultCanonicalPresentation,
    portable: {
      ...defaultCanonicalPresentation.portable,
      smart_one_page: true,
    },
    template_snapshot: {
      ...defaultCanonicalPresentation.template_snapshot,
      template_key: "classic-technical-cn",
      tokens: {
        ...defaultCanonicalPresentation.template_snapshot.tokens,
        accent_color: "#202632",
      },
      avatar: {
        ...defaultCanonicalPresentation.template_snapshot.avatar,
        visibility: "show",
      },
    },
  },
  layout_plan: layoutPlan,
  assets: {
    "/api/resumes/1/assets/avatar.png": "data:image/png;base64,ZmFrZQ==",
  },
  sharer: { nickname: "于晏", avatar_url: null },
  allow_download: true,
  expires_at: null,
  updated_at: "2026-09-26T08:00:00Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).execCommand;
});

describe("SharePage", () => {
  it.each([true, false])("HTTP 下复制当前完整网址并反馈实际结果（成功：%s）", async (success) => {
    vi.stubGlobal("navigator", {});
    let copiedText = "";
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        copiedText = (document.activeElement as HTMLTextAreaElement).value;
        return success;
      },
    });
    mockedFetch.mockResolvedValue(publicPayload);
    render(<SharePage token="token_123" />);

    fireEvent.click(await screen.findByRole("button", { name: "复制链接" }));

    expect(await screen.findByText(success ? "链接已复制" : "复制失败，请手动复制地址栏链接")).toBeInTheDocument();
    expect(copiedText).toBe(window.location.href);
    expect(document.querySelector("textarea")).toBeNull();
    if (!success) expect(screen.queryByText("链接已复制")).not.toBeInTheDocument();
  });

  it("加载中显示占位文案", () => {
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    render(<SharePage token="token_123" />);
    const loading = screen.getByRole("status", { name: "正在加载分享内容…" });
    expect(loading).toBeInTheDocument();
    expect(loading.closest('[data-ui-theme="light"]')).toBeInTheDocument();
  });

  it("成功时展示 linkresume 品牌、分享者与脱敏简历内容", async () => {
    mockedFetch.mockResolvedValue(publicPayload);
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByLabelText("linkresume")).toBeInTheDocument());
    expect(screen.getByRole("main")).toHaveAttribute("data-ui-theme", "light");
    // 品牌栏：品牌链接回到公开首页；说明里是分享者昵称 + 有效期
    expect(screen.getByRole("link", { name: "linkresume" })).toHaveAttribute("href", "/");
    expect(screen.getByText("公开分享 · 长期有效")).toBeInTheDocument();
    // 简历没填 headline：资料卡副标题显示分享者昵称
    expect(screen.getByText("由 于晏 分享")).toBeInTheDocument();
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(screen.getByText(/最后更新 09-2[67]/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载 PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制链接" })).toBeInTheDocument();
    // 已删除的入口不再出现
    expect(screen.queryByText("举报")).not.toBeInTheDocument();
    expect(screen.queryByText("在看机会")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /免费试试/ })).toHaveAttribute("href", "/");
    expect(screen.queryByText("由 linkresume 生成")).not.toBeInTheDocument();
    // 默认简历内容含姓名「张三」；仅渲染正文，不包含私密字段入口
    // 右栏资料卡的标题也是简历姓名
    expect(screen.getByRole("heading", { level: 2, name: "张三" })).toBeInTheDocument();
    expect(screen.getByLabelText("分享简历内容")).toHaveTextContent("张三");
    expect(screen.getByRole("img", { name: "虚构头像" })).toHaveAttribute(
      "src",
      "data:image/png;base64,ZmFrZQ==",
    );
    expect(screen.getByLabelText("分享简历内容")).toHaveClass(
      "theme-classic-technical",
    );
    expect(screen.getByLabelText("分享简历内容")).not.toHaveClass("smart-one-page");
    await waitFor(() => expect(screen.getByLabelText("分享简历内容")).toHaveAttribute("data-page-count", "1"));
    expect((screen.getByLabelText("分享简历内容") as HTMLElement).style.getPropertyValue("--preview-accent")).toBe("#202632");
  });

  it("下载 PDF 时调用公开服务端渲染接口而不是浏览器打印", async () => {
    const blob = new Blob(["%PDF-share"], { type: "application/pdf" });
    mockedFetch.mockResolvedValue(publicPayload);
    mockedDownload.mockResolvedValue({ blob, filename: "分享测试简历.pdf" });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:share-pdf");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<SharePage token="token/123" />);

    const download = await screen.findByRole("button", { name: "下载 PDF" });
    const paper = screen.getByLabelText("分享简历内容");
    await waitFor(() => expect(paper).toHaveAttribute("data-page-count", "1"));
    download.click();

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith(
      "token/123",
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:share-pdf");
    expect(print).not.toHaveBeenCalled();
    expect(screen.getByLabelText("分享简历内容")).toBe(paper);
  });

  it("PDF 生成失败时在按钮旁显示可见错误", async () => {
    mockedFetch.mockResolvedValue(publicPayload);
    mockedDownload.mockRejectedValue(new Error("renderer failed"));
    render(<SharePage token="token_123" />);

    (await screen.findByRole("button", { name: "下载 PDF" })).click();

    expect(await screen.findByRole("alert")).toHaveTextContent("PDF 生成失败，请稍后重试");
  });

  it("分享者关闭下载后不显示 PDF 下载入口", async () => {
    mockedFetch.mockResolvedValue({ ...publicPayload, allow_download: false });
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByLabelText("分享简历内容")).toHaveTextContent("张三"));
    expect(screen.queryByRole("button", { name: "下载 PDF" })).not.toBeInTheDocument();
    // ② 不允许下载：只保留复制链接
    expect(screen.getByRole("button", { name: "复制链接" })).toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it("统一 404 显示失效页，不能推测私密或删除原因", async () => {
    mockedFetch.mockRejectedValue(new ApiRequestError(404, "SHARE_LINK_UNAVAILABLE"));
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByText("这条分享链接已失效")).toBeInTheDocument());
    expect(screen.getByRole("main")).toHaveAttribute("data-ui-theme", "light");
    expect(screen.getByText("公开分享 · 链接不可用")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载 PDF" })).not.toBeInTheDocument();
  });

  it("明确拒绝访问的独立 fixture 显示私密态和返回当前分享的登录入口", async () => {
    mockedFetch.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN"));
    render(<SharePage token="private-fixture" />);
    expect(await screen.findByText("这份简历没有公开")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login?next=%2Fshare%2Fprivate-fixture");
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });

  it("服务或网络失败不宣称链接失效，重新加载可以恢复", async () => {
    mockedFetch.mockRejectedValueOnce(new ApiRequestError(503, "SERVICE_UNAVAILABLE")).mockResolvedValueOnce(publicPayload);
    render(<SharePage token="retry-fixture" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("分享内容暂时无法加载");
    expect(screen.queryByText("这条分享链接已失效")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByLabelText("分享简历内容")).toHaveTextContent("张三");
  });

  it("复制链接后给出提示", async () => {
    mockedFetch.mockResolvedValue(publicPayload);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<SharePage token="token_123" />);

    (await screen.findByRole("button", { name: "复制链接" })).click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(await screen.findByText("链接已复制")).toBeInTheDocument();
  });
});
