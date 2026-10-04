import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorOpenError } from "./EditorOpenError";

describe("EditorOpenError", () => {
  it("展示错误原因，并提供返回主页与重新尝试", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onRetry = vi.fn();
    render(<EditorOpenError message="简历不存在，或当前账号没有访问权限。" onBack={onBack} onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "无法打开这份简历" })).toBeInTheDocument();
    expect(screen.getByText("简历不存在，或当前账号没有访问权限。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回主页" }));
    await user.click(screen.getByRole("button", { name: "重新尝试" }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "重新尝试" })).toHaveClass("v3-btn-dark");
  });
});
