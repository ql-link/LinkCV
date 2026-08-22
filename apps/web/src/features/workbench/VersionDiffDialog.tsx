import { diffLines, type Change } from "diff";
import { useEffect, useMemo, useState } from "react";
import { api, type ResumeStyleV1, type ResumeVersion } from "../../api/client";
import { resumeDocumentToMarkdown, styleToEditorSettings } from "../../api/resumeContract";
import type { ResumeSettings } from "../../store/resumeStore";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui";

type StyleDifference = { label: string; current: string; historical: string };

export function compareVersionStyles(current: ResumeSettings, historical: ResumeStyleV1): StyleDifference[] {
  const previous = styleToEditorSettings(historical);
  const values: Array<[string, string, string]> = [
    ["字体", current.fontFamily, previous.fontFamily],
    ["字号", `${current.fontSize} pt`, `${previous.fontSize} pt`],
    ["行距", String(current.lineHeight), String(previous.lineHeight)],
    ["左右边距", `${current.pageMargin} mm`, `${previous.pageMargin} mm`],
    ["上下边距", `${current.verticalPageMargin} mm`, `${previous.verticalPageMargin} mm`],
    ["模板", current.theme, previous.theme],
    ["智能一页", current.smartOnePage ? "开启" : "关闭", previous.smartOnePage ? "开启" : "关闭"],
  ];
  return values.filter(([, left, right]) => left !== right).map(([label, left, right]) => ({ label, current: left, historical: right }));
}

export function VersionDiffDialog({
  open,
  resumeId,
  version,
  currentMarkdown,
  currentSettings,
  restoring,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  resumeId: string;
  version: Pick<ResumeVersion, "version_no" | "name"> | null;
  currentMarkdown: string;
  currentSettings: ResumeSettings;
  restoring: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [record, setRecord] = useState<ResumeVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!open || !version) return;
    setLoading(true);
    setError(null);
    setRecord(null);
    void api.getResumeVersion(resumeId, version.version_no)
      .then(({ version: loaded }) => {
        if (!cancelled) setRecord(loaded);
      })
      .catch(() => {
        if (!cancelled) setError("版本内容读取失败，请关闭后重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, resumeId, version]);

  const historicalMarkdown = record?.data ? resumeDocumentToMarkdown(record.data) : "";
  const changes = useMemo<Change[]>(() => record?.data ? diffLines(currentMarkdown, historicalMarkdown) : [], [currentMarkdown, historicalMarkdown, record]);
  const styleDifferences = useMemo(() => record?.style ? compareVersionStyles(currentSettings, record.style) : [], [currentSettings, record]);
  const hasDifferences = changes.some((change) => change.added || change.removed) || styleDifferences.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !restoring && onOpenChange(next)}>
      <DialogContent className="version-diff-dialog">
        <DialogHeader>
          <DialogTitle>恢复“{version?.name ?? "历史版本"}”前确认差异</DialogTitle>
          <DialogDescription>红色是当前版本将被移除的内容，绿色是恢复后写入的内容。确认前不会修改简历。</DialogDescription>
        </DialogHeader>
        {loading ? <p className="version-diff-status" role="status">正在读取版本内容…</p> : null}
        {error ? <p className="version-diff-status is-error" role="alert">{error}</p> : null}
        {!loading && !error && record ? (
          <div className="version-diff-body">
            {!hasDifferences ? <p className="version-diff-status">当前内容与该版本一致，无需恢复。</p> : null}
            {styleDifferences.length > 0 ? (
              <section className="version-style-diff" aria-labelledby="version-style-diff-title">
                <h3 id="version-style-diff-title">页面设置</h3>
                {styleDifferences.map((item) => (
                  <p key={item.label}><strong>{item.label}</strong><del>{item.current}</del><ins>{item.historical}</ins></p>
                ))}
              </section>
            ) : null}
            {changes.some((change) => change.value) ? (
              <section className="version-content-diff" aria-label="正文差异">
                {changes.map((change, index) => (
                  <pre className={change.added ? "is-added" : change.removed ? "is-removed" : "is-unchanged"} key={`${index}-${change.value.slice(0, 16)}`}>{change.value}</pre>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" disabled={restoring} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={loading || Boolean(error) || !hasDifferences || restoring} onClick={() => void onConfirm()}>
            {restoring ? "正在恢复…" : "确认恢复"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
