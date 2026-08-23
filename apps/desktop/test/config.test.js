const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_DEV_URL,
  DEFAULT_PRODUCTION_ORIGIN,
  isLoopbackHostname,
  isSameOrigin,
  resolveDesktopTarget,
  shouldAllowNavigation,
} = require("../dist/config.cjs");

test("package 模式默认加载生产源且无告警", () => {
  const target = resolveDesktopTarget("package", {});
  assert.equal(target.loadUrl, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.deepEqual(target.warnings, []);
});

test("package 模式接受 https 覆盖并规范化为源", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "https://dev.linkresume.cn/some/path",
  });
  assert.equal(target.origin, "https://dev.linkresume.cn");
  assert.equal(target.loadUrl, "https://dev.linkresume.cn");
  assert.deepEqual(target.warnings, []);
});

test("package 模式接受回环地址的 http 覆盖", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "http://127.0.0.1:4173",
  });
  assert.equal(target.origin, "http://127.0.0.1:4173");
  assert.deepEqual(target.warnings, []);
});

test("package 模式对非 http(s) 协议回落默认并告警", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "ftp://example.com",
  });
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.warnings.length, 1);
  assert.match(target.warnings[0], /LINKCV_DESKTOP_ORIGIN/);
});

test("package 模式对非回环 http 覆盖回落默认并告警", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "http://example.com",
  });
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.warnings.length, 1);
});

test("package 模式对非法 URL 回落默认并告警", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "not a url",
  });
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.warnings.length, 1);
});

test("dev 模式默认加载本地 Vite 开发服务器", () => {
  const target = resolveDesktopTarget("dev", {});
  assert.equal(target.loadUrl, DEFAULT_DEV_URL);
  assert.equal(target.origin, DEFAULT_DEV_URL);
  assert.deepEqual(target.warnings, []);
});

test("dev 模式接受环境覆盖并在非法值时回落", () => {
  const overridden = resolveDesktopTarget("dev", {
    LINKCV_DESKTOP_DEV_URL: "http://localhost:5174",
  });
  assert.equal(overridden.loadUrl, "http://localhost:5174");

  const fallback = resolveDesktopTarget("dev", {
    LINKCV_DESKTOP_DEV_URL: "javascript:alert(1)",
  });
  assert.equal(fallback.loadUrl, DEFAULT_DEV_URL);
  assert.equal(fallback.warnings.length, 1);
});

test("shouldAllowNavigation 放行目标源与 about:blank，拦截跨源", () => {
  const target = resolveDesktopTarget("package", {});
  assert.equal(shouldAllowNavigation("https://linkresume.cn/resumes", target), true);
  assert.equal(shouldAllowNavigation("about:blank", target), true);
  assert.equal(shouldAllowNavigation("https://evil.example.com", target), false);
  assert.equal(shouldAllowNavigation("not a url", target), false);

  const dev = resolveDesktopTarget("dev", {});
  assert.equal(shouldAllowNavigation("http://127.0.0.1:5173/login", dev), true);
  assert.equal(shouldAllowNavigation("https://linkresume.cn", dev), false);
});

test("isSameOrigin 忽略路径与查询只比较源", () => {
  assert.equal(isSameOrigin("https://a.com/x?y=1", "https://a.com"), true);
  assert.equal(isSameOrigin("https://a.com", "https://b.com"), false);
});

test("isLoopbackHostname 识别常见回环主机名", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("127.10.20.30"), true);
  assert.equal(isLoopbackHostname("[::1]"), true);
  assert.equal(isLoopbackHostname("example.com"), false);
  assert.equal(isLoopbackHostname("192.168.1.2"), false);
});
