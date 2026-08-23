import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import {
  defaultSemanticDocument,
  defaultSemanticStyle,
} from "../../api/resumeContract";
import { SharePage } from "./SharePage";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      fetchPublicShare: vi.fn(),
    },
  };
});

const mockedFetch = vi.mocked(api.fetchPublicShare);

afterEach(() => {
  vi.clearAllMocks();
});

describe("SharePage", () => {
  it("加载中显示占位文案", () => {
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    render(<SharePage token="token_123" />);
    expect(screen.getByRole("status", { name: "正在加载分享内容…" })).toBeInTheDocument();
  });

  it("成功时展示 linkresume 品牌、分享者与脱敏简历内容", async () => {
    mockedFetch.mockResolvedValue({
      data: defaultSemanticDocument,
      style: {
        ...defaultSemanticStyle,
        template_key: "classic-technical-cn",
      },
      sharer: { nickname: "于晏", avatar_url: null },
    });
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByLabelText("linkresume")).toBeInTheDocument());
    expect(screen.getByLabelText("linkresume").querySelector(".ui-brand-wordmark")).toBeInTheDocument();
    expect(screen.getByText("由 于晏 分享")).toBeInTheDocument();
    // 默认简历内容含姓名「张三」；仅渲染正文，不包含私密字段入口
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByLabelText("分享简历内容")).toHaveClass(
      "theme-classic-technical",
    );
  });

  it("公开读取失败时统一显示失效页", async () => {
    mockedFetch.mockRejectedValue(new Error("SHARE_LINK_UNAVAILABLE"));
    render(<SharePage token="token_123" />);

    await waitFor(() => expect(screen.getByText("这条分享链接已失效")).toBeInTheDocument());
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });
});
