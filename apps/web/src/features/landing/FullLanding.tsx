import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUp, ChevronDown, Languages, Menu, X } from "lucide-react";
import { setLocale, useLocale } from "@/i18n";
import wordmark from "@/assets/linkresume-wordmark.png";
import brandMark from "@/assets/linkresume-mark-132.png";
import groupQr from "@/assets/linkresume-qq-group-qr.svg";
import { HeroShowcase, type HeroShowcaseHandle } from "./HeroShowcase";
import { HeroBackdrop } from "./HeroBackdrop";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/noto-serif-sc/400.css";
import { FeatureShowcase } from "./FeatureShowcase";
import { DetailCards } from "./DetailCards";
import { useScrollReveal } from "./motion";
import { lt } from "./landingCopy";
import "./full-landing.css";

const projectUrl = "/resumes";

type NavGroup = { title: string; links: { text: string; target: string }[] };
const menus: Record<string, NavGroup[]> = {
  产品: [
    { title: "工作区", links: [{ text: "一体化工作台", target: "#feature-job" }, { text: "AI 助手", target: "#feature-agent" }, { text: "岗位看板", target: "#feature-board" }, { text: "模拟面试", target: "#feature-interview" }] },
    { title: "更多细节", links: [{ text: "多模型选择", target: "#feature-models" }, { text: "导入已有简历", target: "#feature-import" }, { text: "模板与中文排版", target: "#feature-templates" }] },
    { title: "求职准备", links: [{ text: "按 JD 改简历", target: "#feature-match" }, { text: "面试评估报告", target: "#feature-interview" }] },
  ],
  使用场景: [
    { title: "写好经历", links: [{ text: "整理项目资料", target: "#feature-references" }, { text: "让 AI 完成修改", target: "#feature-agent" }, { text: "针对岗位准备简历", target: "#feature-match" }] },
    { title: "准备机会", links: [{ text: "管理求职进程", target: "#feature-board" }, { text: "练习项目追问", target: "#feature-interview" }] },
    { title: "顺手准备", links: [{ text: "资料随手引用", target: "#feature-references" }, { text: "岗位快速收集", target: "#feature-capture" }, { text: "求职偏好", target: "#feature-preferences" }] },
  ],
  了解更多: [
    { title: "探索", links: [{ text: "产品能力", target: "#use-cases" }, { text: "更多细节", target: "#features" }, { text: "常见问题", target: "#faq" }] },
    { title: "DrawOffer", links: [{ text: "从哪里开始", target: "#purpose" }] },
  ],
};
const faqs = [
  { q: "DrawOffer 免费吗？", a: "简历编辑、导出和岗位看板都可以免费使用；AI 相关能力按用量提供免费额度，后续会推出更多方案。" },
  { q: "我的简历数据安全吗？", a: "简历、岗位和资料保存在你自己的账号里，只在你发起编辑、分析或模拟面试时使用；不需要的内容可以随时删除。" },
  { q: "支持导入哪些格式的简历？", a: "支持 PDF、Word（DOCX）和 Markdown，导入后会整理成可以直接编辑的简历。" },
  { q: "AI 使用的是哪些模型？", a: "对话中可以切换 DeepSeek 等模型，实际可用的模型以工作区里的列表为准。" },
  { q: "可以导出成什么格式？", a: "简历导出为 PDF，可以按标准 A4 分页，也可以用智能一页把内容收进一张连续页面。" },
];
const footerFeatures = [["一体化工作台", "#feature-job"], ["AI 助手", "#feature-agent"], ["岗位与简历联动", "#feature-match"], ["求职进程管理", "#feature-board"], ["面试准备", "#feature-interview"]];

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  return reduced;
}

function PrimaryLink() {
  return <a className="fl-button" href={projectUrl}>{lt("免费开始")}<ArrowRight size={14} strokeWidth={2} /></a>;
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return <section id="faq" className="fl-faq-section" aria-labelledby="faq-title"><div className="fl-faq fl-container">
    <header data-reveal><p className="fl-eyebrow"><span />{lt("常见问题")}</p><h2 id="faq-title">{lt("加入用户交流群")}</h2><p>{lt("使用问题、功能建议，都可以在群里反馈。")}</p></header>
    <figure className="fl-faq-qr" data-reveal><div className="fl-faq-qr-code"><img src={groupQr} alt={lt("DrawOffer 交流群 QQ 二维码")} width="168" height="168" /><span><img src={brandMark} alt="" width="33" height="33" /></span></div><figcaption>{lt("QQ 扫码加入")}</figcaption></figure>
    <div className="fl-faq-list">{faqs.map((item, index) => <div className="fl-faq-item" data-reveal style={{ "--reveal-delay": `${index * 0.06}s` } as CSSProperties} key={item.q}>
      <h3><button type="button" id={`faq-question-${index}`} aria-expanded={open === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpen(open === index ? null : index)}>{lt(item.q)}<ChevronDown size={20} strokeWidth={1.6} /></button></h3>
      <div className="fl-faq-answer" id={`faq-answer-${index}`} role="region" aria-labelledby={`faq-question-${index}`} data-open={open === index} inert={open !== index}><div><p>{lt(item.a)}</p></div></div>
    </div>)}</div>
  </div></section>;
}

export function FullLanding() {
  const locale = useLocale();
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const showcase = useRef<HeroShowcaseHandle>(null);
  const motion = useScrollReveal(page);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu && !nav.current?.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setMobileMenu(false); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [menu]);
  useEffect(() => { if (!mobileMenu) return; const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, [mobileMenu]);
  useEffect(() => {
    // Resolve deep links after the client-rendered sections have mounted.
    let frame = 0;
    const resolveHash = () => {
      frame = requestAnimationFrame(() => {
        const target = document.getElementById(window.location.hash.slice(1));
        target?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    };
    if (document.readyState === "complete") resolveHash();
    else window.addEventListener("load", resolveHash, { once: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("load", resolveHash); };
  }, []);
  function menuLink(link: NavGroup["links"][number]) { return <a key={link.text} href={link.target} onClick={() => { setMenu(null); setMobileMenu(false); }}>{lt(link.text)}</a>; }
  const languageButton = <button type="button" className="fl-lang" aria-label={lt("切换语言")} onClick={() => setLocale(locale === "en-US" ? "zh-CN" : "en-US")}><Languages size={14} strokeWidth={1.8} />{locale === "en-US" ? "中文" : "EN"}</button>;
  return <div ref={page} className={`marketing-landing fl-page${reduced ? " fl-reduced" : ""}${motion ? " fl-motion" : ""}`}>
    <a className="fl-skip" href="#content">{lt("跳到主要内容")}</a>
    <nav ref={nav} className="fl-nav" aria-label={lt("主导航")}>
      <div className="fl-nav-row fl-container"><a className="fl-logo" href="#top" aria-label={lt("DrawOffer 首页")}><img src={wordmark} alt="DrawOffer" width="136" height="28" /></a>
        <div className="fl-desktop-links">{Object.keys(menus).map(label => <button key={label} type="button" aria-expanded={menu === label} aria-controls="desktop-menu" onClick={() => setMenu(menu === label ? null : label)}>{lt(label)}<ChevronDown size={11} /></button>)}<a href="#features">{lt("更多细节")}</a><a href="#use-cases">{lt("功能演示")}</a></div>
        <div className="fl-nav-actions">{languageButton}<a className="fl-pill-primary" href={projectUrl}>{lt("免费开始")}</a></div>
        <button className="fl-mobile-toggle" type="button" aria-label={lt(mobileMenu ? "关闭导航菜单" : "打开导航菜单")} aria-expanded={mobileMenu} onClick={() => { setMobileMenu(value => !value); setMenu(null); }}>{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      {menu && !mobileMenu && <div id="desktop-menu" className="fl-mega-menu"><div className="fl-container fl-menu-columns">{menus[menu].map(group => <div key={group.title}><p>{lt(group.title)}</p>{group.links.map(menuLink)}</div>)}</div></div>}
      {mobileMenu && <div className="fl-mobile-menu"><div>{Object.keys(menus).map(label => <div key={label} className="fl-mobile-menu-group"><button type="button" aria-expanded={menu === label} onClick={() => setMenu(menu === label ? null : label)}>{lt(label)}<ChevronDown size={13} /></button>{menu === label && <div className="fl-mobile-menu-links">{menus[label].map(group => <div key={group.title}><p>{lt(group.title)}</p>{group.links.map(menuLink)}</div>)}</div>}</div>)}<a href="#features" onClick={() => setMobileMenu(false)}>{lt("更多细节")}</a><a href="#use-cases" onClick={() => setMobileMenu(false)}>{lt("功能演示")}</a></div><div className="fl-mobile-menu-actions"><a className="fl-pill-primary" href={projectUrl}>{lt("免费开始")}</a>{languageButton}</div></div>}
    </nav>
    <main id="content" inert={mobileMenu} className={menu && !mobileMenu ? "fl-menu-blur" : ""}>
      <section id="top" className="fl-hero">
        <HeroBackdrop reduced={reduced} />
        <div className="fl-hero-content fl-container">
          <div className="fl-hero-copy">
            <img className="fl-hero-wordmark" src={wordmark} alt="DrawOffer" width="1701" height="349" />
            <h1>{lt("懂你经历的求职搭档")}</h1>
            <p>{lt("导入简历和项目资料，AI 帮你改简历、对照 JD、模拟面试。")}<br />{lt("每处修改都由你确认后再写入简历。")}</p>
            <div className="fl-hero-cta"><div className="fl-cta-row"><PrimaryLink /><a className="fl-button-secondary" href="#demo" onClick={event => { event.preventDefault(); showcase.current?.watch(); }}>{lt("看 1 分钟短片")}</a></div><small>{lt("免费使用 · 支持导入 PDF / Word / Markdown 简历")}</small></div>
          </div>
          <HeroShowcase ref={showcase} />
        </div>
      </section>
      <FeatureShowcase />
      <DetailCards />
      <Faq />
      <section id="purpose" className="fl-purpose-section"><div className="fl-purpose fl-container" data-reveal><p className="fl-eyebrow"><span />DrawOffer</p><h2>{lt("简历、岗位和面试，从这里开始准备")}</h2><div className="fl-cta-row"><PrimaryLink /></div></div></section>
    </main>
    <div className="fl-footer-section" inert={mobileMenu}><footer className="fl-footer fl-container" aria-label={lt("页脚导航")}><div className="fl-footer-brand"><a href="#top"><img src={wordmark} alt="DrawOffer" width="136" height="28" /></a><p>{lt("懂你经历的求职搭档")}</p><small>© 2026 DrawOffer · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">皖ICP备2026017322号</a></small></div><div><h2>{lt("产品功能")}</h2>{footerFeatures.map(([text, target]) => <a key={text} href={target}>{lt(text)}</a>)}</div><div><h2>{lt("了解 DrawOffer")}</h2><a href="#features">{lt("更多细节")}</a><a href="#faq">{lt("常见问题")}</a><a href="#top">{lt("返回顶部")}<ArrowUp size={11} /></a></div></footer></div>
  </div>;
}
