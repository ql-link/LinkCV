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
// Preserve Inter for existing user-selected resume font stacks.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
// Register local product fonts before rendering to reduce fallback reflow.
import "./design-system/fonts.css";
import "@fontsource/noto-serif-sc/600.css";

installCryptoRandomUuid();

if (typeof document !== "undefined" && "fonts" in document) {
  for (const font of ["400 13px Lora", "500 13px Lora", "600 28px Poppins", "500 12px Poppins", "600 28px \"Noto Serif SC\""]) {
    void document.fonts.load(font, "Account Aa 0123456789 年月日模板简历").catch(() => undefined);
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ObservabilityBoundary>
      <App />
    </ObservabilityBoundary>
  </React.StrictMode>,
);
