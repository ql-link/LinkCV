import { describe, expect, it } from "vitest";
import { adminScale, visualScale } from "./viewportScale";

describe("adminScale", () => {
  it("keeps the design size on 13-inch and smaller screens", () => {
    expect(adminScale(1440, 900)).toBe(1);
    expect(adminScale(1280, 720)).toBe(1);
    expect(adminScale(390, 844)).toBe(1);
  });

  it("scales wide screens back to the 1440px design frame", () => {
    expect(adminScale(1920, 1200)).toBe(1.333);
    expect(adminScale(1728, 1117)).toBe(1.2);
  });

  it("is bounded by height on short, wide windows and capped overall", () => {
    expect(adminScale(2560, 900)).toBe(1.125);
    expect(adminScale(3840, 2160)).toBe(1.6);
  });

  it("falls back to 1 for unknown sizes", () => {
    expect(adminScale(0, 0)).toBe(1);
    expect(adminScale(Number.NaN, 900)).toBe(1);
  });
});

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
