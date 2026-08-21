import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageLoading } from "./page-loading";

describe("PageLoading", () => {
  it("提供统一的可访问加载状态和作用域样式", () => {
    render(<PageLoading label="正在加载资料…" scope="workspace" />);

    const loading = screen.getByRole("status", { name: "正在加载资料…" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("aria-live", "polite");
    expect(loading).toHaveClass("page-loading", "is-workspace");
    expect(screen.getByText("正在加载资料…")).toBeInTheDocument();
  });
});
