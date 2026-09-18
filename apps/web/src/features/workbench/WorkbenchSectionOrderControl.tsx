import type { Editor } from "@tiptap/core";
import { GripVertical, Lock, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  applySectionOrder,
  moveSectionItem,
  resetSectionOrder,
  resumeSectionOrderGroups,
  type ResumeColumnSide,
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
  return (
    <button
      type="button"
      className="workbench-section-order-reset"
      disabled={disabled}
      onClick={() => { resetSectionOrder(editor); }}
    >
      <RotateCcw aria-hidden="true" size={13} />
      恢复默认
    </button>
  );
}

export function WorkbenchSectionOrderControl({
  editor,
  disabled = false,
}: {
  editor: Editor;
  disabled?: boolean;
}) {
  const [groups, setGroups] = useState<ResumeSectionOrderGroup[]>(() =>
    resumeSectionOrderGroups(editor.getJSON()));
  const originRef = useRef<DragOrigin | null>(null);
  const [dragging, setDragging] = useState<DragOrigin | null>(null);
  const [target, setTarget] = useState<DropRegion | null>(null);

  useEffect(() => {
    let lastDoc = editor.state.doc;
    const refresh = () => {
      // Programmatic replaces (模板切换、版本恢复) also land here, so watch every
      // transaction but only serialize when the document itself changed.
      if (editor.state.doc === lastDoc) return;
      lastDoc = editor.state.doc;
      setGroups(resumeSectionOrderGroups(editor.getJSON()));
    };
    refresh();
    editor.on("transaction", refresh);
    return () => {
      editor.off("transaction", refresh);
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
                      <span className="workbench-section-order-fixed" aria-hidden="true"><Lock size={13} /></span>
                    ) : (
                      <button
                        type="button"
                        className="workbench-section-order-handle"
                        disabled={disabled}
                        aria-label={`调整「${item.title}」顺序，可用上下方向键移动`}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          const next = position + (event.key === "ArrowUp" ? -1 : 1);
                          if (next < 0 || next >= sectionSlots.length) return;
                          event.preventDefault();
                          moveSection(group.side, index, sectionSlots[next]);
                        }}
                      >
                        <GripVertical aria-hidden="true" size={14} />
                      </button>
                    )}
                    <span className="workbench-section-order-title">{item.title}</span>
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
