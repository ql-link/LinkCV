import { Reveal, SectionHeading } from '../components/Reveal'

const steps = [
  { num: '01', title: '创建', desc: '从空白、内置模板，或导入 Markdown / DOCX / PDF 开始。' },
  { num: '02', title: '编辑', desc: '在 A4 纸面上写内容、调排版，修改自动保存。' },
  { num: '03', title: '采集', desc: 'Chrome 插件采集 BOSS 直聘岗位，存入 JD 中心。' },
  { num: '04', title: '导出', desc: '按 JD 微调后，导出标准分页或智能一页 PDF。' },
]

/** 工作流：四步横向时间线 */
export function Workflow() {
  return (
    <section className="border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHeading index="06" eyebrow="工作流" title={<>从空白页到投递，四步。</>} align="center" />
        <div className="relative mt-20 grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {/* 连接线 */}
          <div className="absolute top-[7px] right-[12%] left-[12%] hidden h-px bg-black/10 lg:block dark:bg-white/10" aria-hidden />
          {steps.map((s, i) => (
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
