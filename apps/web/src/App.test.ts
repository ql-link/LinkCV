import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api/client";
import { resumeLoadErrorMessage } from "./App";

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
