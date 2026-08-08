import { SectionHeading } from '../components/Reveal'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion'

const faqs = [
  {
    q: '可以从已有的简历文件开始吗？',
    a: '可以。除了空白内容和内置模板，LinkCV 支持导入已有的 Markdown、DOCX、PDF 文件，在此基础上继续编辑。',
  },
  {
    q: 'Chrome 插件会抓取哪些数据？',
    a: '插件只读取你当前打开的 BOSS 直聘岗位详情页，并且在你手动点击确认后才会导入 LinkCV。它不会在后台批量抓取，也不会替你投递。',
  },
  {
    q: '「智能一页」是怎么工作的？',
    a: '导出 PDF 时选择智能一页模式，系统会自动调节排版密度，把内容收进一页 A4；需要多页时则使用标准 A4 分页模式。',
  },
  {
    q: '误删或改错了内容怎么办？',
    a: 'LinkCV 会自动保存当前修改，你也可以主动保存命名版本。历史版本随时可查看，一键即可恢复旧内容。',
  },
  {
    q: 'JD 中心能管理多少岗位？',
    a: '没有硬性上限。岗位可以搜索、打标签、标记投递状态，不合适的可以归档收纳，记录随时可查。',
  },
]

export function FAQ() {
  return (
    <section id="faq" className="border-b hairline">
      <div className="mx-auto max-w-3xl px-6 py-28 sm:py-36">
        <SectionHeading index="08" eyebrow="常见问题" title="你可能想问。" align="center" />
        <div className="mt-14">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-black/[0.08] dark:border-white/[0.08]">
                <AccordionTrigger className="py-6 text-left text-[15px] font-medium text-zinc-900 hover:text-black hover:no-underline dark:text-zinc-100 dark:hover:text-white [&[data-state=open]]:text-black dark:[&[data-state=open]]:text-white">
                  <span className="flex items-baseline gap-4">
                    <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, '0')}</span>
                    {f.q}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-6 pl-9 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
