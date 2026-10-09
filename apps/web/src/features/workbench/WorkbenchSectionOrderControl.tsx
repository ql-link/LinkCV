import { t, useLocale } from "@/i18n";
import type { Editor } from "@tiptap/core";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { TextSelection } from "@tiptap/pm/state";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../../v3/Icon";

import {
  IDENTITY_KEY,
  deleteOutlineSection,
  renameOutlineSection,
  type OutlineSectionInfo,
  type OutlineSectionSummary,
} from "./outlineModel";

import {
  applySectionOrder,
  moveSectionItem,
  resetSectionOrder,
  resumeSectionOrderGroups,
  type ResumeColumnSide,
  type ResumeSectionKind,
  type ResumeSectionOrderGroup,
} from "./resumeSectionOrder";

const SECTION_ORDER_DRAG_TYPE = "application/x-linkresume-section-index";

type DragOrigin = { side: ResumeColumnSide | null; index: number };
type DropRegion = { side: ResumeColumnSide | null; index: number; edge: "before" | "after" };

function sectionIndexes(items: ResumeSectionOrderGroup["items"]) {
  return items.flatMap((item, index) => (item.nodeId ? [index] : []));
}

function dropEdge(event: { clientY: number; currentTarget: HTMLElement }): "before" | "after" {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

export function dropIndex(targetIndex: number, edge: "before" | "after", from: number) {
  if (edge === "before") return targetIndex > from ? targetIndex - 1 : targetIndex;
  return targetIndex > from ? targetIndex : targetIndex + 1;
}

export function WorkbenchSectionOrderReset({
  editor,
  disabled = false,
}: {
  editor: Editor;
  disabled?: boolean;
}) {
  useLocale();
  return (
    <button
      type="button"
      className="workbench-section-order-reset"
      disabled={disabled}
      onClick={() => { resetSectionOrder(editor); }}
    >{t("恢复默认顺序")}</button>
  );
}

// 大纲里「空」的判断：某个标题 2 后面直到下一个标题 2 之间没有任何文字
function emptySectionIds(editor: Editor) {
  const empty = new Set<string>();
  let current: string | null = null;
  let hasText = false;
  const flush = () => {
    if (current && !hasText) empty.add(current);
  };
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.attrs.level === 2) {
      flush();
      const anchor = node.firstChild?.type.name === "resumeBlockAnchor" ? node.firstChild : null;
      current = typeof anchor?.attrs.blockId === "string" ? anchor.attrs.blockId : null;
      hasText = false;
      return false;
    }
    if (current && node.isTextblock && node.textContent.trim()) {
      hasText = true;
      return false;
    }
    return true;
  });
  flush();
  return empty;
}

// 点击大纲行：把光标放到对应标题 2 并滚动到可见位置；个人信息跳到文档开头
export function jumpToSection(editor: Editor, nodeId: string | null) {
  let target = nodeId === null ? 1 : -1;
  if (nodeId !== null) {
    editor.state.doc.descendants((node, pos) => {
      if (target >= 0) return false;
      if (node.type.name !== "heading") return true;
      const anchor = node.firstChild;
      if (anchor?.type.name === "resumeBlockAnchor" && anchor.attrs.blockId === nodeId) target = pos + 1 + anchor.nodeSize;
      return false;
    });
  }
  if (target < 0) return false;
  const selection = TextSelection.near(editor.state.doc.resolve(Math.min(target, editor.state.doc.content.size)));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
  const dom = editor.view.domAtPos(selection.from).node;
  const element = dom instanceof HTMLElement ? dom : dom.parentElement;
  element?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  return true;
}

// sidebar/main 是语义区域；左右标签必须跟随模板的实际列位置。
export function sidebarIsOnRight(root: HTMLElement): boolean {
  const sidebar = root.querySelector<HTMLElement>('[data-type="resume-column"][data-column="sidebar"]');
  const main = root.querySelector<HTMLElement>('[data-type="resume-column"][data-column="main"]');
  if (!sidebar || !main) return false;
  const sidebarLeft = sidebar.getBoundingClientRect().left;
  const mainLeft = main.getBoundingClientRect().left;
  if (sidebarLeft !== mainLeft) return sidebarLeft > mainLeft;
  const sidebarColumn = Number.parseInt(getComputedStyle(sidebar).gridColumnStart, 10);
  const mainColumn = Number.parseInt(getComputedStyle(main).gridColumnStart, 10);
  return Number.isFinite(sidebarColumn) && Number.isFinite(mainColumn) && sidebarColumn > mainColumn;
}

const contactLabels: Record<string, string> = {
  avatar: "头像",
  phone: "电话",
  email: "邮箱",
  github: "GitHub",
  linkedin: "LinkedIn",
  website: "主页",
  location: "城市",
};

// 大纲 V2 每行的一行摘要：段数、要点数、学历或已填的联系方式
export function outlineSummaryText(summary: OutlineSectionSummary) {
  switch (summary.type) {
    case "identity":
      return summary.contacts.length
        ? summary.contacts.map((kind) => t(contactLabels[kind] ?? kind)).join(" · ")
        : t("还没有联系方式");
    case "empty":
      return t("还没有内容");
    case "entries":
      return [
        t("{value0} 段", { value0: summary.entries }),
        summary.bullets ? t("{value0} 条要点", { value0: summary.bullets }) : null,
        summary.degrees.length ? summary.degrees.map((degree) => t(degree)).join(" / ") : null,
      ].filter(Boolean).join(" · ");
    case "bullets":
      return t("{value0} 条", { value0: summary.bullets });
    case "text":
      return t("{value0} 字", { value0: summary.chars });
  }
}

function undoShortcut() {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return /mac|iphone|ipad/iu.test(platform) ? "⌘Z" : "Ctrl+Z";
}

export type SectionDragHint = { title: string; edge: "before" | "after"; key: string; targetKey: string } | null;

function RenameField({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (next: string | null) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(next);
  };
  return (
    <input
      className="workbench-section-order-rename"
      value={value}
      maxLength={40}
      autoFocus
      aria-label={t("模块名称")}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); finish(value); }
        if (event.key === "Escape") { event.preventDefault(); finish(null); }
      }}
    />
  );
}

export function WorkbenchSectionOrderControl({
  editor,
  disabled = false,
  flaggedKinds,
  info,
  currentKey = null,
  showPages = false,
  renameKey = null,
  onRenameKeyChange,
  onGroupsChange,
  onDragHint,
}: {
  editor: Editor;
  disabled?: boolean;
  /** 简历检查里有待完善项的模块类型，行尾显示「待完善」 */
  flaggedKinds?: ReadonlySet<ResumeSectionKind>;
  /** 每个模块的摘要与所在页，key 为 blockId，个人信息为 identity */
  info?: ReadonlyMap<string, OutlineSectionInfo>;
  /** 光标所在模块 */
  currentKey?: string | null;
  /** 在跨页的模块之间插入「第 N 页」分隔线 */
  showPages?: boolean;
  renameKey?: string | null;
  onRenameKeyChange?: (key: string | null) => void;
  onGroupsChange?: (groups: ResumeSectionOrderGroup[]) => void;
  onDragHint?: (hint: SectionDragHint) => void;
}) {
  useLocale();
  const [groups, setGroups] = useState<ResumeSectionOrderGroup[]>(() =>
    resumeSectionOrderGroups(editor.getJSON(), sidebarIsOnRight(editor.view.dom)));
  const originRef = useRef<DragOrigin | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<DragOrigin | null>(null);
  const [target, setTarget] = useState<DropRegion | null>(null);
  const [emptyIds, setEmptyIds] = useState<Set<string>>(() => emptySectionIds(editor));
  const [menuKey, setMenuKey] = useState<string | null>(null);

  useEffect(() => {
    onGroupsChange?.(groups);
  }, [groups, onGroupsChange]);

  useEffect(() => {
    let lastDoc: typeof editor.state.doc | null = null;
    let lastSidebarOnRight: boolean | null = null;
    const refresh = () => {
      const sidebarOnRight = sidebarIsOnRight(editor.view.dom);
      if (editor.state.doc === lastDoc && sidebarOnRight === lastSidebarOnRight) return;
      lastDoc = editor.state.doc;
      lastSidebarOnRight = sidebarOnRight;
      setGroups(resumeSectionOrderGroups(editor.getJSON(), sidebarOnRight));
      setEmptyIds(emptySectionIds(editor));
    };
    refresh();
    editor.on("transaction", refresh);
    const paper = editor.view.dom.closest(".resume-paper");
    const observer = paper && typeof MutationObserver !== "undefined" ? new MutationObserver(refresh) : null;
    if (paper) observer?.observe(paper, { attributes: true, attributeFilter: ["class", "style"] });
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
    resizeObserver?.observe(editor.view.dom);
    return () => {
      editor.off("transaction", refresh);
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [editor]);

  const moveSection = useCallback((side: ResumeColumnSide | null, from: number, to: number) => {
    const group = groups.find((candidate) => candidate.side === side);
    if (!group || from === to) return;
    const ordered = moveSectionItem(group.items, from, to)
      .flatMap((item) => (item.nodeId ? [item.nodeId] : []));
    if (applySectionOrder(editor, side, ordered)) {
      setGroups(resumeSectionOrderGroups(editor.getJSON(), sidebarIsOnRight(editor.view.dom)));
    }
  }, [editor, groups]);

  const showTarget = (next: DropRegion | null) => {
    setTarget(next);
    const source = originRef.current;
    const group = next ? groups.find((candidate) => candidate.side === next.side) : null;
    const sourceItem = source ? group?.items[source.index] : null;
    const targetItem = next ? group?.items[next.index] : null;
    onDragHint?.(sourceItem?.nodeId && targetItem && next
      ? { title: targetItem.title, edge: next.edge, key: sourceItem.nodeId, targetKey: targetItem.nodeId ?? IDENTITY_KEY }
      : null);
  };

  const endDrag = () => {
    originRef.current = null;
    setDragging(null);
    showTarget(null);
  };

  if (!groups.length) return null;

  return (
    <div className="workbench-section-order" ref={setRoot}>
      {groups.map((group) => {
        const sectionSlots = sectionIndexes(group.items);
        let lastPage = 1;
        return (
          <div className="workbench-section-order-group" key={group.side ?? "single"}>
            {group.label ? (
              <p className="workbench-section-order-group-label">
                <i className={`workbench-section-order-column is-${group.label === "右栏" ? "right" : "left"}`} aria-hidden="true" />
                {t(group.label)}
                <small>{t(" · 仅能在本栏内拖动")}</small>
              </p>
            ) : null}
            <ul className="workbench-section-order-list">
              {group.items.map((item, index) => {
                const fixed = item.nodeId === null;
                const key = item.nodeId ?? IDENTITY_KEY;
                const detail = info?.get(key);
                const position = sectionSlots.indexOf(index);
                const isDragging = dragging?.side === group.side && dragging.index === index;
                const isDropTarget = target?.side === group.side && target.index === index;
                const empty = detail ? detail.summary.type === "empty" : Boolean(item.nodeId && emptyIds.has(item.nodeId));
                const flagged = flaggedKinds?.has(item.kind) ?? false;
                const renaming = renameKey === key && !fixed;
                const page = detail?.page ?? 1;
                const pageBreak = showPages && page > lastPage;
                lastPage = Math.max(lastPage, page);
                const className = [
                  "workbench-section-order-row",
                  fixed ? "is-fixed" : "",
                  empty ? "is-empty" : "",
                  currentKey === key && !dragging ? "is-current" : "",
                  menuKey === key ? "is-menu-open" : "",
                  isDragging ? "is-dragging" : "",
                  isDropTarget ? `is-drop-${target?.edge}` : "",
                ].filter(Boolean).join(" ");
                return (
                  <Fragment key={key}>
                    {pageBreak ? (
                      <li className="workbench-section-order-page" role="separator">{t("第 {value0} 页", { value0: page })}</li>
                    ) : null}
                    <li
                      className={className}
                      draggable={!fixed && !disabled && !renaming}
                      onDragStart={fixed || disabled ? undefined : (event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData(SECTION_ORDER_DRAG_TYPE, String(index));
                        originRef.current = { side: group.side, index };
                        setDragging({ side: group.side, index });
                      }}
                      onDragOver={fixed || disabled ? undefined : (event) => {
                        const source = originRef.current;
                        if (!source || source.side !== group.side) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        const edge = dropEdge(event);
                        if (target?.side !== group.side || target.index !== index || target.edge !== edge) {
                          showTarget({ side: group.side, index, edge });
                        }
                      }}
                      onDrop={fixed || disabled ? undefined : (event) => {
                        event.preventDefault();
                        const source = originRef.current;
                        if (source && source.side === group.side) {
                          moveSection(group.side, source.index, dropIndex(index, dropEdge(event), source.index));
                        }
                        endDrag();
                      }}
                      onDragEnd={endDrag}
                    >
                      {fixed ? (
                        <span className="workbench-section-order-fixed" aria-hidden="true"><Icon name="lock" size={14} /></span>
                      ) : (
                        <button
                          type="button"
                          className="workbench-section-order-handle"
                          disabled={disabled}
                          aria-label={t("调整「{value0}」顺序，可用上下方向键移动", { value0: item.title })}
                          onKeyDown={(event) => {
                            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                            const next = position + (event.key === "ArrowUp" ? -1 : 1);
                            if (next < 0 || next >= sectionSlots.length) return;
                            event.preventDefault();
                            moveSection(group.side, index, sectionSlots[next]);
                          }}
                        >
                          <Icon name="grip" size={14} />
                        </button>
                      )}
                      <span className="workbench-section-order-text">
                        {renaming ? (
                          <RenameField
                            initial={item.title}
                            onDone={(value) => {
                              if (value !== null && item.nodeId) renameOutlineSection(editor, item.nodeId, value);
                              onRenameKeyChange?.(null);
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="workbench-section-order-title"
                            title={t("跳到「{value0}」", { value0: item.title })}
                            onClick={() => { jumpToSection(editor, item.nodeId); }}
                          >
                            {item.title}
                          </button>
                        )}
                        {detail ? <small className="workbench-section-order-summary">{outlineSummaryText(detail.summary)}</small> : null}
                      </span>
                      {flagged ? <span className="workbench-section-order-tag is-flag">{t("待完善")}</span> : null}
                      {!flagged && empty && !fixed ? <span className="workbench-section-order-tag">{t("空")}</span> : null}
                      {fixed ? <small className="workbench-section-order-hint">{t("固定")}</small> : null}
                      {!fixed && item.nodeId && !disabled ? (
                        <DropdownMenu.Root modal={false} onOpenChange={(open) => setMenuKey(open ? key : null)}>
                          <DropdownMenu.Trigger asChild>
                            <button
                              type="button"
                              className="workbench-section-order-more"
                              aria-label={t("「{value0}」更多操作", { value0: item.title })}
                            >
                              <Icon name="more" size={16} />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal container={root}>
                            <DropdownMenu.Content
                              className="wb3-outline-menu"
                              align="end"
                              sideOffset={6}
                              collisionPadding={12}
                              onCloseAutoFocus={(event) => event.preventDefault()}
                            >
                              <DropdownMenu.Item className="wb3-outline-menu-item" onSelect={() => onRenameKeyChange?.(key)}>
                                <Icon name="edit" size={14} />{t("重命名")}
                              </DropdownMenu.Item>
                              <DropdownMenu.Item className="wb3-outline-menu-item" onSelect={() => { jumpToSection(editor, item.nodeId); }}>
                                <Icon name="target" size={14} />{t("定位到正文")}
                              </DropdownMenu.Item>
                              <DropdownMenu.Separator className="wb3-outline-menu-separator" />
                              <DropdownMenu.Item
                                className="wb3-outline-menu-item is-danger"
                                onSelect={() => {
                                  // 焦点回到正文，⌘Z / Ctrl+Z 才能直接撤销这次删除
                                  if (item.nodeId && deleteOutlineSection(editor, item.nodeId)) editor.view.focus();
                                }}
                              >
                                <Icon name="trash" size={14} />{t("删除模块")}
                              </DropdownMenu.Item>
                              <p className="wb3-outline-menu-note">{t("连同内容一起删除，可 {value0} 撤销", { value0: undoShortcut() })}</p>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
