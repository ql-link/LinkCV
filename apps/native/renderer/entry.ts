// 原生客户端的「简历纸面」渲染页。
//
// Mac（WKWebView）和 Windows（WebView2）都只在纸面这一块嵌入网页视图，
// 加载本文件打包出的单个离线 HTML。渲染逻辑直接复用 Web 端的
// renderResumePrintDocument 与同一份简历样式，保证三端纸面和 PDF 一致。
//
// 与原生层的协议（protocol_version 1）：
//   原生 → 页面：调用 window.linkresume.render(request)，request 同 ResumeRenderRequestV1
//   页面 → 原生：postMessage({ type: "ready" }) / { type: "rendered", heightPx } / { type: "error", message }
import applicationStyles from "../../web/src/app.css?raw";
import baseStyles from "../../web/src/styles.css?raw";
import printStyles from "../../web/src/features/preview/print/resume-print.css?raw";
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
    linkresume: { render(request: ResumeRenderRequestV1): void };
  }
}

function post(message: NativeMessage) {
  // WKWebView 走 messageHandlers，WebView2 走 chrome.webview；两者都没有时（浏览器里调试）打到控制台
  if (window.webkit?.messageHandlers?.linkresume) window.webkit.messageHandlers.linkresume.postMessage(message);
  else if (window.chrome?.webview) window.chrome.webview.postMessage(message);
  else console.info("[linkresume-renderer]", message);
}

function render(request: ResumeRenderRequestV1) {
  try {
    const root = document.getElementById("paper-root");
    if (!root) throw new Error("RENDERER_ROOT_MISSING");
    root.innerHTML = renderResumePrintDocument({
      ...request,
      assets: { ...BUNDLED_ASSETS, ...(request.assets ?? {}) },
    });
    // 等一帧让排版落定，再把纸面实际高度告诉原生层（原生层据此决定缩放和滚动范围）
    requestAnimationFrame(() => {
      const paper = root.firstElementChild as HTMLElement | null;
      post({ type: "rendered", heightPx: Math.ceil(paper?.getBoundingClientRect().height ?? 0) });
    });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

const style = document.createElement("style");
style.textContent = `${baseStyles}\n${applicationStyles}\n${printStyles}\nhtml,body{margin:0;background:transparent}`;
document.head.appendChild(style);

window.linkresume = { render };
post({ type: "ready", protocol: RESUME_RENDER_PROTOCOL_VERSION });
