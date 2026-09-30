import type { Editor } from "@tiptap/core";
import { useMemo, useState } from "react";

import type { ResumeCompletenessResult } from "./resumeCompleteness";
import type { ResumeSectionKind, ResumeSectionOrderGroup } from "./resumeSectionOrder";
import { WorkbenchPanelHeader } from "./WorkbenchPanelHeader";
import { WorkbenchSectionOrderControl, WorkbenchSectionOrderReset } from "./WorkbenchSectionOrderControl";

// 完整度检查的类别 → 大纲里受影响的模块类型（行尾橙点）
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

// 02.2a 大纲（Figma 509:410）：由正文里的「标题 2」生成，拖动排序（原「设置 → 模块顺序」）、点击跳转
export function WorkbenchOutlinePanel({
  editor,
  completeness,
  disabled,
  onClose,
}: {
  editor: Editor;
  completeness: ResumeCompletenessResult;
  disabled: boolean;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<ResumeSectionOrderGroup[]>([]);
  const flagged = useMemo(() => flaggedSectionKinds(completeness), [completeness]);
  const count = groups.reduce((total, group) => total + group.items.length, 0);
  const hasFlag = groups.some((group) => group.items.some((item) => flagged.has(item.kind)));

  return (
    <div className="wb3-outline-panel">
      <WorkbenchPanelHeader
        titleId="workbench-outline-title"
        title="大纲"
        subtitle="拖动调整模块顺序，点击跳到对应位置"
        closeLabel="关闭大纲"
        onClose={onClose}
      />
      <div className="wb3-panel-body">
        <div className="wb3-outline-meta">
          <span>{count} 个模块</span>
          <WorkbenchSectionOrderReset editor={editor} disabled={disabled} />
        </div>
        <WorkbenchSectionOrderControl editor={editor} disabled={disabled} flaggedKinds={flagged} onGroupsChange={setGroups} />
        {count === 0 ? <p className="wb3-outline-empty">正文里还没有「标题 2」模块。</p> : null}
        {hasFlag ? (
          <p className="wb3-outline-flag-note"><i aria-hidden="true" />有待完善的内容，详见「检查」</p>
        ) : null}
        <div className="wb3-outline-tip">
          <span className="wb3-outline-key" aria-hidden="true">/</span>
          <span>
            <strong>新增模块</strong>
            <small>在空行输入 /，选「标题 2」</small>
          </span>
        </div>
      </div>
    </div>
  );
}
