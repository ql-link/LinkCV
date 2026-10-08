import { t, useLocale } from "@/i18n";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "../../v3/Icon";

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
    >{t("恢复默认")}</button>
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

export function WorkbenchSectionOrderControl({
  editor,
  disabled = false,
  flaggedKinds,
  onGroupsChange,
}: {
  editor: Editor;
  disabled?: boolean;
  /** 简历检查里有待完善项的模块类型，行尾显示橙点 */
  flaggedKinds?: ReadonlySet<ResumeSectionKind>;
  onGroupsChange?: (groups: ResumeSectionOrderGroup[]) => void;
}) {
  useLocale();
  const [groups, setGroups] = useState<ResumeSectionOrderGroup[]>(() =>
    resumeSectionOrderGroups(editor.getJSON(), sidebarIsOnRight(editor.view.dom)));
  const originRef = useRef<DragOrigin | null>(null);
  const [dragging, setDragging] = useState<DragOrigin | null>(null);
  const [target, setTarget] = useState<DropRegion | null>(null);
  const [emptyIds, setEmptyIds] = useState<Set<string>>(() => emptySectionIds(editor));

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
      setGroups(resumeSectionOrderGroups(editor.getJSON()));
    }
  }, [editor, groups]);

  const endDrag = () => {
    originRef.current = null;
    setDragging(null);
    setTarget(null);
  };

  if (!groups.length) return null;

  return (
    <div className="workbench-section-order">
      {groups.map((group) => {
        const sectionSlots = sectionIndexes(group.items);
        return (
          <div className="workbench-section-order-group" key={group.side ?? "single"}>
            {group.label ? <p className="workbench-section-order-group-label">{group.label}</p> : null}
            <ul className="workbench-section-order-list">
              {group.items.map((item, index) => {
                const fixed = item.nodeId === null;
                const position = sectionSlots.indexOf(index);
                const isDragging = dragging?.side === group.side && dragging.index === index;
                const isDropTarget = target?.side === group.side && target.index === index;
                const className = [
                  "workbench-section-order-row",
                  fixed ? "is-fixed" : "",
                  isDragging ? "is-dragging" : "",
                  isDropTarget ? `is-drop-${target?.edge}` : "",
                ].filter(Boolean).join(" ");
                return (
                  <li
                    key={item.nodeId ?? "identity"}
                    className={className}
                    draggable={!fixed && !disabled}
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
                      setTarget({ side: group.side, index, edge: dropEdge(event) });
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
                    <button
                      type="button"
                      className="workbench-section-order-title"
                      title={t("跳到「{value0}」", { value0: item.title })}
                      onClick={() => { jumpToSection(editor, item.nodeId); }}
                    >
                      {item.title}
                    </button>
                    {flaggedKinds?.has(item.kind) ? <i className="workbench-section-order-flag" aria-label={t("有待完善的内容")} /> : null}
                    {fixed ? <small className="workbench-section-order-hint">{t("固定在最前")}</small> : null}
                    {!fixed && item.nodeId && emptyIds.has(item.nodeId) ? <small className="workbench-section-order-hint">{t("空")}</small> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
