// 原生客户端的「简历纸面」渲染页。
//
// Mac（WKWebView）和 Windows（WebView2）都只在纸面这一块嵌入网页视图，
// 加载本文件打包出的单个离线 HTML。渲染逻辑直接复用 Web 端的
// renderResumePrintDocument 与同一份模板样式。字体、换行与分页仍受渲染引擎影响。
//
// 与原生层的协议（protocol_version 1）：
//   原生 → 页面：调用 window.linkresume.render(request)，request 同 ResumeRenderRequestV1
//   页面 → 原生：postMessage({ type: "ready" }) / { type: "rendered", heightPx } / { type: "error", message }
import applicationStyles from "../../web/src/app.css?raw";
import baseStyles from "../../web/src/styles.css?raw";
import printStyles from "../../web/src/features/preview/print/resume-print.css?raw";
import museStyles from "../../web/src/muse-templates.css?raw";
import administrativeAvatar from "../../web/public/templates/avatar-administrative.png";
import campusAvatar from "../../web/public/templates/avatar-campus.png";
import templateAvatar from "../../web/public/templates/avatar-cat.jpg";
import civicAvatar from "../../web/public/templates/avatar-civic.png";
import creativeAvatar from "../../web/public/templates/avatar-creative.png";
import {
  renderResumePrintDocument,
  RESUME_RENDER_PROTOCOL_VERSION,
  type ResumeRenderRequestV1,
} from "../../web/src/features/preview/print/resumePrintDocument";

type NativeMessage =
  | { type: "ready"; protocol: number }
  | { type: "rendered"; heightPx: number }
  | { type: "error"; message: string };

// 内置模板头像随包内联，纸面不发任何网络请求
const BUNDLED_ASSETS: Record<string, string> = {
  "/templates/avatar-administrative.png": administrativeAvatar,
  "/templates/avatar-administrative.svg": administrativeAvatar,
  "/templates/avatar-campus.png": campusAvatar,
  "/templates/avatar-campus.svg": campusAvatar,
  "/templates/avatar-cat.jpg": templateAvatar,
  "/templates/avatar-civic.png": civicAvatar,
  "/templates/avatar-civic.svg": civicAvatar,
  "/templates/avatar-creative.png": creativeAvatar,
  "/templates/avatar-creative.svg": creativeAvatar,
};

declare global {
  interface Window {
    webkit?: { messageHandlers?: { linkresume?: { postMessage(message: unknown): void } } };
    chrome?: { webview?: { postMessage(message: unknown): void } };
    linkresume: { render(request: ResumeRenderRequestV1): void; clear(): void };
  }
}

function post(message: NativeMessage) {
  // WKWebView 走 messageHandlers，WebView2 走 chrome.webview；两者都没有时（浏览器里调试）打到控制台
  if (window.webkit?.messageHandlers?.linkresume) window.webkit.messageHandlers.linkresume.postMessage(message);
  else if (window.chrome?.webview) window.chrome.webview.postMessage(message);
  else console.info("[linkresume-renderer]", message);
}

let generation = 0;
async function render(request: ResumeRenderRequestV1) {
  const current = ++generation;
  try {
    if (request.protocol_version !== undefined && request.protocol_version !== RESUME_RENDER_PROTOCOL_VERSION) {
      throw new Error("RENDERER_PROTOCOL_UNSUPPORTED");
    }
    const root = document.getElementById("paper-root");
    if (!root) throw new Error("RENDERER_ROOT_MISSING");
    root.innerHTML = renderResumePrintDocument({
      ...request,
      assets: { ...BUNDLED_ASSETS, ...(request.assets ?? {}) },
    });
    const paper = root.firstElementChild as HTMLElement | null;
    if (!paper || paper.dataset.renderState === "unavailable") throw new Error("RENDERER_LAYOUT_UNAVAILABLE");
    // 图片与字体加载后再报告高度；快速切换时只报告最新请求。
    await document.fonts.ready;
    let missingImages = 0;
    await Promise.all(Array.from(root.querySelectorAll("img"), async (image) => {
      try { await image.decode(); }
      catch {
        missingImages += 1;
        image.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4c+bMfwAIMANkhLK+mwAAAABJRU5ErkJggg==";
        image.alt = "图片不可用";
        await image.decode();
      }
    }));
    // 后台窗口可能暂停动画帧；测量不能因此一直等待。
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 100);
      requestAnimationFrame(() => { window.clearTimeout(timer); resolve(); });
    });
    if (current !== generation) return;
    post({ type: "rendered", heightPx: Math.ceil(paper.getBoundingClientRect().height) });
    if (missingImages) post({ type: "error", message: "部分图片不可用，正文仍可预览。" });
  } catch (error) {
    if (current === generation) post({ type: "error", message: "纸面预览失败，请检查模板布局与图片资源。" });
  }
}

const style = document.createElement("style");
style.textContent = `${baseStyles}\n${applicationStyles}\n${printStyles}\n${museStyles}\nhtml,body{margin:0;background:transparent}\nhtml[data-linkresume-native-renderer] [data-resume-print-document]{height:auto;overflow:visible}`;
document.head.appendChild(style);

// 原生 evaluateJavaScript 不接受 Promise 返回值，桥接入口保持同步 void。
window.linkresume = {
  render(request) { void render(request); },
  clear() {
    generation += 1;
    document.getElementById("paper-root")?.replaceChildren();
  },
};
post({ type: "ready", protocol: RESUME_RENDER_PROTOCOL_VERSION });
