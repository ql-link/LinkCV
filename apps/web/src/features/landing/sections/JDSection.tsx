import { Reveal, SectionHeading } from '../components/Reveal'
import { JDCenter, ExtensionPopup } from '../components/mockups/JDCenter'
import { Search, Archive, MousePointerClick } from 'lucide-react'

const points = [
  { icon: MousePointerClick, title: '确认后导入', desc: '插件只读取你当前打开的 BOSS 直聘岗位页，点击确认才写入，不后台批量抓取。' },
  { icon: Search, title: '可搜索、可整理', desc: '按岗位、公司、关键词检索，随手打上状态标签。' },
  { icon: Archive, title: '归档不删除', desc: '不合适的岗位归档收纳，保持列表清爽，记录仍然可查。' },
]

/** JD 中心 + Chrome 插件 */
export function JDSection() {
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
              index="05"
              eyebrow="JD 中心 + Chrome 插件"
              title={<>岗位信息，<br />和简历放在一起。</>}
              description="看到合适的岗位，用 Chrome 插件把当前打开的 BOSS 直聘岗位详情采进 JD 中心。写简历时对照要求，投递后标记状态，全程不离开工作区。"
            />
            <div className="mt-12 space-y-2">
              {points.map((p, i) => (
                <Reveal key={p.title} delay={0.1 + i * 0.08}>
                  <div className="flex gap-4 rounded-lg border border-transparent p-4 transition-colors hover:border-black/[0.08] hover:bg-black/[0.02] dark:hover:border-white/[0.08] dark:hover:bg-white/[0.02]">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-black/10 bg-black/[0.03] dark:border-white/12 dark:bg-white/[0.03]">
                      <p.icon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" strokeWidth={1.5} />
                    </span>
                    <div>
                      <div className="text-sm font-medium text-zinc-900 dark:text-white">{p.title}</div>
                      <div className="mt-1 text-[13px] leading-relaxed text-zinc-500">{p.desc}</div>
                    </div>
                  </div>
                </Reveal>
              ))}
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
