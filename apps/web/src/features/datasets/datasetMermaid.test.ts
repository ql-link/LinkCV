import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import mermaid from "mermaid";

import { renderDatasetMarkdown } from "./datasetMarkdown";
import { renderDatasetMermaid } from "./datasetMermaid";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
  },
}));

const initialize = vi.mocked(mermaid.initialize);
const render = vi.mocked(mermaid.render);

function createContainer(source: string) {
  const container = document.createElement("article");
  container.innerHTML = renderDatasetMarkdown(source);
  document.body.append(container);
  return container;
}

beforeEach(() => {
  initialize.mockClear();
  render.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("renderDatasetMermaid", () => {
  it("does not load or initialize Mermaid when there are no placeholders", async () => {
    const container = createContainer("普通文本");

    await renderDatasetMermaid(container);

    expect(initialize).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("initializes strict Mermaid settings and replaces a placeholder with SVG", async () => {
    render.mockResolvedValue({
      svg: '<svg data-testid="diagram"></svg>',
      diagramType: "flowchart",
    });
    const container = createContainer("```mermaid\ngraph TD\nA --> B\n```");

    await renderDatasetMermaid(container);

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: "strict",
      startOnLoad: false,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
    }));
    expect(render).toHaveBeenCalledWith(expect.stringMatching(/^dataset-mermaid-\d+$/), "graph TD\nA --> B\n");
    expect(container.querySelector("svg[data-testid='diagram']")).toBeInTheDocument();
    expect(container.querySelector("[data-mermaid-placeholder]")).toBeNull();
    expect(container.querySelector(".dataset-mermaid-fallback")).toBeNull();
  });

  it("renders diagrams independently and keeps escaped source when one fails", async () => {
    render
      .mockImplementationOnce(async () => ({ svg: "<svg data-diagram=\"first\"></svg>", diagramType: "flowchart" }))
      .mockRejectedValueOnce(new Error("invalid diagram"))
      .mockImplementationOnce(async () => ({ svg: "<svg data-diagram=\"third\"></svg>", diagramType: "flowchart" }));
    const container = createContainer([
      "```mermaid",
      "graph TD",
      "A --> B",
      "```",
      "",
      "```mermaid",
      "not a diagram <unsafe>",
      "```",
      "",
      "```mermaid",
      "graph TD",
      "C --> D",
      "```",
    ].join("\n"));

    await renderDatasetMermaid(container);

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[data-diagram='first']")).toBeInTheDocument();
    expect(container.querySelector("[data-diagram='third']")).toBeInTheDocument();
    expect(container.querySelectorAll(".dataset-mermaid-error")).toHaveLength(1);
    expect(container.querySelector(".dataset-mermaid-error")).toHaveTextContent("Mermaid 图表渲染失败");
    const failedFallback = container.querySelector(".dataset-mermaid-error")?.nextElementSibling;
    expect(failedFallback).toHaveTextContent("not a diagram <unsafe>");
    expect(failedFallback?.querySelector("script")).toBeNull();
  });
});
