import { t, useLocale } from "@/i18n";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { Editor } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "../../v3/Icon";

import {
  availableModuleOptions,
  insertOutlineSection,
  outlineSnapshot,
  type OutlineSectionRun,
  type OutlineSnapshot,
} from "./outlineModel";
import { attachOutlinePaper, setOutlineDragPreview } from "./outlinePaperPlugin";
import type { ResumeCompletenessResult } from "./resumeCompleteness";
import type { ResumeSectionKind, ResumeSectionOrderGroup } from "./resumeSectionOrder";
import { WorkbenchPanelHeader } from "./WorkbenchPanelHeader";
import {
  WorkbenchSectionOrderControl,
  WorkbenchSectionOrderReset,
  type SectionDragHint,
} from "./WorkbenchSectionOrderControl";

// 完整度检查的类别 → 大纲里受影响的模块类型（行尾「待完善」）
const categoryKinds: Record<ResumeCompletenessResult["checks"][number]["category"], ResumeSectionKind[]> = {
  basics: ["identity"],
  experience: ["work", "project"],
  education: ["education"],
  skills: ["skills"],
  structure: [],
};

export function flaggedSectionKinds(result: ResumeCompletenessResult) {
  const kinds = new Set<ResumeSectionKind>();
  result.checks
    .filter((item) => item.status !== "passed")
    .forEach((item) => categoryKinds[item.category].forEach((kind) => kinds.add(kind)));
  return kinds;
}

function snapshotSignature(snapshot: OutlineSnapshot) {
  return JSON.stringify([
    snapshot.pageCount,
    snapshot.currentKey,
    [...snapshot.info.entries()],
    snapshot.runs.map((run) => [run.key, run.kind, run.nodes.length, run.nodes[0]?.textContent ?? ""]),
  ]);
}

// 跟随编辑器事务刷新摘要、分页和光标所在模块；内容没变时不触发重渲染
function useOutlineSnapshot(editor: Editor) {
  const [snapshot, setSnapshot] = useState(() => outlineSnapshot(editor.state));
  useEffect(() => {
    let signature = "";
    const refresh = () => {
      const next = outlineSnapshot(editor.state);
      const nextSignature = snapshotSignature(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      setSnapshot(next);
    };
    refresh();
    editor.on("transaction", refresh);
    return () => { editor.off("transaction", refresh); };
  }, [editor]);
  return snapshot;
}

function sectionTitle(run: OutlineSectionRun) {
  return run.kind === "identity" ? t("个人信息") : run.nodes[0]?.textContent.trim() || t("未命名模块");
}

// 分页感知：每页一张缩略图，按模块在该页的占比画色块，光标所在模块为蓝色
function PageMap({
  snapshot,
  onCompress,
}: {
  snapshot: OutlineSnapshot;
  onCompress: () => void;
}) {
  const pages = Array.from({ length: snapshot.pageCount }, (_, index) => index + 1);
  const lastPageRuns = snapshot.runs.filter((run) => (snapshot.info.get(run.key)?.page ?? 1) === snapshot.pageCount);
  return (
    <div className="wb3-outline-pages">
      <div className="wb3-outline-thumbs" aria-hidden="true">
        {pages.slice(0, 3).map((page) => {
          const runs = snapshot.runs.filter((run) => (snapshot.info.get(run.key)?.page ?? 1) === page);
          return (
            <span className="wb3-outline-thumb" key={page}>
              <span className="wb3-outline-sheet">
                {runs.slice(0, 6).map((run) => (
                  <i
                    key={run.key}
                    className={run.key === snapshot.currentKey ? "is-current" : run.kind === "identity" ? "is-head" : ""}
                    style={{ flexGrow: Math.max(1, Math.min(4, run.nodes.length)) }}
                  />
                ))}
              </span>
              <small>P{page}</small>
            </span>
          );
        })}
      </div>
      <div className="wb3-outline-pages-text">
        <strong>{t("共 {value0} 页", { value0: snapshot.pageCount })}</strong>
        {lastPageRuns.length > 0 && lastPageRuns.length <= 2 ? (
          <span>
            {t("第 {value0} 页只有「{value1}」{value2} 个模块", {
              value0: snapshot.pageCount,
              value1: lastPageRuns.map(sectionTitle).join("」「"),
              value2: lastPageRuns.length,
            })}
          </span>
        ) : null}
        <button type="button" className="wb3-outline-compress" onClick={onCompress}>{t("压缩到一页 →")}</button>
      </div>
    </div>
  );
}

function AddModuleMenu({
  editor,
  snapshot,
  disabled,
  container,
  onCustom,
}: {
  editor: Editor;
  snapshot: OutlineSnapshot;
  disabled: boolean;
  container: HTMLElement | null;
  onCustom: (key: string) => void;
}) {
  const present = useMemo(() => new Set(snapshot.runs.map((run) => run.kind)), [snapshot.runs]);
  const options = availableModuleOptions(present);
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="wb3-outline-add" disabled={disabled || snapshot.runs.length === 0}>
          <Icon name="plus" size={14} />{t("添加模块")}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className="wb3-outline-menu is-add"
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {options.length ? <DropdownMenu.Label className="wb3-outline-menu-label">{t("还可以添加")}</DropdownMenu.Label> : null}
          {options.map((option) => (
            <DropdownMenu.Item
              key={option.kind}
              className="wb3-outline-menu-item is-option"
              onSelect={() => {
                if (insertOutlineSection(editor, option.kind, t(option.title))) editor.view.focus();
              }}
            >
              <span>
                <strong>{t(option.title)}</strong>
                <small>{t(option.hint)}</small>
              </span>
              <kbd aria-hidden="true">↵</kbd>
            </DropdownMenu.Item>
          ))}
          {options.length ? <DropdownMenu.Separator className="wb3-outline-menu-separator" /> : null}
          <DropdownMenu.Item
            className="wb3-outline-menu-item is-custom"
            onSelect={() => {
              const key = insertOutlineSection(editor, "custom", t("新模块"));
              if (key) onCustom(key);
            }}
          >
            <Icon name="plus" size={14} />{t("自定义模块")}
          </DropdownMenu.Item>
          <p className="wb3-outline-menu-note">{t("新模块插入到光标所在模块之后，可再拖动调整")}</p>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// 08 大纲 V2（Figma 1244:156）：模块摘要与状态、当前位置、分页感知、行操作和添加模块
export function WorkbenchOutlinePanel({
  editor,
  completeness,
  disabled,
  smartOnePage = false,
  onSmartOnePage,
  onClose,
}: {
  editor: Editor;
  completeness: ResumeCompletenessResult;
  disabled: boolean;
  smartOnePage?: boolean;
  onSmartOnePage?: () => void;
  onClose: () => void;
}) {
  useLocale();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [groups, setGroups] = useState<ResumeSectionOrderGroup[]>([]);
  const [dragHint, setDragHint] = useState<SectionDragHint>(null);
  const [renameKey, setRenameKey] = useState<string | null>(null);
  const flagged = useMemo(() => flaggedSectionKinds(completeness), [completeness]);
  const snapshot = useOutlineSnapshot(editor);
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const paged = !smartOnePage && snapshot.pageCount > 1;

  useEffect(() => attachOutlinePaper(editor), [editor]);
  useEffect(() => {
    setOutlineDragPreview(editor, dragHint ? { key: dragHint.key, targetKey: dragHint.targetKey, edge: dragHint.edge } : null);
  }, [editor, dragHint]);

  return (
    <div className="wb3-outline-panel" ref={setRoot}>
      <WorkbenchPanelHeader
        titleId="workbench-outline-title"
        title={t("大纲")}
        subtitle={t("拖动调整顺序，点击定位到正文")}
        closeLabel={t("关闭大纲")}
        onClose={onClose}
      />
      <div className="wb3-panel-body wb3-outline-body">
        {paged && onSmartOnePage ? <PageMap snapshot={snapshot} onCompress={onSmartOnePage} /> : null}
        <div className={`wb3-outline-meta${dragHint ? " is-dragging" : ""}`}>
          <span aria-live="polite">
            {dragHint
              ? t(dragHint.edge === "before" ? "松开放到「{value0}」之前" : "松开放到「{value0}」之后", { value0: dragHint.title })
              : t("{value0} 个模块", { value0: count })}
          </span>
          <WorkbenchSectionOrderReset editor={editor} disabled={disabled} />
        </div>
        <WorkbenchSectionOrderControl
          editor={editor}
          disabled={disabled}
          flaggedKinds={flagged}
          info={snapshot.info}
          currentKey={snapshot.currentKey}
          showPages={paged}
          renameKey={renameKey}
          onRenameKeyChange={setRenameKey}
          onGroupsChange={setGroups}
          onDragHint={setDragHint}
        />
        {count === 0 ? <p className="wb3-outline-empty">{t("正文里还没有「标题 2」模块。")}</p> : null}
        <AddModuleMenu
          editor={editor}
          snapshot={snapshot}
          disabled={disabled}
          container={root}
          onCustom={setRenameKey}
        />
      </div>
      <footer className="wb3-outline-foot">
        {t("也可在正文空行输入")}
        <kbd>/</kbd>
        {t("选「标题 2」新建模块")}
      </footer>
    </div>
  );
}
