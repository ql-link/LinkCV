import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import {
  BuiltInDesktopEnv,
  isExternalHttpUrl,
  resolveDesktopTarget,
  shouldAllowNavigation,
} from "./config";

function readBuiltInEnv(): BuiltInDesktopEnv | null {
  try {
    const raw = readFileSync(join(__dirname, "built-in-env.json"), "utf8");
    const parsed = JSON.parse(raw) as BuiltInDesktopEnv;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const target = resolveDesktopTarget(
  process.env.LINKCV_DESKTOP_MODE === "dev" ? "dev" : "package",
  process.env,
  readBuiltInEnv(),
);
if (target.preset === "development") {
  console.log(`[linkcv-desktop] 开发版客户端，连接 ${target.origin}`);
}
for (const warning of target.warnings) {
  console.warn(`[linkcv-desktop] ${warning}`);
}

/** Electron 在导航被取代时上报的 errorCode（ABORTED），不是加载失败。 */
const ABORTED_ERROR_CODES = new Set([-3]);

/**
 * 无标题栏模式下提供窗口拖动区：顶部一条透明覆盖层。
 * 同时隐藏滚动条（保留滚动能力），呈现原生应用观感。
 * 注入由壳完成，不修改业务页面代码；挡住的是页面顶部 34px 的空白上缘。
 */
const SHELL_CSS = `
body::after {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 34px;
  -webkit-app-region: drag;
  z-index: 2147483646;
}
::-webkit-scrollbar {
  width: 0;
  height: 0;
}
`;

let mainWindow: BrowserWindow | null = null;

function showErrorPage(win: BrowserWindow, targetUrl: string): void {
  void win.loadFile(join(__dirname, "error.html"), {
    query: { target: targetUrl },
  });
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    title: "LinkCV",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on("did-finish-load", () => {
    void win.webContents.insertCSS(SHELL_CSS).catch(() => undefined);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (shouldAllowNavigation(url, target)) return;
    event.preventDefault();
    if (isExternalHttpUrl(url)) void shell.openExternal(url);
  });

  win.webContents.on(
    "did-fail-load",
    (event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || ABORTED_ERROR_CODES.has(errorCode)) return;
      // 只对目标源自身的失败展示错误页，避免错误页自身加载失败形成循环。
      if (!validatedURL.startsWith(target.origin)) return;
      showErrorPage(win, target.loadUrl);
    },
  );

  void win.loadURL(target.loadUrl);
  win.on("closed", () => {
    mainWindow = null;
  });
  mainWindow = win;
}

void app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (mainWindow === null) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
