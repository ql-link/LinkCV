import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { EditorContent } from "@tiptap/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeEditorExtensions, fullyCoveredResumeLayoutNode } from "./editorExtensions";
import { setResumeRowColumns } from "./editorCommands";

let editor: Editor | null = null;

function nodePos(typeName: string) {
  let pos = -1;
  editor!.state.doc.descendants((node, nodePos) => {
    if (node.type.name === typeName) pos = nodePos;
  });
  return pos;
}

const nodeAt = (typeName: string) => editor!.state.doc.nodeAt(nodePos(typeName));

function createEditor(content: object) {
  editor = new Editor({ extensions: resumeEditorExtensions, content });
  return editor;
}

// 布局节点内首个/末个可见叶子的边界（跳过结构锚点，兼容锚点是否已注入）。
function leafRange(pos: number, node: PMNode) {
  let first = -1;
  let last = -1;
  node.descendants((child, offset) => {
    if (child.isLeaf) {
      if (child.type.name !== "resumeBlockAnchor") {
        const childPos = pos + 1 + offset;
        if (first < 0) first = childPos;
        last = childPos + child.nodeSize;
      }
      return false;
    }
    return true;
  });
  return { first, last };
}

function rowTextRange() {
  const pos = nodePos("resumeRow");
  const node = editor!.state.doc.nodeAt(pos)!;
  const { first, last } = leafRange(pos, node);
  return { pos, node, from: first, to: last };
}

function setTextSel(from: number, to: number) {
  const { doc, tr } = editor!.state;
  editor!.view.dispatch(tr.setSelection(TextSelection.create(doc, from, to)));
}

function fakeClipboardEvent(type: "copy" | "cut") {
  const store: Record<string, string> = {};
  const event = {
    type,
    clipboardData: {
      clearData: () => { Object.keys(store).forEach((k) => delete store[k]); },
      setData: (t: string, v: string) => { store[t] = v; },
      getData: (t: string) => store[t] ?? "",
    },
    preventDefault: vi.fn(),
  };
  const handled = editor!.view.someProp(
    "handleDOMEvents",
    (handlers: Record<string, unknown>) => (
      typeof handlers?.[type] === "function"
        ? (handlers[type] as (v: unknown, e: unknown) => boolean)(editor!.view, event)
        : null
    ),
  );
  return { event, store, handled };
}


// jsdom 没有 ClipboardEvent，view.pasteHTML 需要一个占位类。
if (!globalThis.ClipboardEvent) {
  (globalThis as Record<string, unknown>).ClipboardEvent = class extends Event {};
}

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

describe("分栏分隔线拖拽", () => {
  const ROW_WIDTH = 600;

  async function renderRow(cells: string[], selectInsideRow: boolean) {
    const instance = new Editor({
      extensions: resumeEditorExtensions,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "正文" }] },
          {
            type: "resumeRow",
            attrs: { leftWidth: 50 },
            content: cells.map((text) => ({
              type: "paragraph",
              content: [{ type: "text", text }],
            })),
          },
        ],
      },
    });
    editor = instance;
    let rowPosition = 0;
    instance.state.doc.descendants((node, position) => {
      if (node.type.name === "resumeRow") rowPosition = position;
    });
    instance.commands.setTextSelection(selectInsideRow ? rowPosition + 3 : 2);
    const { container } = render(<EditorContent editor={instance} />);
    await act(async () => { await Promise.resolve(); });
    const row = container.querySelector<HTMLElement>(".resume-layout-row");
    if (!row) throw new Error("分栏行未渲染");
    return row;
  }

  function handles(row: HTMLElement) {
    return Array.from(row.querySelectorAll<HTMLElement>(".resume-column-handle"));
  }

  function stubRowWidth() {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: ROW_WIDTH,
      height: 30,
      top: 0,
      left: 0,
      right: ROW_WIDTH,
      bottom: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function drag(handle: HTMLElement, fromX: number, toX: number) {
    fireEvent(handle, new MouseEvent("pointerdown", { clientX: fromX, bubbles: true, cancelable: true }));
    fireEvent(window, new MouseEvent("pointermove", { clientX: toX, bubbles: true }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
  }

  function clickOnly(handle: HTMLElement, x: number) {
    fireEvent(handle, new MouseEvent("pointerdown", { clientX: x, bubbles: true, cancelable: true }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
  }

  function storedWidths() {
    return editor?.state.doc.lastChild?.attrs.columnWidths ?? null;
  }

  it("光标进入 3 栏行时才显示两条分隔线手柄", async () => {
    const outside = await renderRow(["甲", "乙", "丙"], false);
    expect(handles(outside)).toHaveLength(0);

    const inside = await renderRow(["甲", "乙", "丙"], true);
    expect(handles(inside)).toHaveLength(2);
    expect(handles(inside)[0].style.left).toMatch(/^33\.33/);
    expect(handles(inside)[1].style.left).toMatch(/^66\.66/);
  });

  it("4 栏行显示三条手柄，2 栏行不显示", async () => {
    expect(handles(await renderRow(["甲", "乙", "丙", "丁"], true))).toHaveLength(3);
    expect(handles(await renderRow(["甲", "乙"], true))).toHaveLength(0);
  });

  it("拖动分隔线只改相邻两栏，其余栏不变", async () => {
    const row = await renderRow(["甲", "乙", "丙"], true);
    stubRowWidth();

    drag(handles(row)[0], 100, 160);

    expect(storedWidths()).toEqual([43.33, 23.34, 33.33]);
  });

  it("第二条分隔线只影响第二、第三栏", async () => {
    const row = await renderRow(["甲", "乙", "丙"], true);
    stubRowWidth();

    drag(handles(row)[1], 300, 240);

    expect(storedWidths()).toEqual([33.33, 23.33, 43.34]);
  });

  it("拖到最小宽度后不再变化", async () => {
    const row = await renderRow(["甲", "乙", "丙"], true);
    stubRowWidth();

    drag(handles(row)[0], 100, 100 + ROW_WIDTH);

    expect(storedWidths()).toEqual([56.67, 10, 33.33]);
  });

  it("只点一下分隔线不写入宽度", async () => {
    const row = await renderRow(["甲", "乙", "丙"], true);
    stubRowWidth();

    clickOnly(handles(row)[0], 100);

    expect(storedWidths()).toBeNull();
  });

  it("双击分隔线恢复等分", async () => {
    const row = await renderRow(["甲", "乙", "丙"], true);
    stubRowWidth();
    drag(handles(row)[0], 100, 160);
    expect(storedWidths()).toEqual([43.33, 23.34, 33.33]);

    fireEvent.doubleClick(handles(row)[0]);

    expect(storedWidths()).toBeNull();
  });
});

describe("叶子节点指针选区", () => {
  const IMAGE_DOC = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "前文文字" },
          { type: "inlineImage", attrs: { src: "data:image/png;base64,dGVzdA==", width: 24, alt: "行内图" } },
          { type: "text", text: "后文文字" },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "下一段" }] },
    ],
  };
  // jsdom 没有 elementFromPoint/caretFromPoint；补上避免 ProseMirror 原生
  // mousedown 路径（本测试不接管的分支）崩溃。
  if (!document.elementFromPoint) {
    Object.defineProperty(document, "elementFromPoint", { value: () => null, configurable: true });
  }

  // 段落开头还有 resumeBlockAnchor 原子，运行时动态定位图片位置。
  function atomPosition() {
    let pos = -1;
    editor!.state.doc.descendants((node, nodePos) => {
      if (node.type.name === "inlineImage") pos = nodePos;
    });
    if (pos < 0) throw new Error("行内图片未找到");
    return pos;
  }

  async function renderInlineImageDoc() {
    const instance = new Editor({ extensions: resumeEditorExtensions, content: IMAGE_DOC });
    editor = instance;
    const { container } = render(<EditorContent editor={instance} />);
    await act(async () => { await Promise.resolve(); });
    const image = container.querySelector<HTMLElement>(".resume-inline-image img");
    if (!image) throw new Error("行内图片未渲染");
    return { image, container, from: atomPosition() };
  }

  function stubDomSelectionFocus(node: Node | null, focusOffset = 0) {
    const view = editor!.view as unknown as {
      input: { lastSelectionOrigin: string | null };
      domSelectionRange(): { anchorNode: Node | null; anchorOffset: number; focusNode: Node | null; focusOffset: number };
    };
    view.input.lastSelectionOrigin = "pointer";
    const original = view.domSelectionRange.bind(view);
    view.domSelectionRange = () => ({ ...original(), focusNode: node, focusOffset });
  }

  function createBetween(anchor: number, head: number) {
    const view = editor!.view;
    const doc = view.state.doc;
    return view.someProp("createSelectionBetween", (f) => f(view, doc.resolve(anchor), doc.resolve(head))) ?? null;
  }

  it("在行内图片上按下鼠标直接选中节点本身", async () => {
    const { image, from } = await renderInlineImageDoc();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(image, down);
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));

    expect(down.defaultPrevented).toBe(true);
    const sel = editor!.state.selection;
    expect(sel.constructor.name).toBe("NodeSelection");
    expect(sel.from).toBe(from);
    expect(sel.to).toBe(from + 1);
  });

  it("按下图片工具条输入框时交给节点自身处理，不接管", async () => {
    const { image, from } = await renderInlineImageDoc();
    act(() => { editor!.commands.setNodeSelection(from); });
    const toolbarInput = await screen.findByLabelText("行内图片宽度");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(toolbarInput, down);

    expect(down.defaultPrevented).toBe(false);
    expect(editor!.state.selection.constructor.name).toBe("NodeSelection");
    expect(image).toBeInTheDocument();
  });

  it("Shift 点击图片不接管，交给原生范围扩展", async () => {
    const { image } = await renderInlineImageDoc();
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, shiftKey: true });
    fireEvent(image, down);

    expect(down.defaultPrevented).toBe(false);
  });

  it("在普通文本上按下鼠标不接管", async () => {
    const { container } = await renderInlineImageDoc();
    const paragraph = container.querySelector(".ProseMirror p")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(paragraph, down);

    expect(down.defaultPrevented).toBe(false);
  });

  it("向前拖选焦点停在图片上时端点覆盖图片", async () => {
    const { image, from } = await renderInlineImageDoc();
    stubDomSelectionFocus(image);

    // Chrome 把焦点映射到 atom 起点（图片未被覆盖）时应推到图后文本位
    const created = createBetween(2, from);
    expect(created).not.toBeNull();
    expect(created!.from).toBe(2);
    expect(created!.to).toBe(from + 1);
  });

  it("向后拖选焦点停在图片上时端点覆盖图片", async () => {
    const { image, from } = await renderInlineImageDoc();
    stubDomSelectionFocus(image);

    const created = createBetween(from + 3, from + 1);
    expect(created).not.toBeNull();
    expect(created!.from).toBe(from);
    expect(created!.to).toBe(from + 3);
  });

  it("端点已经覆盖图片时不改写选区", async () => {
    const { image, from } = await renderInlineImageDoc();
    stubDomSelectionFocus(image);

    expect(createBetween(2, from + 1)).toBeNull();
    expect(createBetween(from + 3, from)).toBeNull();
  });

  it("焦点不在叶子节点内部时返回 null 交给默认处理", async () => {
    const { container, from } = await renderInlineImageDoc();
    const textNode = container.querySelector(".ProseMirror p")!.firstChild!;
    stubDomSelectionFocus(textNode);
    expect(createBetween(2, from)).toBeNull();
  });

  it("焦点落在父容器挨着图片的偏移处时也覆盖图片", async () => {
    const { container, image, from } = await renderInlineImageDoc();
    const paragraph = image.closest("p")!;
    const atomWrapper = container.querySelector(".resume-inline-image")!.parentElement!;
    const index = Array.prototype.indexOf.call(paragraph.childNodes, atomWrapper);
    expect(index).toBeGreaterThanOrEqual(0);

    // 焦点=(段落元素, atom 前的 offset)，Chrome 悬停图片时的常见形态
    stubDomSelectionFocus(paragraph, index);
    const forward = createBetween(2, from);
    expect(forward).not.toBeNull();
    expect(forward!.to).toBe(from + 1);

    // offset 落在 atom 之后一侧，向后拖同样覆盖
    stubDomSelectionFocus(paragraph, index + 1);
    const backward = createBetween(from + 3, from + 1);
    expect(backward).not.toBeNull();
    expect(backward!.from).toBe(from);
  });
});

describe("分栏结构剪切复制", () => {
  const ROW_DOC = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "上文段落" }] },
      {
        type: "resumeRow",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "左栏文字" }] },
          { type: "paragraph", content: [{ type: "text", text: "右栏文字" }] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "下文段落" }] },
    ],
  };


  it("选区覆盖整行内容时返回行节点", () => {
    createEditor(ROW_DOC);
    const { from, to } = rowTextRange();
    setTextSel(from, to);
    const target = fullyCoveredResumeLayoutNode(editor!.state.selection as TextSelection);
    expect(target?.node.type.name).toBe("resumeRow");
    expect(target?.node.nodeSize).toBe(nodeAt("resumeRow")!.nodeSize);
  });

  it("选区只覆盖部分内容时不接管", () => {
    createEditor(ROW_DOC);
    const { pos, node, to } = rowTextRange();
    setTextSel(pos + 4, to); // 少选了第一个字
    expect(fullyCoveredResumeLayoutNode(editor!.state.selection as TextSelection)).toBeNull();
    // 跨过行外文字也不接管（默认切片已携带整行结构）
    setTextSel(2, pos + node.nodeSize - 2);
    expect(fullyCoveredResumeLayoutNode(editor!.state.selection as TextSelection)).toBeNull();
  });

  it("只选一栏内容时不接管", () => {
    createEditor(ROW_DOC);
    const pos = nodePos("resumeRow");
    const cell = editor!.state.doc.nodeAt(pos + 1)!;
    const { first, last } = leafRange(pos + 1, cell);
    setTextSel(first, last);
    expect(fullyCoveredResumeLayoutNode(editor!.state.selection as TextSelection)).toBeNull();
  });

  it("剪切整行内容：剪贴板带结构标记且行节点被删除", () => {
    createEditor(ROW_DOC);
    const { from, to } = rowTextRange();
    setTextSel(from, to);
    const { event, store, handled } = fakeClipboardEvent("cut");

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(store["text/html"]).toContain('data-type="resume-row"');
    expect(store["text/plain"]).toContain("左栏文字");
    expect(nodePos("resumeRow")).toBe(-1);
    const json = editor!.getJSON();
    const texts = JSON.stringify(json);
    expect(texts).toContain("上文段落");
    expect(texts).not.toContain("左栏文字");
  });

  it("复制整行内容：剪贴板带结构标记且文档不变", () => {
    createEditor(ROW_DOC);
    const { from, to } = rowTextRange();
    setTextSel(from, to);
    const { store, handled } = fakeClipboardEvent("copy");

    expect(handled).toBe(true);
    expect(store["text/html"]).toContain('data-type="resume-row"');
    expect(nodeAt("resumeRow")!.nodeSize).toBeGreaterThan(0);
  });

  it("普通文字选区复制走默认行为", () => {
    createEditor(ROW_DOC);
    setTextSel(2, 5);
    const { handled } = fakeClipboardEvent("copy");
    expect(handled).toBeFalsy();
  });

  it("结构剪贴板 HTML 粘贴回编辑器时还原为分栏行", () => {
    createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "上文" }] },
        {
          type: "resumeColumns",
          content: [
            { type: "resumeColumn", attrs: { variant: "sidebar" }, content: [{ type: "paragraph", content: [{ type: "text", text: "侧栏" }] }] },
            {
              type: "resumeColumn",
              content: [
                {
                  type: "resumeRow",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "2023.07 知行文创" }] },
                    { type: "paragraph", content: [{ type: "text", text: "行政助理" }] },
                  ],
                },
                { type: "paragraph", content: [{ type: "text", text: "在列内段落" }] },
              ],
            },
          ],
        },
      ],
    });
    const view = editor!.view;
    const pos = nodePos("resumeRow");
    const row = view.state.doc.nodeAt(pos)!;
    const { dom } = view.serializeForClipboard(new Slice(Fragment.from(row), 0, 0));
    const html = dom.innerHTML;
    expect(html).toContain('data-type="resume-row"');

    let tailEnd = -1;
    view.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && p > pos) tailEnd = p + n.nodeSize - 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, tailEnd)));

    view.pasteHTML(html);
    let rows = 0;
    view.state.doc.descendants((n) => { if (n.type.name === "resumeRow") rows++; });
    expect(rows).toBe(2);
  });

  it("覆盖双栏容器全部内容时剪切整个 resumeColumns", () => {
    createEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "头部" }] },
        {
          type: "resumeColumns",
          content: [
            {
              type: "resumeColumn",
              content: [{ type: "paragraph", content: [{ type: "text", text: "侧栏甲" }] }],
            },
            {
              type: "resumeColumn",
              content: [{ type: "paragraph", content: [{ type: "text", text: "主栏乙" }] }],
            },
          ],
        },
      ],
    });
    const pos = nodePos("resumeColumns");
    const node = editor!.state.doc.nodeAt(pos)!;
    const { first, last } = leafRange(pos, node);
    setTextSel(first, last);
    const target = fullyCoveredResumeLayoutNode(editor!.state.selection as TextSelection);
    expect(target?.node.type.name).toBe("resumeColumns");

    const { store } = fakeClipboardEvent("cut");
    expect(store["text/html"]).toContain('data-type="resume-columns"');
    expect(nodePos("resumeColumns")).toBe(-1);
  });
});

describe("分栏激活外框", () => {
  const activeClasses = () =>
    [...editor!.view.dom.querySelectorAll(".is-active")].map((el) => el.className);

  const COLUMNS_DOC = {
    type: "doc",
    content: [{
      type: "resumeColumns",
      content: [
        {
          type: "resumeColumn",
          attrs: { variant: "sidebar" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "侧栏" }] }],
        },
        {
          type: "resumeColumn",
          content: [
            {
              type: "resumeTrioRow",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "公司" }] },
                { type: "paragraph", content: [{ type: "text", text: "日期" }] },
                { type: "paragraph", content: [{ type: "text", text: "岗位" }] },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "列内段落" }] },
          ],
        },
      ],
    }],
  };

  it("光标在三栏行内时该行显示 is-active", () => {
    createEditor(COLUMNS_DOC);
    const pos = nodePos("resumeTrioRow");
    setTextSel(pos + 3, pos + 3);
    const trio = editor!.view.dom.querySelector('[data-type="resume-trio-row"]');
    expect(trio?.classList.contains("is-active")).toBe(true);
  });

  it("光标在列内普通段落时该列显示 is-active", () => {
    createEditor(COLUMNS_DOC);
    // “列内段落”在第二个 resumeColumn 里
    let paraPos = -1;
    editor!.state.doc.descendants((n, p) => {
      if (n.type.name === "paragraph" && n.textContent === "列内段落") paraPos = p;
    });
    setTextSel(paraPos + 3, paraPos + 3);
    const col = [...editor!.view.dom.querySelectorAll('[data-type="resume-column"]')]
      .find((el) => el.classList.contains("is-active"));
    expect(col?.classList.contains("resume-layout-column-main")).toBe(true);
    expect(editor!.view.dom.querySelector('[data-type="resume-trio-row"]')?.classList.contains("is-active")).toBe(false);
  });

  it("选区完整覆盖三栏行时外框落在该行而不是外层容器", () => {
    createEditor(COLUMNS_DOC);
    const pos = nodePos("resumeTrioRow");
    const node = editor!.state.doc.nodeAt(pos)!;
    const { first, last } = leafRange(pos, node);
    setTextSel(first, last);
    const trio = editor!.view.dom.querySelector('[data-type="resume-trio-row"]');
    expect(trio?.classList.contains("is-active")).toBe(true);
    expect(editor!.view.dom.querySelector('[data-type="resume-columns"]')?.classList.contains("is-active")).toBeFalsy();
  });

  it("光标在普通正文里没有激活外框", () => {
    createEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "普通段落" }] }] });
    setTextSel(2, 2);
    expect(activeClasses()).toHaveLength(0);
  });
});
