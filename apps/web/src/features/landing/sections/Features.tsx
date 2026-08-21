import { Reveal, SectionHeading } from '../components/Reveal'
import { ChromeIcon } from '../components/ChromeIcon'
import { FileText, History, FileDown, Briefcase } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

const icons = [FileText, History, FileDown, Briefcase, ChromeIcon]

const cardClass =
  'group relative rounded-2xl border border-black/[0.06] bg-white p-7 shadow-[0_1px_3px_rgb(0_0_0/0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.08)] dark:border-white/[0.07] dark:bg-[#131315] dark:shadow-none dark:hover:bg-[#17171a] dark:hover:shadow-none'

export function Features() {
  const t = useT()
  return (
    <section id="features" className="border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHeading
          index={t.features.index}
          eyebrow={t.features.eyebrow}
          title={<>{t.features.title1}<br />{t.features.title2}</>}
          description={t.features.description}
        />

        <div className="mt-16 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {t.features.items.map((f, i) => {
            const Icon = icons[i]
            return (
              <Reveal key={f.num} delay={i * 0.08} className={cardClass}>
                <div className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] dark:bg-white/[0.06] dark:group-hover:bg-white/[0.1]">
                    <Icon className="h-[18px] w-[18px] text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-white" strokeWidth={1.5} />
                  </span>
                  <span className="font-mono text-[11px] text-zinc-300 dark:text-zinc-600">{f.num}</span>
                </div>
                <h3 className="mt-8 text-lg font-medium text-zinc-900 dark:text-white">{f.title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-zinc-500">{f.desc}</p>
              </Reveal>
            )
          })}
          {/* 第六格：占位宣言 */}
          <Reveal
            delay={0.4}
            className="relative flex items-center overflow-hidden rounded-2xl border border-dashed border-black/[0.1] p-7 dark:border-white/[0.12]"
          >
            <p className="font-mono text-[11px] leading-loose tracking-[0.06em] text-zinc-400 dark:text-zinc-600">
              {t.features.manifesto.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < t.features.manifesto.length - 1 && <br />}
                </span>
              ))}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
