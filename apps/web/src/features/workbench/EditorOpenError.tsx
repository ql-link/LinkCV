import { t, useLocale } from "@/i18n";
import { V3Shell } from "../../v3/Shell";
import { Bar, Centered, Paper } from "../../v3/art";
import "./workbench-v3.css";

// 10.3 局部状态 · 简历编辑器打开失败（Figma 494:2）：无侧栏整窗，内容卡中央一张 440 宽状态卡。
// 插图：迷你简历 80×100 + 右下红色「!」角标；标题「无法打开这份简历」+ 错误原因 + 提示 + 「返回主页 / 重新尝试」。
export function EditorOpenError({
  message,
  onBack,
  onRetry,
}: {
  message: string;
  onBack: () => void;
  onRetry: () => void;
}) {
  useLocale();
  return (
    <V3Shell active="none" bare scroll={false}>
      <div className="wb3-open-error-wrap">
        <section className="v3-empty is-error wb3-open-error" role="alert" aria-labelledby="wb3-open-error-title">
          <div className="v3-stage has-dots">
            <Centered width={424} height={128}>
              <Paper x={172} y={16} w={80} h={100} r={4} shadow={false}>
                <Bar x={8} y={8} w={34} h={5} color="var(--v3-fnt2)" />
                <Bar x={8} y={15} w={48} h={2} color="var(--v3-sk2)" />
                {[24, 46, 72].map((top) => (
                  <span key={top}>
                    <Bar x={8} y={top} w={18} h={3} color="var(--v3-fnt2)" />
                    <Bar x={8} y={top + 5} w={64} h={1} color="var(--v3-line)" />
                    <Bar x={8} y={top + 7} w={60} h={2} color="var(--v3-line)" />
                    <Bar x={8} y={top + 11} w={60} h={2} color="var(--v3-line)" />
                    <Bar x={8} y={top + 15} w={40} h={2} color="var(--v3-line)" />
                  </span>
                ))}
              </Paper>
              <span className="wb3-open-error-badge" aria-hidden="true">!</span>
            </Centered>
          </div>
          <h3 id="wb3-open-error-title">{t("无法打开这份简历")}</h3>
          <p className="wb3-open-error-reason">{message}</p>
          <p className="wb3-open-error-hint">{t("你可以返回主页选择其他简历，或稍后重试。")}</p>
          <div className="v3-empty-actions wb3-open-error-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={onBack}>{t("返回主页")}</button>
            <button type="button" className="v3-btn v3-btn-dark is-lg" onClick={onRetry}>{t("重新尝试")}</button>
          </div>
        </section>
      </div>
    </V3Shell>
  );
}
