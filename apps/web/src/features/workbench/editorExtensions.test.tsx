import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeEditorExtensions } from "./editorExtensions";
import { setResumeRowColumns } from "./editorCommands";

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

describe("分栏栏数菜单", () => {
  async function renderRow(cells: string[], editable = true) {
    const instance = new Editor({
      extensions: resumeEditorExtensions,
      editable,
      content: {
        type: "doc",
        content: [{
          type: "resumeRow",
          attrs: { leftWidth: 50 },
          content: cells.map((text) => ({
            type: "paragraph",
            content: [{ type: "text", text }],
          })),
        }],
      },
    });
    editor = instance;
    const { container } = render(<EditorContent editor={instance} />);
    // React 节点视图在微任务里挂载，先等它落地再断言。
    await act(async () => { await Promise.resolve(); });
    const row = container.querySelector<HTMLElement>(".resume-layout-row");
    if (!row) throw new Error("分栏行未渲染");
    return row;
  }

  it("右键分栏行弹出栏数菜单并标出当前栏数", async () => {
    const row = await renderRow(["星河云科技", "2022.9 – 2026.6"]);
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menu", { name: "分栏栏数" })).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent))
      .toEqual(["2 栏", "3 栏", "4 栏"]);
    expect(screen.getByRole("menuitemradio", { name: "2 栏" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "3 栏" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemradio", { name: "4 栏" })).toHaveAttribute("aria-checked", "false");
  });

  it("选择 4 栏后分栏行变成四个等分栏并保留原文字", async () => {
    const user = userEvent.setup();
    const row = await renderRow(["星河云科技", "2022.9 – 2026.6"]);
    fireEvent.contextMenu(row);
    await user.click(screen.getByRole("menuitemradio", { name: "4 栏" }));
    await act(async () => { await Promise.resolve(); });

    const node = editor?.state.doc.firstChild;
    expect(node?.childCount).toBe(4);
    expect(node?.child(0).textContent).toBe("星河云科技");
    expect(node?.child(1).textContent).toBe("2022.9 – 2026.6");
    expect(node?.child(3).textContent).toBe("");
    expect(screen.queryByRole("menu", { name: "分栏栏数" })).not.toBeInTheDocument();
    expect(row).toHaveClass("is-equal", "equal-columns-4");
  });

  it("3 栏和 4 栏是等分栏，2 栏仍是左右分栏", async () => {
    const row = await renderRow(["A", "B"]);
    expect(row).not.toHaveClass("is-equal");
    expect(row).toHaveStyle({ "--resume-row-left": "50%" });

    await act(async () => {
      if (editor) setResumeRowColumns(editor, 0, 3);
      await Promise.resolve();
    });
    expect(row).toHaveClass("is-equal", "equal-columns-3");
    expect(row).toHaveStyle({ "--resume-row-columns": "3" });
  });

  it("只读编辑器里的分栏行不弹出栏数菜单", async () => {
    const row = await renderRow(["A", "B"], false);
    fireEvent.contextMenu(row);

    expect(screen.queryByRole("menu", { name: "分栏栏数" })).not.toBeInTheDocument();
  });
});
