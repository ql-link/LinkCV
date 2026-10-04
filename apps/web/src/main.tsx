import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ObservabilityBoundary } from "./features/observability/ObservabilityBoundary";
import { installCryptoRandomUuid } from "./utils/randomUuid";
import "./styles.css";
import "./design-system/tokens.css";
import "./design-system/utilities.css";
import "./app.css";
import "./muse-templates.css";
import "./components/ui/layout-patterns.css";
import "./features/preview/print/resume-fonts.css";
// V3 的数字字体（Inter）和衬线标题字体在入口就注册，并在空闲时预先加载：
// 否则第一次出现数字或标题时才开始下载，回退字体换成正式字体的那一下会让文字上下跳动。
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/noto-serif-sc/600.css";

installCryptoRandomUuid();

if (typeof document !== "undefined" && "fonts" in document) {
  for (const font of ["400 12px Inter", "500 12px Inter", "600 12px Inter", "700 12px Inter", "600 28px \"Noto Serif SC\""]) {
    void document.fonts.load(font, "0123456789 年月日模板简历").catch(() => undefined);
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ObservabilityBoundary>
      <App />
    </ObservabilityBoundary>
  </React.StrictMode>,
);
