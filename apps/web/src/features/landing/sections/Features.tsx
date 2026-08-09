import { Reveal, SectionHeading } from '../components/Reveal'
import { ChromeIcon } from '../components/ChromeIcon'
import { FileText, History, FileDown, Briefcase } from 'lucide-react'

const features = [
  {
    icon: FileText,
    num: '01',
    title: 'A4 纸面编辑',
    desc: '直接在接近最终效果的 A4 页面上编辑文字、图片与左右布局，所见即所得。',
  },
  {
    icon: History,
    num: '02',
    title: '版本管理',
    desc: '自动保存当前修改，主动保存历史版本，随时可以恢复到任意旧内容。',
  },
  {
    icon: FileDown,
    num: '03',
    title: 'PDF 导出',
    desc: '标准 A4 分页，或「智能一页」模式，导出适合投递的高质量 PDF。',
  },
  {
    icon: Briefcase,
    num: '04',
    title: 'JD 中心',
    desc: '记录、搜索、归档和整理岗位信息，简历与 JD 在同一个工作区对照。',
  },
  {
    icon: ChromeIcon,
    num: '05',
    title: 'Chrome 插件采集',
    desc: '读取当前打开的 BOSS 直聘岗位详情，经你确认后一键导入 LinkCV。',
  },
]

const cardClass =
  'group relative rounded-2xl border border-black/[0.06] bg-white p-7 shadow-[0_1px_3px_rgb(0_0_0/0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.08)] dark:border-white/[0.07] dark:bg-[#131315] dark:shadow-none dark:hover:bg-[#17171a] dark:hover:shadow-none'

export function Features() {
  return (
    <section id="features" className="border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <SectionHeading
          index="01"
          eyebrow="功能总览"
          title={<>从创建到投递，<br />每一步都在掌控之中。</>}
          description="从空白内容、内置模板，或已有的 Markdown、DOCX、PDF 文件开始；在一个清晰可控的工作区内完成编辑、版本与岗位管理。"
        />

        <div className="mt-16 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {features.map((f, i) => (
            <Reveal key={f.num} delay={i * 0.08} className={cardClass}>
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] dark:bg-white/[0.06] dark:group-hover:bg-white/[0.1]">
                  <f.icon className="h-[18px] w-[18px] text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-white" strokeWidth={1.5} />
                </span>
                <span className="font-mono text-[11px] text-zinc-300 dark:text-zinc-600">{f.num}</span>
              </div>
              <h3 className="mt-8 text-lg font-medium text-zinc-900 dark:text-white">{f.title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-zinc-500">{f.desc}</p>
            </Reveal>
          ))}
          {/* 第六格：占位宣言 */}
          <Reveal
            delay={0.4}
            className="relative flex items-center overflow-hidden rounded-2xl border border-dashed border-black/[0.1] p-7 dark:border-white/[0.12]"
          >
            <p className="font-mono text-[11px] leading-loose tracking-[0.06em] text-zinc-400 dark:text-zinc-600">
              CONTENT FIRST.
              <br />
              LAYOUT UNDER CONTROL.
              <br />
              EVERY CHANGE RECOVERABLE.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
