import { Reveal, SectionHeading } from '../components/Reveal'
import { ResumePaper } from '../components/mockups/ResumePaper'
import { Type, MoveVertical, Frame, MousePointerClick } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

const icons = [Type, MoveVertical, Frame, MousePointerClick]

/** 编辑器深潜：白纸 + 排版控制 */
export function EditorSection() {
  const t = useT()
  return (
    <section id="editor" className="relative overflow-hidden border-b hairline">
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 40% at 80% 50%, var(--glow), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-20">
          <div>
            <SectionHeading
              index={t.editor.index}
              eyebrow={t.editor.eyebrow}
              title={<>{t.editor.title1}<br />{t.editor.title2}</>}
              description={t.editor.description}
            />
            <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4">
              {t.editor.controls.map((c, i) => {
                const Icon = icons[i]
                return (
                  <Reveal
                    key={c.label}
                    delay={0.1 + i * 0.06}
                    className="group rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_3px_rgb(0_0_0/0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_rgb(0_0_0/0.08)] dark:border-white/[0.07] dark:bg-[#131315] dark:shadow-none dark:hover:bg-[#17171a]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] dark:bg-white/[0.06]">
                      <Icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />
                    </span>
                    <div className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">{c.label}</div>
                    <div className="mt-1 font-mono text-[13px] text-zinc-800 dark:text-zinc-100">{c.value}</div>
                  </Reveal>
                )
              })}
            </div>
          </div>

          <Reveal delay={0.15} className="relative mx-auto w-full max-w-[400px]">
            {/* 底层另一页纸，制造层叠感 */}
            <div className="paper absolute inset-x-3 -top-3 aspect-[210/285] rotate-2 opacity-25" aria-hidden />
            <div className="relative text-[13px]">
              <ResumePaper compact />
            </div>
            {/* 标注线 */}
            <div className="glass absolute -right-5 top-[3%] hidden rounded border border-black/10 px-3 py-1.5 font-mono text-[10px] text-zinc-600 sm:block dark:border-white/12 dark:text-zinc-300">
              {t.editor.annotationMargin}
            </div>
            <div className="glass absolute -left-5 bottom-[8%] hidden rounded border border-black/10 px-3 py-1.5 font-mono text-[10px] text-zinc-600 sm:block dark:border-white/12 dark:text-zinc-300">
              {t.editor.annotationLineHeight}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
