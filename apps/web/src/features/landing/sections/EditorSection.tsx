import { Reveal, SectionHeading } from '../components/Reveal'
import { ResumePaper } from '../components/mockups/ResumePaper'
import { Type, MoveVertical, Frame, MousePointerClick } from 'lucide-react'

const controls = [
  { icon: Type, label: '字体 / 字号', value: '思源黑体 · 10.5pt' },
  { icon: MoveVertical, label: '行距', value: '1.45' },
  { icon: Frame, label: '页边距', value: '上下 18mm · 左右 20mm' },
  { icon: MousePointerClick, label: '编辑方式', value: '点哪里，改哪里' },
]

/** 编辑器深潜：白纸 + 排版控制 */
export function EditorSection() {
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
              index="02"
              eyebrow="编辑器"
              title={<>在真正的 A4 纸面上，<br />写你的简历。</>}
              description="不是表单，不是填坑模板。LinkCV 让你直接在接近最终打印效果的纸面上编辑文字、图片与左右分栏，字体、字号、行距、页边距全部可调。"
            />
            <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4">
              {controls.map((c, i) => (
                <Reveal
                  key={c.label}
                  delay={0.1 + i * 0.06}
                  className="group rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_3px_rgb(0_0_0/0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-8px_rgb(0_0_0/0.08)] dark:border-white/[0.07] dark:bg-[#131315] dark:shadow-none dark:hover:bg-[#17171a]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] dark:bg-white/[0.06]">
                    <c.icon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" strokeWidth={1.5} />
                  </span>
                  <div className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">{c.label}</div>
                  <div className="mt-1 font-mono text-[13px] text-zinc-800 dark:text-zinc-100">{c.value}</div>
                </Reveal>
              ))}
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
              页边距 20mm
            </div>
            <div className="glass absolute -left-5 bottom-[8%] hidden rounded border border-black/10 px-3 py-1.5 font-mono text-[10px] text-zinc-600 sm:block dark:border-white/12 dark:text-zinc-300">
              行距 1.45
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
