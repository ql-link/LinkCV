// 为根 README 生成界面截图：真实 Web 组件 + landing-demo.html 的内存虚构数据。
// 先启动仅前端的 Vite：npm --prefix apps/web run dev -- --port 5188
// 再运行：node apps/web/scripts/capture-readme.mjs --url http://127.0.0.1:5188
// 只更新指定图片：追加 --only resume-editor,ai-assistant
// 不需要后端、中间件或真实账号；所有 /api 请求在浏览器中拦截。
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (
  value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]]] : pairs
), []));
const base = new URL(args.url ?? "http://127.0.0.1:5188");
const selected = args.only ? new Set(args.only.split(",")) : null;
const includes = name => !selected || selected.has(name);
if (!["http:", "https:"].includes(base.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
  throw new Error("README capture requires a local Vite origin");
}
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/assets/readme");
const browser = await chromium.launch({
  executablePath: args.chrome ?? process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});

try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5,
    reducedMotion: "reduce", colorScheme: "light", timezoneId: "Asia/Shanghai", locale: "zh-CN",
  });
  // 官网只需匿名登录态；演示工作区在页面内处理 API。
  // 该拦截同时防止未来未接入演示的操作访问真实后端。
  await context.route(url => url.pathname.startsWith("/api/"), route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: path === "/api/auth/me" ? 200 : 501,
      contentType: "application/json",
      body: JSON.stringify(path === "/api/auth/me" ? { user: null } : { error: "README_CAPTURE_ISOLATED" }),
    });
  });
  let page;
  const pageErrors = [];
  async function freshPage() {
    if (page) await page.close();
    pageErrors.length = 0;
    page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.clock.setFixedTime(new Date("2026-10-06T09:30:00+08:00"));
  }

  async function settle() {
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => !document.querySelector(
      ".workspace-route-loading, .v3-skel, [class*='skeleton'], [aria-busy='true']",
    ), null, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1000);
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  }
  async function open(path) {
    await freshPage();
    const params = new URLSearchParams({ locale: "zh-CN", path });
    await page.goto(`${base.origin}/landing-demo.html?${params}`);
    await settle();
    await page.locator("[data-demo-route]").waitFor();
  }
  async function save(name) {
    await page.mouse.move(1435, 895);
    // Chromium 的 Canvas 编码器输出 WebP，保留截图实际像素与尺寸。
    const png = await page.screenshot({ animations: "disabled" });
    const webp = await page.evaluate(async source => {
      const image = new Image();
      image.src = `data:image/png;base64,${source}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas.toDataURL("image/webp", 0.9).split(",")[1];
    }, png.toString("base64"));
    const bytes = Buffer.from(webp, "base64");
    await writeFile(resolve(output, `${name}.webp`), bytes);
    console.log(`${name}.webp: ${Math.round(bytes.length / 1024)} KB`);
  }

  if (includes("landing")) {
    await freshPage();
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${base.origin}/home`);
    await settle();
    await page.locator(".fl-hero-stage img.fl-demo-page").waitFor();
    await save("landing");
  }

  for (const [name, path] of [
    ["resume-templates", "/templates"],
    ["career-board", "/career/applications"],
    ["interview-schedule", "/career/schedule"],
    ["mock-interview", "/mock-interviews"],
    ["datasets", "/datasets"],
  ]) {
    if (!includes(name)) continue;
    await open(path);
    if (name === "career-board") {
      // 沿真实看板横向滚动，展示笔试、面试与 Offer 附近的进程。
      await page.locator(".career-applications-board").evaluate(board => {
        const interview = board.querySelector('[data-column-key="interview"]');
        if (!interview) throw new Error("Demo interview column is missing");
        board.scrollLeft = interview.getBoundingClientRect().left - board.getBoundingClientRect().left - 220;
      });
      await page.waitForTimeout(300);
    }
    await save(name);
  }

  if (includes("resume-editor")) {
    await open("/resumes/landing-demo-resume/edit");
    if (!await page.locator(".wb3-type-panel").isVisible()) {
      await page.getByRole("button", { name: "排版", exact: true }).click();
    }
    await page.locator(".wb3-type-panel").waitFor();
    await settle();
    await page.waitForFunction(() => {
      const panel = document.querySelector(".wb3-drawer");
      return panel && Number(getComputedStyle(panel).opacity) > 0.99;
    });
    await page.waitForTimeout(2000);
    await save("resume-editor");
  }

  if (includes("ai-assistant")) {
    await open("/assistant");
    await page.getByRole("textbox", { name: "告诉助手你想完成什么" }).fill("帮我优化审批配置项目经历，保留原有事实，让行动和结果更清楚。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByRole("button", { name: "采用", exact: true }).waitFor({ timeout: 30_000 });
    await settle();
    await save("ai-assistant");
  }
  await context.close();
} finally {
  await browser.close();
}
