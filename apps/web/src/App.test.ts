import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "./api/client";
import { App, resumeLoadErrorMessage } from "./App";
import { useResumeStore } from "./store/resumeStore";

describe("App landing routes", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    localStorage.clear();
    useResumeStore.setState({
      authStatus: "authenticated",
      user: {
        id: "user-1",
        email: "user@example.test",
        nickname: "测试用户",
        is_admin: false,
      },
      activeResumeId: null,
      dirty: false,
      hydrate: vi.fn().mockResolvedValue(undefined),
    });
  });

  it.each(["/", "/home"])("已登录访问 %s 时仍展示落地页", async (path) => {
    window.history.replaceState(null, "", path);
    render(createElement(App));

    expect(screen.getByRole("heading", { name: "把每一份经历，都写成下一份机会" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(path));
  });
});

describe("resumeLoadErrorMessage", () => {
  it("区分不存在、鉴权失效、数据格式和服务错误", () => {
    expect(resumeLoadErrorMessage(new ApiRequestError(404, "RESUME_NOT_FOUND"))).toContain("不存在");
    expect(resumeLoadErrorMessage(new ApiRequestError(401, "UNAUTHORIZED"))).toContain("重新登录");
    expect(resumeLoadErrorMessage(new ApiRequestError(500, "RESUME_SCHEMA_INVALID"))).toContain("数据格式");
    expect(resumeLoadErrorMessage(new ApiRequestError(503, "HTTP_503"))).toContain("服务暂时");
  });

  it("网络异常提示检查本地服务", () => {
    expect(resumeLoadErrorMessage(new TypeError("fetch failed"))).toContain("无法连接到服务");
  });
});
