import "./bootstrap";
import React from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import "@/design-system/tokens.css";
import "@/design-system/fonts.css";
import "@/design-system/utilities.css";
import "@/app.css";
import "@/muse-templates.css";
import "@/features/preview/print/resume-fonts.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/noto-serif-sc/600.css";
import "./demo.css";
import { DemoApp } from "./DemoApp";

createRoot(document.getElementById("root")!).render(<React.StrictMode><DemoApp /></React.StrictMode>);
