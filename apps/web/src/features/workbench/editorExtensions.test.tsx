import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeEditorExtensions } from "./editorExtensions";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.restoreAllMocks();
});

describe("简历头像上下文操作", () => {
  it("头像 NodeView 外层不会成为模板绝对定位的包含块", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "avatarImage",
          attrs: { src: "data:image/png;base64,dGVzdA==", size: 96, alt: "张三头像" },
        }],
      },
    });
    const { container } = render(<EditorContent editor={editor} />);
    const avatar = container.querySelector<HTMLElement>(".resume-avatar");

    expect(avatar?.parentElement).toHaveClass("resume-avatar-node-view");
  });

  it("只有选中已有头像时显示更换头像操作", async () => {
    const user = userEvent.setup();
    const filePicker = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "avatarImage",
          attrs: { src: "data:image/png;base64,dGVzdA==", size: 96, alt: "张三头像" },
        }],
      },
    });
    render(<EditorContent editor={editor} />);

    expect(screen.getByRole("img", { name: "张三头像" })).toBeInTheDocument();
    act(() => {
      editor?.commands.setNodeSelection(0);
    });

    const replaceAvatar = screen.getByRole("button", { name: "更换头像" });
    expect(replaceAvatar).toHaveTextContent("更换头像");
    expect(screen.getByRole("note")).toHaveTextContent("按住 ⌘ / Ctrl + 滚轮缩放");
    expect(screen.getByRole("img", { name: "张三头像" }).parentElement).toHaveClass("resume-avatar-image-frame");
    expect(screen.queryByRole("button", { name: "拖拽调整图片尺寸" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更换图片" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("头像尺寸")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("头像替代文字")).not.toBeInTheDocument();
    await user.click(replaceAvatar);
    expect(filePicker).toHaveBeenCalledOnce();
  });

  it("选中头像后仅在头像范围内按住 Ctrl 或 Command 滚轮调整大小", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [{
          type: "avatarImage",
          attrs: { src: "data:image/png;base64,dGVzdA==", size: 96, alt: "张三头像" },
        }],
      },
    });
    const { container } = render(<EditorContent editor={editor} />);
    act(() => {
      editor?.commands.setNodeSelection(0);
    });
    const avatar = container.querySelector<HTMLElement>(".resume-avatar");
    const avatarImage = screen.getByRole("img", { name: "张三头像" });
    expect(avatar).not.toBeNull();

    fireEvent.wheel(avatarImage, { deltaY: -100 });
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(96);

    const zoomIn = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100,
    });
    act(() => { avatarImage.dispatchEvent(zoomIn); });
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(100);

    fireEvent.wheel(avatarImage, { metaKey: true, deltaY: 100 });
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(96);

    fireEvent.wheel(screen.getByRole("note"), { ctrlKey: true, deltaY: -100 });
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(96);

    fireEvent.keyDown(avatar!, { ctrlKey: true, key: "ArrowUp" });
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(100);
    fireEvent.keyDown(avatar!, { metaKey: true, key: "ArrowDown" });
    expect(editor.getJSON().content?.[0].attrs?.size).toBe(96);
  });

  it("没有头像节点时不显示更换头像操作", () => {
    editor = new Editor({
      extensions: resumeEditorExtensions,
      content: "<p>没有头像的简历</p>",
    });
    render(<EditorContent editor={editor} />);

    expect(screen.queryByRole("button", { name: "更换头像" })).not.toBeInTheDocument();
  });
});
