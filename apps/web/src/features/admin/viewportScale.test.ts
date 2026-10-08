import { describe, expect, it } from "vitest";
import { visualScale } from "./viewportScale";

describe("visualScale", () => {
  it("is the ratio of on-screen width to layout width", () => {
    const node = document.createElement("div");
    Object.defineProperty(node, "offsetWidth", { value: 200 });
    node.getBoundingClientRect = () => ({ width: 250 }) as DOMRect;
    expect(visualScale(node)).toBe(1.25);
  });

  it("treats missing or unlaid-out elements as unscaled", () => {
    expect(visualScale(null)).toBe(1);
    expect(visualScale(document.createElement("div"))).toBe(1);
  });
});
