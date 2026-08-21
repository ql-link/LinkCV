import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "./EditorToolbar";

describe("EditorToolbar", () => {
  it("把用户点击转换为对应的编辑命令", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<EditorToolbar onCommand={onCommand} />);

    await user.click(screen.getByRole("button", { name: "加粗" }));

    expect(onCommand).toHaveBeenCalledOnce();
    expect(onCommand).toHaveBeenCalledWith("bold");
  });

  it("禁用中的命令不会触发回调", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<EditorToolbar onCommand={onCommand} disabledCommands={["image"]} />);

    const imageButton = screen.getByRole("button", { name: "图片" });
    expect(imageButton).toBeDisabled();

    await user.click(imageButton);

    expect(onCommand).not.toHaveBeenCalled();
  });
});
