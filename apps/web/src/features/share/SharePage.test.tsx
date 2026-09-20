import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type PublicSharePayload } from "../../api/client";
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
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("SharePage", () => {
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
    expect(screen.getByLabelText("linkresume").querySelector(".ui-brand-wordmark")).toBeInTheDocument();
    const shareNote = screen.getByText("由 于晏 分享");
    expect(shareNote).toBeInTheDocument();
    expect(shareNote.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "访问 LinkResume" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button", { name: "打印" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载 PDF" })).toBeInTheDocument();
    expect(screen.queryByText("由 linkresume 生成")).not.toBeInTheDocument();
    // 默认简历内容含姓名「张三」；仅渲染正文，不包含私密字段入口
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "虚构头像" })).toHaveAttribute(
      "src",
      "data:image/png;base64,ZmFrZQ==",
    );
    expect(screen.getByLabelText("分享简历内容")).toHaveClass(
      "theme-classic-technical",
    );
    expect(screen.getByLabelText("分享简历内容")).toHaveClass("smart-one-page");
    expect(screen.getByLabelText("分享简历内容")).toHaveAttribute(
      "style",
      expect.stringContaining("--preview-accent:#202632"),
    );
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
    download.click();

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledWith(
      "token/123",
      expect.any(AbortSignal),
    ));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:share-pdf");
    expect(print).not.toHaveBeenCalled();
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

    await waitFor(() => expect(screen.getByText("张三")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "下载 PDF" })).not.toBeInTheDocument();
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it("公开读取失败时统一显示失效页", async () => {
    mockedFetch.mockRejectedValue(new Error("SHARE_LINK_UNAVAILABLE"));
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByText("这条分享链接已失效")).toBeInTheDocument());
    expect(screen.getByRole("main")).toHaveAttribute("data-ui-theme", "light");
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });
});
