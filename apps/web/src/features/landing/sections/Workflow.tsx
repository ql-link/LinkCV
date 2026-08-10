import { Reveal, SectionHeading } from '../components/Reveal'
import { useT } from '../locales/LanguageContext'

/** 工作流：四步横向时间线 */
export function Workflow() {
  const t = useT()
  return (
    <section className="border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHeading index={t.workflow.index} eyebrow={t.workflow.eyebrow} title={t.workflow.title} align="center" />
        <div className="relative mt-20 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* 连接线 */}
          <div className="absolute top-[7px] right-[12%] left-[12%] hidden h-px bg-black/10 lg:block dark:bg-white/10" aria-hidden />
          {t.workflow.steps.map((s, i) => (
            <Reveal key={s.num} delay={i * 0.12} className="relative text-center lg:text-left">
              <div className="relative mx-auto flex h-[15px] w-[15px] items-center justify-center lg:mx-0">
                <span className="absolute h-full w-full rounded-full border border-black/20 bg-[#fafaf9] dark:border-white/20 dark:bg-[#0e0e10]" />
                <span className="relative h-[5px] w-[5px] rounded-full bg-zinc-900 dark:bg-white" />
              </div>
              <div className="mt-6 font-mono text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-600">{s.num}</div>
              <h3 className="mt-2 font-display text-xl font-medium text-zinc-900 dark:text-white">{s.title}</h3>
              <p className="mx-auto mt-2.5 max-w-[240px] text-sm leading-relaxed text-zinc-500 lg:mx-0">{s.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
