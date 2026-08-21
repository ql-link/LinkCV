import { Reveal, SectionHeading } from '../components/Reveal'
import { VersionTimeline } from '../components/mockups/VersionTimeline'
import { ResumePaper } from '../components/mockups/ResumePaper'
import { FileDown, Minimize2, Check } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

/** 版本管理 + PDF 导出 两个深潜区块 */
export function VersionExport() {
  const t = useT()
  return (
    <>
      {/* 版本管理 */}
      <section className="border-b hairline">
        <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
          <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-20">
            <Reveal delay={0.1} className="order-2 lg:order-1">
              <VersionTimeline />
            </Reveal>
            <div className="order-1 lg:order-2">
              <SectionHeading
                index={t.version.index}
                eyebrow={t.version.eyebrow}
                title={<>{t.version.title1}<br />{t.version.title2}</>}
                description={t.version.description}
              />
              <Reveal delay={0.2}>
                <ul className="mt-10 space-y-4">
                  {t.version.bullets.map((text) => (
                    <li key={text} className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-black/20 dark:border-white/20">
                        <Check className="h-3 w-3 text-zinc-600 dark:text-zinc-300" />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      {/* PDF 导出 */}
      <section className="relative overflow-hidden border-b hairline">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 45% 40% at 20% 50%, var(--glow), transparent 70%)' }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
          <SectionHeading
            index={t.export.index}
            eyebrow={t.export.eyebrow}
            title={<>{t.export.title1}<br />{t.export.title2}</>}
            align="center"
          />
          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {/* 标准 A4 分页 */}
            <Reveal className="group relative flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-white p-8 transition-colors hover:border-black/25 sm:p-10 dark:border-white/[0.08] dark:bg-[#0b0b0d] dark:hover:border-white/20">
              <div className="flex items-center justify-between">
                <FileDown className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
                <span className="font-mono text-xs text-zinc-600">MODE A</span>
              </div>
              <h3 className="mt-8 text-xl font-medium text-zinc-900 dark:text-white">{t.export.modeA}</h3>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-500">
                {t.export.modeADesc}
              </p>
              <div className="mt-auto pt-12">
                <div className="flex items-end justify-center gap-4 rounded-md bg-black/[0.035] px-6 py-6 dark:bg-white/[0.04]">
                  {[0, 1].map((i) => (
                    <div key={i} className={`w-36 text-[6px] ${i === 1 ? 'opacity-45 saturate-0' : ''}`}>
                      <ResumePaper compact />
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* 智能一页 */}
            <Reveal delay={0.12} className="group relative flex flex-col overflow-hidden rounded-lg border border-black/[0.08] bg-white p-8 transition-colors hover:border-black/25 sm:p-10 dark:border-white/[0.08] dark:bg-[#0b0b0d] dark:hover:border-white/20">
              <div className="flex items-center justify-between">
                <Minimize2 className="h-5 w-5 text-zinc-400" strokeWidth={1.5} />
                <span className="font-mono text-xs text-zinc-600">MODE B</span>
              </div>
              <h3 className="mt-8 text-xl font-medium text-zinc-900 dark:text-white">{t.export.modeB}</h3>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-500">
                {t.export.modeBDesc}
              </p>
              <div className="mt-auto pt-12">
                <div className="flex items-end justify-center gap-5 rounded-md bg-black/[0.035] px-6 py-6 sm:gap-7 dark:bg-white/[0.04]">
                  <div className="flex gap-2">
                    {[0, 1].map((i) => (
                      <div key={i} className="w-[4.8rem] text-[3.5px] opacity-50 saturate-0">
                        <ResumePaper compact />
                      </div>
                    ))}
                  </div>
                  <span className="pb-16 font-mono text-xl text-zinc-400 dark:text-zinc-600">→</span>
                  <div className="w-28 text-[5px]">
                    <ResumePaper compact />
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>
    </>
  )
}
