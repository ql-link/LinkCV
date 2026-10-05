/**
 * Conversion funnel (LOCAL-20260929-GTM-PLAN solution.md R6, §8 `GET /api/admin/insights/funnel`).
 * Figma V4 · 15 转化漏斗 (649:563): the main chain 注册 → 有简历 → 首次 AI 定制 → 首次 PDF 导出 shows the
 * step-over-step rate and loss between rows with the largest drop highlighted; the mock interview is an
 * optional step outside the chain, shown against the cohort only.
 * Cohort = users registered in the window; each step counts how many of them have reached it so far.
 */
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { FileDown, FileText, Info, Mic, Shield, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { api, type AdminFunnelStepKey, type AdminInsightFunnel } from "../../api/client";
import { SERIES_COLORS, ThinBars } from "./charts";
import {
  Chip,
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
  useLoad,
  type Tint,
} from "./kit";

const ranges = { "7d": 7, "14d": 14, "31d": 31 } as const;
type Range = keyof typeof ranges;

type StepMeta = { label: string; hint: string; icon: LucideIcon; tint: Tint };
const steps: Record<AdminFunnelStepKey, StepMeta> = {
  registered: { label: "注册", hint: "该时段新注册", icon: UserPlus, tint: "blue" },
  resume: { label: "有简历", hint: "模板创建或导入", icon: FileText, tint: "green" },
  ai_customization: { label: "首次 AI 定制", hint: "确认过一次 AI 修改", icon: Sparkles, tint: "violet" },
  pdf_export: { label: "首次 PDF 导出", hint: "导出过一次 PDF", icon: FileDown, tint: "gray" },
  mock_interview: { label: "模拟面试完成", hint: "完成过一场模拟面试", icon: Mic, tint: "amber" },
};
/** The chain whose adjacent steps are compared; the mock interview is optional and sits outside it. */
export const MAIN_CHAIN: AdminFunnelStepKey[] = ["registered", "resume", "ai_customization", "pdf_export"];

const methodLabels: Record<string, string> = { wechat_qr: "微信扫码", wechat_miniprogram: "小程序", email: "邮箱", unknown: "未知（历史微信账号）" };
const entryLabels: Record<string, string> = { assistant: "助手页", editor: "编辑器侧栏", unknown: "未知" };
const sourceLabels: Record<string, string> = { template: "模板创建", import: "文件导入", copy: "复制", translate: "翻译", unknown: "未知" };

export function share(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "—";
}

/** Index of the step with the lowest rate against its predecessor; null when nothing drops. */
export function worstDrop(users: number[]): number | null {
  let worst: number | null = null;
  let lowest = 1;
  for (let index = 1; index < users.length; index += 1) {
    const previous = users[index - 1];
    if (previous <= 0) continue;
    const rate = users[index] / previous;
    if (rate < lowest) {
      lowest = rate;
      worst = index;
    }
  }
  return worst;
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
        actions={
          <>
            <Segmented label="时间范围" value={range} onChange={setRange} options={[{ value: "7d", label: "7 天" }, { value: "14d", label: "14 天" }, { value: "31d", label: "31 天" }]} />
            <DefinitionButton />
          </>
        }
      />
      {funnel.loading && !data ? (
        <LoadingRegion label="正在加载转化漏斗…"><SkeletonMetrics /><SkeletonChart height={300} /></LoadingRegion>
      ) : !data ? (
        <ErrorState title="无法读取转化漏斗" code={funnel.error} onRetry={() => void funnel.reload()} />
      ) : (
        <FunnelBody data={data} range={range} />
      )}
      <Footnote icon={Shield}>只统计行为是否发生、发生时间和入口，不包含简历或对话内容。上线前的 PDF 导出与 AI 定制入口没有记录。</Footnote>
    </>
  );
}

function DefinitionButton() {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger className="adm-btn adm-btn-secondary">
        <Info size={14} strokeWidth={2} aria-hidden="true" />统计口径
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="adm-select-content adm-funnel-def" align="end" sideOffset={8} collisionPadding={12} aria-label="统计口径">
          <dl>
            <div><dt>用户组</dt><dd>所选时间段内注册的用户；后续每一步统计这些用户截至现在是否做过。</dd></div>
            <div><dt>有简历</dt><dd>用模板创建或导入过简历；复制与翻译来自已有简历，不计入。</dd></div>
            <div><dt>首次 AI 定制</dt><dd>确认过一次 AI 修改提案并写入简历；翻译提案不算。</dd></div>
            <div><dt>首次 PDF 导出</dt><dd>本人导出过一次 PDF；分享页访客下载不算。</dd></div>
            <div><dt>模拟面试完成</dt><dd>完成过一场并生成报告；不在主链路上，只和注册人数比较。</dd></div>
          </dl>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function FunnelBody({ data, range }: { data: AdminInsightFunnel; range: Range }) {
  const byKey = new Map(data.steps.map((step) => [step.key, step.users]));
  const count = (key: AdminFunnelStepKey) => byKey.get(key) ?? 0;
  const registered = count("registered");
  const chain = MAIN_CHAIN.map((key) => ({ key, users: count(key), ...steps[key] }));
  const worst = worstDrop(chain.map((step) => step.users));
  const peak = data.daily.reduce<{ date: string; registered: number } | null>((best, day) => (!best || day.registered > best.registered ? day : best), null);

  return (
    <>
      <Metrics items={[
        { label: "新注册", value: formatNumber(registered), icon: UserPlus, tint: "blue" },
        { label: "有简历", value: share(count("resume"), registered), note: `${formatNumber(count("resume"))} 人`, icon: FileText, tint: "green" },
        { label: "AI 定制", value: share(count("ai_customization"), registered), note: `${formatNumber(count("ai_customization"))} 人`, icon: Sparkles, tint: "violet" },
        { label: "PDF 导出", value: share(count("pdf_export"), registered), note: `${formatNumber(count("pdf_export"))} 人`, icon: FileDown, tint: "amber" },
      ]} />

      <section className="adm-section adm-funnel" aria-label="逐步转化">
        <div className="adm-block-head">
          <div className="adm-block-title"><h2>逐步转化</h2><span>最近 {ranges[range]} 天注册的 {formatNumber(registered)} 位用户，截至现在走到了哪一步</span></div>
          {registered > 0 && worst !== null && <span className="adm-funnel-key"><i aria-hidden="true" />流失最多的一步</span>}
        </div>
        {registered === 0 ? <div className="adm-state"><strong>该时间范围内没有新注册用户</strong></div> : (
          <ol className="adm-funnel-steps">
            {chain.map((step, index) => (
              <FunnelStep
                key={step.key}
                step={step}
                index={index}
                registered={registered}
                drop={index === 0 ? null : { rate: share(step.users, chain[index - 1].users), lost: Math.max(0, chain[index - 1].users - step.users), worst: index === worst }}
              />
            ))}
            <li className="adm-funnel-optional" aria-hidden="true"><span>可选步骤 · 不在主链路上，按注册用户计算占比</span></li>
            <FunnelStep step={{ key: "mock_interview", users: count("mock_interview"), ...steps.mock_interview }} index={chain.length} registered={registered} drop={null} optional />
          </ol>
        )}
      </section>

      <span className="adm-rule" aria-hidden="true" />
      <div className="adm-funnel-split">
        <section className="adm-section" aria-label="每日注册">
          <div className="adm-block-head">
            <div className="adm-block-title">
              <h2>每日注册</h2>
              <span>最近 {ranges[range]} 天{peak && peak.registered > 0 ? ` · 峰值 ${Number(peak.date.slice(5, 7))}/${Number(peak.date.slice(8, 10))} · ${formatNumber(peak.registered)} 人` : ""}</span>
            </div>
          </div>
          <ThinBars
            ramp
            height={128}
            ariaLabel={`最近 ${ranges[range]} 天每日注册`}
            data={data.daily.map((day, index) => ({
              key: day.date,
              label: index === data.daily.length - 1 ? "今天" : `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`,
              value: day.registered,
              tooltip: <><small>{formatDayLabel(day.date)}</small><strong>注册 {day.registered} 人</strong></>,
            }))}
          />
        </section>
        <span className="adm-vrule" aria-hidden="true" />
        <section className="adm-section adm-funnel-sources" aria-label="来源分布">
          <div className="adm-block-head">
            <div className="adm-block-title"><h2>来源分布</h2><span>该组用户的首个对应行为</span></div>
          </div>
          <Mix title="注册方式" counts={data.registrationsByMethod} labels={methodLabels} unit="人" />
          <Mix title="首份简历来源" counts={data.resumeBySource} labels={sourceLabels} unit="人" />
          <Mix title="AI 定制入口" counts={data.aiCustomizationByEntry} labels={entryLabels} unit="人" />
        </section>
      </div>
    </>
  );
}

type StepView = { key: AdminFunnelStepKey; users: number } & StepMeta;

function FunnelStep({ step, index, registered, drop, optional = false }: { step: StepView; index: number; registered: number; drop: { rate: string; lost: number; worst: boolean } | null; optional?: boolean }) {
  const width = registered > 0 ? Math.max(step.users > 0 ? 1 : 0, (step.users / registered) * 100) : 0;
  return (
    <li className={`adm-funnel-step${optional ? " is-optional" : ""}`} style={{ "--adm-i": index } as React.CSSProperties}>
      {drop && (
        <span className={`adm-funnel-drop${drop.worst ? " is-worst" : ""}`}>
          <b>↓ {drop.rate}</b><span>流失 {formatNumber(drop.lost)} 人</span>
        </span>
      )}
      <span className="adm-funnel-row">
        <span className="adm-funnel-name"><Chip icon={step.icon} tint={step.tint} /><span><strong>{step.label}</strong><small>{step.hint}</small></span></span>
        <span className="adm-funnel-track" aria-hidden="true"><i className={`adm-funnel-bar is-${step.tint}`} style={{ width: `${width}%` }} /></span>
        <span className="adm-funnel-users"><strong>{formatNumber(step.users)}</strong><small>{index === 0 ? "100%" : `${share(step.users, registered)} 的注册用户`}</small></span>
      </span>
    </li>
  );
}

function Mix({ title, counts, labels, unit }: { title: string; counts: Record<string, number>; labels: Record<string, string>; unit: string }) {
  const items = Object.entries(counts).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = items.reduce((sum, [, value]) => sum + value, 0);
  return (
    <div className="adm-funnel-mix">
      <div className="adm-funnel-mix-top"><strong>{title}</strong><span>{total > 0 ? `${formatNumber(total)} ${unit}` : "暂无数据"}</span></div>
      {total > 0 && (
        <>
          <span className="adm-funnel-stack" role="img" aria-label={`${title}：${items.map(([key, value]) => `${labels[key] ?? key} ${share(value, total)}`).join("，")}`}>
            {items.map(([key, value], index) => <i key={key} style={{ flexGrow: value, background: SERIES_COLORS[index % SERIES_COLORS.length] }} />)}
          </span>
          <ul className="adm-funnel-legend">
            {items.map(([key, value], index) => (
              <li key={key}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} aria-hidden="true" />{labels[key] ?? key}<b>{Math.round((value / total) * 100)}%</b></li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
