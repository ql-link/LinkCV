import { t, useLocale } from "@/i18n";
import type { JobDuplicateDetails } from "../../api/client";
import { Badge, Bar, Centered, Paper } from "@/v3/art";
import { ConfirmDialog } from "@/v3/primitives";

type DuplicateAction = "update" | "cancel";

// 发现相同来源：用 V3 居中确认弹窗。更新原记录不是危险操作，所以主按钮用黑色
export function JobDuplicateDialog({
  details,
  busy,
  onAction,
}: {
  details: JobDuplicateDetails["duplicate"];
  busy: boolean;
  onAction: (action: DuplicateAction) => void | Promise<void>;
}) {
  useLocale();
  return (
    <ConfirmDialog
      title={details.existing.job_title}
      description={<>{t("发现相同来源：这条岗位已经存在。")}<br />{t("可以更新原记录，系统不会创建第二条。")}</>}
      art={<DuplicateArt />}
      confirmLabel={t("更新原记录")}
      busyLabel={t("正在处理…")}
      danger={false}
      busy={busy}
      onCancel={() => void onAction("cancel")}
      onConfirm={() => void onAction("update")}
    />
  );
}

// 两张重叠的岗位卡 + 蓝色刷新角标（舞台 372×128）
function DuplicateArt() {
  useLocale();
  return (
    <Centered width={372} height={128}>
      <Paper x={106} y={22} w={150} h={64} r={8} style={{ opacity: 0.55 }}>
        <Bar x={12} y={12} w={70} h={6} color="var(--v3-sk2)" r={3} />
        <Bar x={12} y={26} w={100} h={4} r={2} />
      </Paper>
      <Paper x={122} y={40} w={150} h={64} r={8}>
        <Bar x={12} y={12} w={70} h={6} color="var(--v3-dark)" r={3} />
        <Bar x={12} y={26} w={100} h={4} r={2} />
        <Bar x={12} y={42} w={40} h={12} color="var(--v3-field)" r={3} />
      </Paper>
      <Badge x={258} y={84} size={30} icon="refresh" fill="var(--v3-bl-soft)" color="var(--v3-bl)" border="#d4e0f6" />
    </Centered>
  );
}
