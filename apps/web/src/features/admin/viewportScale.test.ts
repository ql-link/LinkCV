import { describe, expect, it } from "vitest";
import { adminScale, visualScale } from "./viewportScale";

describe("adminScale", () => {
  it("renders the design 1:1 at the fit width", () => {
    expect(adminScale(1500, 976)).toBe(1);
  });

  it("follows width like the reference console, tempered by height", () => {
    // 13" MacBook Air (1470 × 956, minus browser chrome ≈ 830)
    expect(adminScale(1470, 830)).toBe(0.98);
    // 16" MacBook Pro (1728 × 1117, minus browser chrome)
    expect(adminScale(1728, 1030)).toBe(1.152);
    // 1920 × 1080 display, the reference screenshot size
    expect(adminScale(1920, 1078)).toBe(1.28);
    // 1280 × 720: narrow and short
    expect(adminScale(1280, 720)).toBe(0.853);
  });

  it("never lets the layout get narrower than the design above the minimum scale", () => {
    for (const [width, height] of [[1300, 1400], [1470, 830], [1920, 1078]]) {
      expect(width / adminScale(width, height)).toBeGreaterThanOrEqual(1392);
    }
  });

  it("is clamped to the minimum and maximum", () => {
    expect(adminScale(390, 844)).toBe(0.85);
    expect(adminScale(3840, 2160)).toBe(2);
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
