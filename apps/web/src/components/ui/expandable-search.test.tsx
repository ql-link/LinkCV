import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ExpandableSearch } from "./expandable-search";

function SearchHarness() {
  const [value, setValue] = useState("");
  return <ExpandableSearch label="搜索简历" name="resume-search" value={value} onValueChange={setValue} placeholder="搜索简历…" />;
}

describe("ExpandableSearch", () => {
  it("默认显示圆形按钮，展开后聚焦输入框", () => {
    render(<SearchHarness />);

    const trigger = screen.getByRole("button", { name: "搜索简历" });
    expect(trigger).toHaveClass("expandable-search-trigger");
    expect(screen.queryByRole("searchbox", { name: "搜索简历" })).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(screen.getByRole("searchbox", { name: "搜索简历" })).toHaveFocus();
  });

  it("关闭时清空内容、收起搜索并把焦点还给按钮", () => {
    render(<SearchHarness />);
    fireEvent.click(screen.getByRole("button", { name: "搜索简历" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索简历" }), {
      target: { value: "frontend" },
    });

    fireEvent.click(screen.getByRole("button", { name: "清除并收起搜索" }));

    expect(screen.queryByRole("searchbox", { name: "搜索简历" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索简历" })).toHaveFocus();
  });

  it("按 Escape 时清空并收起搜索", () => {
    render(<SearchHarness />);
    fireEvent.click(screen.getByRole("button", { name: "搜索简历" }));
    const input = screen.getByRole("searchbox", { name: "搜索简历" });
    fireEvent.change(input, { target: { value: "产品" } });

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("searchbox", { name: "搜索简历" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索简历" })).toHaveFocus();
  });
});
