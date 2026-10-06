// 生成落地页首屏演示用的静态截图。
// 用法：先启动 Web 开发服务（只需前端），再运行
//   node scripts/capture-landing-demo.mjs [--url http://127.0.0.1:5173] [--chrome /path/to/chrome]
// 产物写入 src/features/landing/demo-shots/<locale>/：侧栏未选中 / 已选中两张图、各页面内容图和 layout.json。
// 截图来自 landing-demo.html：真实产品组件 + 内存中的虚构数据（DemoRuntime），不访问任何后端。
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, list) => (value.startsWith("--") ? [...pairs, [value.slice(2), list[index + 1]]] : pairs), []));
const baseUrl = (args.url ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const chrome = args.chrome ?? process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const outRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/landing/demo-shots");

// 画面尺寸与落地页 HeroDemo 一致：1440×900 视口，侧栏宽 216。
const viewport = { width: 1440, height: 900 };
const sidebarWidth = 216;
const scale = 1.6;
// 周二上午，岗位看板与面试日程里“今天”的安排都能看到。
const fixedTime = new Date("2026-10-06T09:30:00+08:00");

const pages = [
  { key: "home", path: "/assistant", section: "home" },
  { key: "resumes", path: "/resumes", section: "resumes" },
  { key: "templates", path: "/templates", section: "templates" },
  { key: "jobs", path: "/career/applications", section: "jobs" },
  { key: "schedule", path: "/career/schedule", section: "schedule" },
  { key: "mock", path: "/mock-interviews", section: "mock" },
  { key: "datasets", path: "/datasets", section: "datasets" },
  ...["demo-chat-project", "demo-chat-interview", "demo-chat-jd", "demo-chat-intro"].map((id, index) => ({ key: `chat-${index}`, path: `/assistant/${id}`, section: "home", session: id })),
];

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => !document.querySelector(".workspace-route-loading, .v3-skel, [class*='skeleton'], [aria-busy='true']"), null, { timeout: 30_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

async function toWebp(page, png) {
  return Buffer.from(await page.evaluate(async source => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.86).split(",")[1];
  }, png.toString("base64")), "base64");
}

const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
try {
  for (const locale of ["zh-CN", "en-US"]) {
    const outDir = resolve(outRoot, locale);
    await mkdir(outDir, { recursive: true });
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale, reducedMotion: "reduce", timezoneId: "Asia/Shanghai", locale });
    const page = await context.newPage();
    await page.clock.setFixedTime(fixedTime);
    const open = async (path, sidebar) => {
      await page.goto(`${baseUrl}/landing-demo.html?${new URLSearchParams({ locale, path, sidebar })}`);
      await settle(page);
    };
    const save = async (name, clip) => {
      const png = await page.screenshot({ clip });
      await writeFile(resolve(outDir, `${name}.webp`), await toWebp(page, png));
    };

    // 侧栏：两种状态各一张，并记录可点击行的位置
    await open("/assistant", "active");
    await save("sidebar-active", { x: 0, y: 0, width: sidebarWidth, height: viewport.height });
    await open("/assistant", "neutral");
    await save("sidebar", { x: 0, y: 0, width: sidebarWidth, height: viewport.height });
    const rows = await page.evaluate(() => {
      const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
      const nav = [...document.querySelectorAll(".v3-side-nav a.v3-side-row")].map(element => ({ href: new URL(element.href).pathname, label: element.textContent.trim(), ...box(element) }));
      const sessions = [...document.querySelectorAll(".v3-side-session")].map(element => ({ label: element.textContent.trim(), ...box(element) }));
      const create = box(document.querySelector(".v3-side-new"));
      return { nav, sessions, create };
    });

    for (const item of pages) {
      await open(item.path, "neutral");
      await save(item.key, { x: sidebarWidth, y: 0, width: viewport.width - sidebarWidth, height: viewport.height });
    }

    const layout = {
      viewport, sidebarWidth,
      create: rows.create,
      nav: pages.filter(item => !item.session).map(item => ({ key: item.key, ...rows.nav.find(row => row.href === item.path) })),
      sessions: pages.filter(item => item.session).map((item, index) => ({ key: item.key, ...rows.sessions[index] })),
    };
    await writeFile(resolve(outDir, "layout.json"), `${JSON.stringify(layout, null, 2)}\n`);
    await context.close();
    console.log(`${locale}: ${pages.length} pages captured`);
  }
} finally {
  await browser.close();
}
