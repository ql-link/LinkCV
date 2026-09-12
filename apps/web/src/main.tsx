import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ObservabilityBoundary } from "./features/observability/ObservabilityBoundary";
import { installCryptoRandomUuid } from "./utils/randomUuid";
import "./styles.css";
import "./design-system/tokens.css";
import "./design-system/utilities.css";
import "./app.css";
import "./components/ui/layout-patterns.css";
import "./features/preview/print/resume-fonts.css";

installCryptoRandomUuid();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ObservabilityBoundary>
      <App />
    </ObservabilityBoundary>
  </React.StrictMode>,
);
