const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_DEV_URL,
  DEFAULT_DEVELOPMENT_ORIGIN,
  DEFAULT_PRODUCTION_ORIGIN,
  PACKAGE_ENTRY_PATH,
  isLoopbackHostname,
  isSameOrigin,
  resolveDesktopTarget,
  shouldAllowNavigation,
} = require("../dist/config.cjs");

test("package 模式默认以工作区为入口且无告警", () => {
  const target = resolveDesktopTarget("package", {});
  assert.equal(target.loadUrl, `${DEFAULT_PRODUCTION_ORIGIN}${PACKAGE_ENTRY_PATH}`);
  assert.equal(target.loadUrl, "https://linkresume.cn/resumes");
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.deepEqual(target.warnings, []);
});

test("package 模式接受 https 覆盖并规范化为源，入口保持工作区", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ORIGIN: "https://dev.linkresume.cn/some/path",
  });
  assert.equal(target.origin, "https://dev.linkresume.cn");
  assert.equal(target.loadUrl, "https://dev.linkresume.cn/resumes");
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

test("development 预设默认连接 Dev 环境并保持工作区入口", () => {
  const target = resolveDesktopTarget("package", { LINKCV_DESKTOP_ENV: "development" });
  assert.equal(target.preset, "development");
  assert.equal(target.origin, DEFAULT_DEVELOPMENT_ORIGIN);
  assert.equal(target.loadUrl, `${DEFAULT_DEVELOPMENT_ORIGIN}${PACKAGE_ENTRY_PATH}`);
  assert.deepEqual(target.warnings, []);
});

test("development 预设允许非回环 http 覆盖并记录不安全告警", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ENV: "development",
    LINKCV_DESKTOP_ORIGIN: "http://10.1.2.3:8080",
  });
  assert.equal(target.origin, "http://10.1.2.3:8080");
  assert.equal(target.warnings.length, 1);
  assert.match(target.warnings[0], /非安全连接/);
});

test("production 预设继续拒绝非回环 http", () => {
  const target = resolveDesktopTarget("package", {
    LINKCV_DESKTOP_ENV: "production",
    LINKCV_DESKTOP_ORIGIN: "http://100.86.10.52:18002",
  });
  assert.equal(target.preset, "production");
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.warnings.length, 1);
});

test("构建时内置环境生效且运行时覆盖优先", () => {
  const builtInOnly = resolveDesktopTarget("package", {}, {
    env: "development",
    origin: "http://100.86.10.52:18002",
  });
  assert.equal(builtInOnly.preset, "development");
  assert.equal(builtInOnly.origin, "http://100.86.10.52:18002");
  // BR7：开发版启动时保留一条非安全 http 连接告警。
  assert.deepEqual(builtInOnly.warnings, [
    "LINKCV_DESKTOP_ORIGIN 使用非回环 http 非安全连接：http://100.86.10.52:18002",
  ]);

  const runtimeOverride = resolveDesktopTarget(
    "package",
    { LINKCV_DESKTOP_ORIGIN: "https://dev.linkresume.cn" },
    { env: "development", origin: "http://100.86.10.52:18002" },
  );
  assert.equal(runtimeOverride.preset, "development");
  assert.equal(runtimeOverride.origin, "https://dev.linkresume.cn");
  assert.deepEqual(runtimeOverride.warnings, []);
});

test("非法 LINKCV_DESKTOP_ENV 按 production 处理并告警", () => {
  const target = resolveDesktopTarget("package", { LINKCV_DESKTOP_ENV: "staging" });
  assert.equal(target.preset, "production");
  assert.equal(target.origin, DEFAULT_PRODUCTION_ORIGIN);
  assert.equal(target.warnings.length, 1);
  assert.match(target.warnings[0], /LINKCV_DESKTOP_ENV/);
});

test("dev 模式标记为开发环境预设", () => {
  const target = resolveDesktopTarget("dev", {});
  assert.equal(target.preset, "development");
  assert.equal(target.loadUrl, DEFAULT_DEV_URL);
});
