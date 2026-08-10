import { Reveal, SectionHeading } from '../components/Reveal'
import { JDCenter, ExtensionPopup } from '../components/mockups/JDCenter'
import { Search, Archive, MousePointerClick } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

const icons = [MousePointerClick, Search, Archive]

/** JD 中心 + Chrome 插件 */
export function JDSection() {
  const t = useT()
  return (
    <section id="jd" className="relative overflow-hidden border-b hairline">
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 40% at 85% 30%, var(--glow), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-20">
          <div>
            <SectionHeading
              index={t.jd.index}
              eyebrow={t.jd.eyebrow}
              title={<>{t.jd.title1}<br />{t.jd.title2}</>}
              description={t.jd.description}
            />
            <div className="mt-12 space-y-2">
              {t.jd.points.map((p, i) => {
                const Icon = icons[i]
                return (
                  <Reveal key={p.title} delay={0.1 + i * 0.08}>
                    <div className="flex gap-4 rounded-lg border border-transparent p-4 transition-colors hover:border-black/[0.08] hover:bg-black/[0.02] dark:hover:border-white/[0.08] dark:hover:bg-white/[0.02]">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-black/10 bg-black/[0.03] dark:border-white/12 dark:bg-white/[0.03]">
                        <Icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" strokeWidth={1.5} />
                      </span>
                      <div>
                        <div className="text-sm font-medium text-zinc-900 dark:text-white">{p.title}</div>
                        <div className="mt-1 text-[13px] leading-relaxed text-zinc-500">{p.desc}</div>
                      </div>
                    </div>
                  </Reveal>
                )
              })}
            </div>
          </div>

          <div className="relative">
            <Reveal delay={0.1}>
              <JDCenter />
            </Reveal>
            <Reveal delay={0.25} className="absolute -bottom-10 -right-2 hidden sm:block lg:-right-8">
              <div className="animate-float-slow">
                <ExtensionPopup />
              </div>
            </Reveal>
            {/* 移动端插件弹窗 */}
            <Reveal delay={0.25} className="mt-8 flex justify-center sm:hidden">
              <ExtensionPopup />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  )
}
