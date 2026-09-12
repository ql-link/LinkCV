import type { Mermaid, MermaidConfig } from "mermaid";

import { DATASET_MERMAID_PLACEHOLDER_SELECTOR } from "./datasetMarkdown";

const mermaidConfig: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  suppressErrorRendering: true,
  maxTextSize: 50_000,
  maxEdges: 500,
  // Keep these settings out of diagram-level directives as well as the
  // top-level configuration, so untrusted Markdown cannot loosen them.
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "htmlLabels",
    "maxTextSize",
    "suppressErrorRendering",
    "maxEdges",
  ],
};

const fallbackErrorMessage = "Mermaid 图表渲染失败，已保留源代码。";
let mermaidModulePromise: Promise<Mermaid> | null = null;
let renderSequence = 0;

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import("mermaid")
      .then(({ default: mermaid }) => {
        if (!mermaid) throw new Error("Mermaid module has no default export");
        return mermaid;
      })
      .catch((error) => {
        mermaidModulePromise = null;
        throw error;
      });
  }
  return mermaidModulePromise;
}

function getFallback(placeholder: HTMLElement) {
  return placeholder.querySelector<HTMLElement>(".dataset-mermaid-fallback");
}

function showFallback(placeholder: HTMLElement) {
  const fallback = getFallback(placeholder);
  if (!fallback) return;

  if (!placeholder.querySelector(".dataset-mermaid-error")) {
    const error = document.createElement("p");
    error.className = "dataset-mermaid-error";
    error.textContent = fallbackErrorMessage;
    placeholder.insertBefore(error, fallback);
  }
  placeholder.dataset.mermaidState = "fallback";
}

async function renderPlaceholder(
  mermaid: Mermaid,
  placeholder: HTMLElement,
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) return;
  const source = getFallback(placeholder)?.querySelector("code")?.textContent ?? "";
  const id = `dataset-mermaid-${++renderSequence}`;

  try {
    const result = await mermaid.render(id, source);
    if (signal?.aborted) return;
    if (!result.svg.trim()) throw new Error("Mermaid returned empty SVG");

    placeholder.innerHTML = result.svg;
    placeholder.dataset.mermaidState = "rendered";
    placeholder.removeAttribute("data-mermaid-placeholder");
  } catch {
    if (!signal?.aborted) showFallback(placeholder);
  }
}

/** Render Mermaid placeholders after Markdown has already been mounted. */
export async function renderDatasetMermaid(container: HTMLElement, signal?: AbortSignal) {
  if (signal?.aborted) return;
  const placeholders = Array.from(
    container.querySelectorAll<HTMLElement>(DATASET_MERMAID_PLACEHOLDER_SELECTOR),
  );
  if (placeholders.length === 0) return;

  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
    if (signal?.aborted) return;
    mermaid.initialize(mermaidConfig);
  } catch {
    if (!signal?.aborted) placeholders.forEach(showFallback);
    return;
  }

  await Promise.all(placeholders.map((placeholder) => renderPlaceholder(mermaid, placeholder, signal)));
}
