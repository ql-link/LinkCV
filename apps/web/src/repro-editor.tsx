// LR-203 本地验证页：真实编辑器扩展 + 分页插件 + 行首「+」/斜杠命令菜单。
// 不进入仓库提交；仅用于无后端环境下验证标题内中文输入法与行首回车/退格行为。
import { EditorContent, useEditor } from "@tiptap/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./design-system/tokens.css";
import "./design-system/utilities.css";
import "./app.css";
import "./components/ui/layout-patterns.css";
import "./features/preview/print/resume-fonts.css";
import { resumeEditorExtensions } from "./features/workbench/editorExtensions";
import { PaginationExtension } from "./features/workbench/paginationPlugin";
import {
  LineInsertMenuExtension,
  SlashCommandMenu,
  type CommandMenuState,
} from "./features/workbench/slashCommand";
import { defaultSettings } from "./store/resumeStore";

const DEMO_CONTENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "李示例" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "前端工程师 · 示例市 · demo@example.com" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "教育背景" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "示例大学 · 计算机科学与技术（2016–2020）" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "项目经历" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "示例项目：用于验证编辑器行为的占位描述。" }],
    },
  ],
};

const paperStyle = {
  "--resume-font-family": defaultSettings.fontFamily,
  "--resume-font-size": `${defaultSettings.fontSize}pt`,
  "--resume-line-height": defaultSettings.lineHeight,
  "--resume-page-margin-x": `${defaultSettings.pageMargin}mm`,
  "--resume-page-margin-y": `${defaultSettings.verticalPageMargin}mm`,
  "--resume-page-margin-top": `${defaultSettings.verticalPageMargin}mm`,
  "--resume-page-margin-right": `${defaultSettings.pageMargin}mm`,
  "--resume-page-margin-bottom": `${defaultSettings.verticalPageMargin}mm`,
  "--resume-page-margin-left": `${defaultSettings.pageMargin}mm`,
  "--preview-accent": "#1d4ed8",
} as React.CSSProperties;

function ReproWorkbench() {
  const [commandMenu, setCommandMenu] = useState<CommandMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editor = useEditor({
    shouldRerenderOnTransaction: false,
    extensions: [
      ...resumeEditorExtensions,
      PaginationExtension,
      LineInsertMenuExtension.configure({ onOpen: setCommandMenu }),
    ],
    content: DEMO_CONTENT,
    editorProps: {
      attributes: { class: "resume-content", spellcheck: "false" },
    },
    onCreate: ({ editor: current }) => {
      current.commands.setTextSelection(Math.max(1, current.state.doc.content.size - 1));
      current.commands.blur();
    },
    onUpdate: ({ editor: current }) => {
      const { from, $from } = current.state.selection;
      console.log("[repro] onUpdate", JSON.stringify({ from, empty: current.state.selection.empty, line: current.state.doc.textBetween($from.start(), from, "\n", "￼") }));
      if (!current.state.selection.empty) {
        setCommandMenu(null);
        return;
      }
      const line = current.state.doc.textBetween($from.start(), from, "\n", "￼");
      const match = line.match(/(?:^|\s)\/([^\s/]*)$/u);
      if (!match) {
        setCommandMenu((menu) => (menu?.replaceRange ? null : menu));
        return;
      }
      const query = match[1] ?? "";
      const slashFrom = from - query.length - 1;
      const coordinates = current.view.coordsAtPos(from);
      console.log("[repro] slash open", JSON.stringify({ query, from }));
      setCommandMenu({
        x: Math.max(12, Math.min(coordinates.left, window.innerWidth - 312)),
        y: Math.max(12, Math.min(coordinates.bottom + 6, window.innerHeight - 432)),
        query,
        replaceRange: { from: slashFrom, to: from },
      });
    },
  });

  useEffect(() => {
    (window as unknown as { __editor: unknown }).__editor = editor;
  }, [editor]);

  useEffect(() => {
    console.log("[repro] commandMenu", JSON.stringify(commandMenu));
  }, [commandMenu]);

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: "24px 0" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto 16px",
          padding: "12px 16px",
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          fontSize: 14,
          lineHeight: 1.8,
        }}
      >
        <strong>LR-203 修复验证页</strong>（独立编辑器，与工作台同一套扩展）
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>把光标放进「教育背景」等标题，用中文输入法（如拼音）输入文字，候选词 Enter/方向键应不再被吞。</li>
          <li>光标移到标题行首按回车 → 标题上方应出现一个空段落（不再是空标题）。</li>
          <li>非空标题行首按退格 → 标题并入上一行；空标题行首退格 → 整行被删除。</li>
          <li>输入「/」打开命令菜单，用中文输入法过滤，组合期间 Enter/Esc/方向键不应触发菜单命令。</li>
        </ol>
        {notice ? <div style={{ color: "#b45309", marginTop: 8 }}>{notice}</div> : null}
      </div>
      <div className="workbench-paper-scroll" style={{ display: "flex", justifyContent: "center" }}>
        <article
          className="resume-paper theme-classic smart-one-page"
          style={paperStyle}
          aria-label="可编辑简历页面"
        >
          <EditorContent editor={editor} />
        </article>
      </div>
      {editor && commandMenu && (
        <SlashCommandMenu
          editor={editor}
          resumeId="demo"
          state={commandMenu}
          onClose={() => setCommandMenu(null)}
          onNotice={(label) => setNotice(label)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ReproWorkbench />
  </StrictMode>,
);
