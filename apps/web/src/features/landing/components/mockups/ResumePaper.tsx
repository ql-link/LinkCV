/** 白底 A4 简历纸面模拟图 —— 黑场中的白纸，是整站的视觉签名 */
export function ResumePaper({ compact = false }: { compact?: boolean }) {
  return (
    <div className="paper relative aspect-[210/285] w-full overflow-hidden rounded-[3px] p-[8.5%] text-left select-none">
      {/* 页边距参考线 */}
      <div className="pointer-events-none absolute inset-[5%] border border-dashed border-zinc-900/10" aria-hidden />

      {/* 姓名区 */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-[1.9em] font-bold leading-none tracking-tight text-zinc-900">张三</div>
          <div className="mt-[0.5em] text-[0.85em] tracking-wide text-zinc-500">产品经理 · 上海</div>
        </div>
        <div className="pt-[0.2em] text-right text-[0.72em] leading-relaxed text-zinc-500">
          <div>138-0000-0000</div>
          <div>wanqing@example.com</div>
        </div>
      </div>

      <div className="mt-[1.2em] h-[1.5px] w-full bg-zinc-900/85" />

      {/* 工作经历 */}
      <Section title="工作经历">
        <Entry
          title="某科技公司 — 高级产品经理"
          date="2022.06 — 至今"
          lines={['负责核心求职工具产品线，主导 3 次重大版本迭代', '搭建简历编辑与导出链路，导出成功率提升至 99.2%']}
        />
        <Entry
          title="某互联网公司 — 产品经理"
          date="2019.07 — 2022.05"
          lines={['从 0 到 1 搭建岗位管理系统，服务 40 万求职者', '推动搜索与筛选改版，岗位匹配点击率提升 32%']}
        />
      </Section>

      {/* 项目经历 */}
      <Section title="项目经历">
        <Entry
          title="简历工作台重构 — 项目负责人"
          date="2023.03 — 2023.12"
          lines={['设计 A4 纸面编辑与版本管理方案，用户留存提升 18%']}
        />
      </Section>

      {/* 教育经历 */}
      <Section title="教育经历">
        <Entry title="某知名大学 — 计算机科学 · 本科" date="2015.09 — 2019.06" lines={[]} />
      </Section>

      {!compact && (
        <Section title="技能">
          <div className="flex flex-wrap gap-[0.45em]">
            {['产品设计', '数据分析', '用户研究', 'PRD 撰写', 'SQL'].map((s) => (
              <span key={s} className="border border-zinc-300 px-[0.6em] py-[0.2em] text-[0.68em] text-zinc-600">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-[1.15em]">
      <div className="flex items-center gap-[0.55em]">
        <span className="text-[0.92em] font-semibold tracking-[0.2em] text-zinc-900">{title}</span>
        <span className="h-px flex-1 bg-zinc-900/15" />
      </div>
      <div className="mt-[0.65em] space-y-[0.8em]">{children}</div>
    </div>
  )
}

function Entry({ title, date, lines }: { title: string; date: string; lines: string[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.82em] font-medium text-zinc-800">{title}</span>
        <span className="shrink-0 font-mono text-[0.66em] text-zinc-400">{date}</span>
      </div>
      {lines.map((l) => (
        <div key={l} className="mt-[0.3em] flex gap-[0.45em] text-[0.74em] leading-relaxed text-zinc-500">
          <span className="shrink-0 text-zinc-300">—</span>
          <span>{l}</span>
        </div>
      ))}
    </div>
  )
}
