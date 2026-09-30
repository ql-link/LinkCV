/**
 * Conversion funnel (LOCAL-20260929-GTM-PLAN solution.md R6, §8 `GET /api/admin/insights/funnel`).
 * No Figma frame exists; the page reuses the V4 blocks: metric strip, step bars, ramp bars and donuts.
 * Cohort = users registered in the window; each step counts how many of them have reached it so far.
 */
import { BadgeCheck, FileDown, FileText, Mic, Shield, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { api, type AdminFunnelStepKey, type AdminInsightFunnel } from "../../api/client";
import { Donut, DonutLegend, SERIES_COLORS, ThinBars, type DonutSlice } from "./charts";
import {
  ErrorState,
  Footnote,
  LoadingRegion,
  Metrics,
  PageHeader,
  Segmented,
  SkeletonChart,
  SkeletonMetrics,
  formatDayLabel,
  formatNumber,
  type Tint,
} from "./kit";
import { useLoad } from "./kit";

const ranges = { "7d": 7, "14d": 14, "31d": 31 } as const;
type Range = keyof typeof ranges;

const steps: Record<AdminFunnelStepKey, { label: string; hint: string; icon: LucideIcon; tint: Tint }> = {
  registered: { label: "注册", hint: "该时段新注册的用户", icon: UserPlus, tint: "blue" },
  resume: { label: "有简历", hint: "用模板创建或导入过简历", icon: FileText, tint: "green" },
  ai_customization: { label: "首次 AI 定制", hint: "确认过一次 AI 修改提案", icon: Sparkles, tint: "violet" },
  mock_interview: { label: "模拟面试完成", hint: "完成过一场模拟面试", icon: Mic, tint: "amber" },
  pdf_export: { label: "首次 PDF 导出", hint: "导出过一次 PDF", icon: FileDown, tint: "gray" },
};

const methodLabels: Record<string, string> = { wechat_qr: "微信扫码", wechat_miniprogram: "小程序", email: "邮箱", unknown: "未知（历史微信账号）" };
const entryLabels: Record<string, string> = { assistant: "助手页", editor: "编辑器侧栏", unknown: "未知" };
const sourceLabels: Record<string, string> = { template: "模板创建", import: "文件导入", copy: "复制", translate: "翻译", unknown: "未知" };

export function share(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

function slices(counts: Record<string, number>, labels: Record<string, string>): DonutSlice[] {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], index) => ({ key, label: labels[key] ?? key, value, color: SERIES_COLORS[index % SERIES_COLORS.length] }));
}

export function FunnelPage() {
  const [range, setRange] = useState<Range>("31d");
  const funnel = useLoad(() => {
    const to = new Date();
    return api.adminInsightFunnel({ from: new Date(to.getTime() - ranges[range] * 86400_000).toISOString(), to: to.toISOString() });
  }, [range]);
  const data = funnel.data;

  return (
    <>
      <PageHeader
        title="转化漏斗"
        hint="按注册时间分组，统计这些用户截至现在走到了哪一步"
        actions={<Segmented label="时间范围" value={range} onChange={setRange} options={[{ value: "7d", label: "7 天" }, { value: "14d", label: "14 天" }, { value: "31d", label: "31 天" }]} />}
      />
      {funnel.loading && !data ? (
        <LoadingRegion label="正在加载转化漏斗…"><SkeletonMetrics /><SkeletonChart height={260} /></LoadingRegion>
      ) : !data ? (
        <ErrorState title="无法读取转化漏斗" code={funnel.error} onRetry={() => void funnel.reload()} />
      ) : (
        <FunnelBody data={data} range={range} />
      )}
      <Footnote icon={Shield}>只统计行为是否发生、发生时间和入口，不包含简历或对话内容。上线前的 PDF 导出与 AI 定制入口没有记录。</Footnote>
    </>
  );
}

function FunnelBody({ data, range }: { data: AdminInsightFunnel; range: Range }) {
  const byKey = new Map(data.steps.map((step) => [step.key, step.users]));
  const registered = byKey.get("registered") ?? 0;
  const ordered = (Object.keys(steps) as AdminFunnelStepKey[]).map((key) => ({ key, users: byKey.get(key) ?? 0, ...steps[key] }));
  const methodSlices = slices(data.registrationsByMethod, methodLabels);
  const sourceSlices = slices(data.resumeBySource, sourceLabels);
  const entrySlices = slices(data.aiCustomizationByEntry, entryLabels);

  return (
    <>
      <Metrics items={[
        { label: "新注册", value: formatNumber(registered), icon: UserPlus, tint: "blue" },
        { label: "有简历", value: share(byKey.get("resume") ?? 0, registered), note: `${formatNumber(byKey.get("resume") ?? 0)} 人`, icon: FileText, tint: "green" },
        { label: "AI 定制", value: share(byKey.get("ai_customization") ?? 0, registered), note: `${formatNumber(byKey.get("ai_customization") ?? 0)} 人`, icon: Sparkles, tint: "violet" },
        { label: "PDF 导出", value: share(byKey.get("pdf_export") ?? 0, registered), note: `${formatNumber(byKey.get("pdf_export") ?? 0)} 人`, icon: BadgeCheck, tint: "amber" },
      ]} />

      <section className="adm-section adm-funnel" aria-label="逐步转化">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>逐步转化</h2><span>最近 {ranges[range]} 天注册的 {formatNumber(registered)} 位用户</span></div>
        </div>
        {registered === 0 ? <div className="adm-state"><strong>该时间范围内没有新注册用户</strong></div> : (
          <ol className="adm-funnel-steps">
            {ordered.map((step, index) => {
              const previous = index === 0 ? step.users : ordered[index - 1].users;
              const width = registered > 0 ? Math.max(step.users > 0 ? 2 : 0, (step.users / registered) * 100) : 0;
              const Icon = step.icon;
              return (
                <li key={step.key} style={{ "--adm-i": index } as React.CSSProperties}>
                  <span className="adm-funnel-name"><Icon size={16} aria-hidden="true" /><span><strong>{step.label}</strong><small>{step.hint}</small></span></span>
                  <span className="adm-funnel-track" aria-hidden="true"><i className={`adm-funnel-bar is-${step.tint}`} style={{ width: `${width}%` }} /></span>
                  <span className="adm-funnel-users"><strong>{formatNumber(step.users)}</strong><small>{share(step.users, registered)}</small></span>
                  <span className="adm-funnel-step">{index === 0 ? "—" : `上一步 ${share(step.users, previous)}`}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <span className="adm-rule" aria-hidden="true" />
      <section className="adm-section adm-imports" aria-label="每日注册">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>每日注册</h2><span>最近 {ranges[range]} 天</span></div>
        </div>
        <ThinBars
          ramp
          height={180}
          ariaLabel={`最近 ${ranges[range]} 天每日注册`}
          data={data.daily.map((day, index) => ({
            key: day.date,
            label: index === data.daily.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
            value: day.registered,
            tooltip: <><small>{formatDayLabel(day.date)}</small><strong>注册 {day.registered} 人</strong></>,
          }))}
        />
      </section>

      <span className="adm-rule" aria-hidden="true" />
      <section className="adm-section" aria-label="来源分布">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>来源分布</h2><span>该组用户的首个对应行为</span></div>
        </div>
        <div className="adm-funnel-mix">
          <Mix title="注册方式" slices={methodSlices} unit="人" />
          <span className="adm-vrule" aria-hidden="true" />
          <Mix title="首份简历来源" slices={sourceSlices} unit="份" />
          <span className="adm-vrule" aria-hidden="true" />
          <Mix title="AI 定制入口" slices={entrySlices} unit="次" />
        </div>
      </section>
    </>
  );
}

function Mix({ title, slices: items, unit }: { title: string; slices: DonutSlice[]; unit: string }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <div>
      <div className="adm-block-title is-sub"><h2>{title}</h2></div>
      {total === 0 ? <p className="adm-muted adm-empty-donut">暂无数据</p> : (
        <div className="adm-donut-body is-column">
          <Donut size={132} ariaLabel={title} slices={items} center={formatNumber(total)} sub={unit} />
          <DonutLegend slices={items} />
        </div>
      )}
    </div>
  );
}
