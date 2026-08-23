import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import {
  isExternalHttpUrl,
  resolveDesktopTarget,
  shouldAllowNavigation,
} from "./config";

const target = resolveDesktopTarget(
  process.env.LINKCV_DESKTOP_MODE === "dev" ? "dev" : "package",
  process.env,
);
for (const warning of target.warnings) {
  console.warn(`[linkcv-desktop] ${warning}`);
}

/** Electron 在导航被取代时上报的 errorCode（ABORTED），不是加载失败。 */
const ABORTED_ERROR_CODES = new Set([-3]);

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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
