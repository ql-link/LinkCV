import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUp, ChevronDown, Menu, X } from "lucide-react";
import wordmark from "@/assets/linkresume-wordmark.png";
import { HeroDemo } from "./HeroDemo";
import { HeroBackdrop } from "./HeroBackdrop";
import "@/v3/v3.css";
import "@/features/assistant/assistant.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import { CaseScene, type SceneKey } from "./CaseScenes";
import { DetailFeatures } from "./DetailFeatures";
import "./full-landing.css";

const projectUrl = "https://linkresume.cn/resumes";

type Case = { id: SceneKey; title: string; headline: string; description: string; hint: string };
const cases: Case[] = [
  { id: "workspace", title: "一体化工作台", headline: "从简历到面试，每一步都接得上", description: "把简历、岗位、项目资料与面试记录关联起来，让每一步准备都有依据。", hint: "切换关联资料，看看准备如何串起来" },
  { id: "agent", title: "简历 AI Agent", headline: "让 AI 把建议落实到简历里", description: "带上你的简历与项目资料，分析内容、生成修改提案，确认后应用到简历。", hint: "试试采用修改，查看简历的变化" },
  { id: "job-fit", title: "岗位与简历联动", headline: "为这个岗位，打磨这份简历", description: "结合岗位要求检查经历的表达，让相关能力和贡献更清楚。", hint: "点击岗位要求，查看对应的经历" },
  { id: "progress", title: "求职进程管理", headline: "每个机会，推进到哪都清楚", description: "在岗位看板里整理求职进度，把简历、面试时间与记录放在对应机会旁。", hint: "推进求职阶段，保留这次机会的准备" },
  { id: "practice", title: "面试准备", headline: "把写下的经历，练成讲得清楚的回答", description: "围绕简历和目标岗位练习，从追问与反馈中找到下一次回答的改进点。", hint: "看看面试官怎样追问这段经历" },
];
type NavGroup = { title: string; links: { text: string; target: string }[] };
const menus: Record<string, NavGroup[]> = {
  产品: [
    { title: "工作区", links: [{ text: "一体化工作台", target: "#case-workspace" }, { text: "简历 AI Agent", target: "#case-agent" }, { text: "岗位看板", target: "#case-progress" }, { text: "模拟面试", target: "#case-practice" }] },
    { title: "更多细节", links: [{ text: "多模型选择", target: "#feature-models" }, { text: "导入已有简历", target: "#feature-import" }, { text: "模板与中文排版", target: "#feature-templates" }] },
    { title: "求职准备", links: [{ text: "针对岗位改简历", target: "#case-job-fit" }, { text: "逐题反馈", target: "#case-practice" }] },
  ],
  使用场景: [
    { title: "写好经历", links: [{ text: "整理项目资料", target: "#case-workspace" }, { text: "让 AI 完成修改", target: "#case-agent" }, { text: "针对岗位准备简历", target: "#case-job-fit" }] },
    { title: "准备机会", links: [{ text: "管理求职进程", target: "#case-progress" }, { text: "练习项目追问", target: "#case-practice" }] },
    { title: "顺手准备", links: [{ text: "资料随手引用", target: "#feature-references" }, { text: "岗位快速收集", target: "#feature-capture" }, { text: "求职偏好", target: "#feature-preferences" }] },
  ],
  了解更多: [
    { title: "探索", links: [{ text: "产品能力", target: "#features" }, { text: "功能演示", target: "#use-cases" }, { text: "从哪里开始", target: "#start" }] },
    { title: "LinkResume", links: [{ text: "产品理念", target: "#purpose" }, { text: "功能概览", target: "#use-cases" }] },
  ],
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  return reduced;
}

export function FullLanding() {
  const reduced = useReducedMotion();
  const [menu, setMenu] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [activeCase, setActiveCase] = useState(0);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const markers = useRef<(HTMLDivElement | null)[]>([]);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => { frame = 0; const wide = window.matchMedia("(min-width: 1024px)").matches; setDesktop(wide); const threshold = wide ? 275 : 160; let current = 0; markers.current.forEach((marker,index) => { if (marker && marker.getBoundingClientRect().top <= threshold) current = index; }); setActiveCase(current); };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", scroll, { passive: true }); window.addEventListener("resize", scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); };
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (menu && !nav.current?.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenu(null); setMobileMenu(false); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown",key);
    return () => { document.removeEventListener("pointerdown",close); document.removeEventListener("keydown",key); };
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
  function jump(index: number) { setActiveCase(index); markers.current[index]?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" }); setMenu(null); setMobileMenu(false); }
  function menuLink(link: NavGroup["links"][number]) { return <a key={link.text} href={link.target} onClick={() => { setMenu(null); setMobileMenu(false); }}>{link.text}</a>; }
  return <div className={`marketing-landing fl-page${reduced ? " fl-reduced" : ""}`}>
    <a className="fl-skip" href="#content">跳到主要内容</a>
    <nav ref={nav} className="fl-nav" aria-label="主导航">
      <div className="fl-nav-row fl-container"><a className="fl-logo" href="#top" aria-label="LinkResume 首页"><img src={wordmark} alt="LinkResume" width="136" height="28" /></a>
        <div className="fl-desktop-links">{Object.keys(menus).map(label => <button key={label} type="button" aria-expanded={menu === label} aria-controls="desktop-menu" onClick={() => setMenu(menu === label ? null : label)}>{label}<ChevronDown size={11} /></button>)}<a href="#features">更多细节</a><a href="#use-cases">功能演示</a></div>
        <div className="fl-nav-actions"><a className="fl-pill-dark" href={projectUrl}>开始使用</a></div>
        <button className="fl-mobile-toggle" type="button" aria-label={mobileMenu ? "关闭导航菜单" : "打开导航菜单"} aria-expanded={mobileMenu} onClick={() => { setMobileMenu(value => !value); setMenu(null); }}>{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      {menu && !mobileMenu && <div id="desktop-menu" className="fl-mega-menu"><div className="fl-container fl-menu-columns">{menus[menu].map(group => <div key={group.title}><p>{group.title}</p>{group.links.map(menuLink)}</div>)}</div></div>}
      {mobileMenu && <div className="fl-mobile-menu"><div>{Object.keys(menus).map(label => <div key={label} className="fl-mobile-menu-group"><button type="button" aria-expanded={menu === label} onClick={() => setMenu(menu === label ? null : label)}>{label}<ChevronDown size={13} /></button>{menu === label && <div className="fl-mobile-menu-links">{menus[label].map(group => <div key={group.title}><p>{group.title}</p>{group.links.map(menuLink)}</div>)}</div>}</div>)}<a href="#features" onClick={() => setMobileMenu(false)}>更多细节</a><a href="#use-cases" onClick={() => setMobileMenu(false)}>功能演示</a></div><div className="fl-mobile-menu-actions"><a className="fl-pill-dark" href={projectUrl}>开始使用</a></div></div>}
    </nav>
    <main id="content" inert={mobileMenu} className={menu && !mobileMenu ? "fl-menu-blur" : ""}>
      <section id="top" className="fl-hero">
        <HeroBackdrop reduced={reduced} />
        <div className="fl-hero-content fl-container">
          <div className="fl-hero-copy">
            <img className="fl-hero-wordmark" src={wordmark} alt="LinkResume" width="1701" height="349" />
            <h1><span>写好你的经历，</span><span>走向下一次机会</span></h1>
            <p>简历创作、AI 推敲与面试准备，在同一个工作区里完成。</p>
          </div>
          <HeroDemo />
        </div>
      </section>
      <section id="use-cases" className="fl-cases fl-container" aria-labelledby="case-section-title"><aside className="fl-case-directory"><div><p className="fl-eyebrow"><span />AI 驱动的求职工作台</p><h2 id="case-section-title">一个工作台，<br />串起你的求职准备</h2><nav aria-label="场景目录">{cases.map((item,index) => <button key={item.id} type="button" aria-current={activeCase === index ? "step" : undefined} onClick={() => jump(index)}>{item.title}</button>)}</nav></div></aside>
        <div className="fl-case-cards">{cases.map((item,index) => <div className="fl-case-entry" key={item.id}><div ref={element => { markers.current[index] = element; }} className="fl-case-marker" id={`case-${item.id}`} style={{ "--case-anchor": `${40 + index * 24}px` } as CSSProperties} /><article aria-labelledby={`case-title-${item.id}`} className={`fl-case-card${activeCase === index ? " is-active" : ""}`} style={{ "--case-top": `${120 + index * 24}px`, zIndex: index + 1 } as CSSProperties}><div className="fl-case-content"><div className="fl-case-copy"><div><p className="fl-case-topic">0{index + 1} / {item.title}</p><h3 id={`case-title-${item.id}`} className="fl-case-headline">{item.id === "agent" ? <><span>让 AI 把建议</span><span>落实到简历里</span></> : item.headline.split("，").map((line, lineIndex, lines) => <span key={line}>{line}{lineIndex < lines.length - 1 ? "，" : ""}</span>)}</h3><p className="fl-case-description">{item.description}</p></div><p className="fl-case-hint">{item.hint}<ArrowRight size={13} /></p></div><div className="fl-case-visual" data-scene={item.id} inert={desktop && activeCase !== index}><CaseScene scene={item.id} /></div></div></article></div>)}</div>
      </section>
      <section id="start" className="fl-start fl-container"><p className="fl-eyebrow"><span />为每一步求职做好准备</p><h2>从你的下一份简历开始</h2><div className="fl-cta-row"><a className="fl-button" href={projectUrl}>开始使用</a></div></section>
      <DetailFeatures />
      <section id="purpose" className="fl-purpose fl-container"><p className="fl-eyebrow"><span />LinkResume</p><h2>好好准备，走向下一次机会</h2><a className="fl-button" href={projectUrl}>开始使用</a></section>
    </main>
    <footer className="fl-footer fl-container" aria-label="页脚导航" inert={mobileMenu}><div className="fl-footer-brand"><a href="#top"><img src={wordmark} alt="LinkResume" width="136" height="28" /></a><p>为每一步求职做好准备。</p><small>© 2026 LinkResume · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">皖ICP备2026017322号</a></small></div><div><h2>产品功能</h2>{cases.map(item => <a key={item.id} href={`#case-${item.id}`}>{item.title}</a>)}</div><div><h2>了解 LinkResume</h2><a href="#features">更多细节</a><a href="#purpose">产品理念</a><a href="#top">返回顶部<ArrowUp size={11} /></a></div></footer>
  </div>;
}
