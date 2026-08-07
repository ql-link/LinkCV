import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ObservabilityBoundary } from "./features/observability/ObservabilityBoundary";
import "@callmebill/lxgw-wenkai-web/lxgwwenkai-regular/result.css";
import "./styles.css";
import "./design-system/tokens.css";
import "./app.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ObservabilityBoundary>
      <App />
    </ObservabilityBoundary>
  </React.StrictMode>,
);
