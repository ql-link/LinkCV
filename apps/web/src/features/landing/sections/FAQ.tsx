import { SectionHeading } from '../components/Reveal'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion'
import { useT } from '../locales/LanguageContext'

export function FAQ() {
  const t = useT()
  return (
    <section id="faq" className="border-b hairline">
      <div className="mx-auto max-w-3xl px-6 py-28 sm:py-36">
        <SectionHeading index={t.faq.index} eyebrow={t.faq.eyebrow} title={t.faq.title} align="center" />
        <div className="mt-14">
          <Accordion type="single" collapsible className="w-full">
            {t.faq.items.map((f, i) => (
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
