import { PointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { Code2, Eye, Palette, Sparkles } from "lucide-react";
import { Brand, Button } from "../../components/ds";

type LandingPageProps = {
  onStart: () => void;
  onLogin: () => void;
};

const steps = [
  { number: "01", title: "新建简历", description: "从空白或默认内容开始，无需选模板。" },
  { number: "02", title: "用 Markdown 编写", description: "左边写内容，右边实时看到排版结果。" },
  { number: "03", title: "导出 PDF", description: "一份规整的 A4 简历，随时投递。" },
];

const features = [
  { icon: Eye, title: "实时预览", description: "编辑的同时看到最终排版效果，所见即所得。" },
  { icon: Code2, title: "Markdown 语法", description: "支持 ::: left / right 对齐行，专为简历场景设计。" },
  { icon: Sparkles, title: "智能一页", description: "自动压缩排版，让内容刚好落在一页。" },
  { icon: Palette, title: "多种输出字体", description: "简历宋体、霞鹜文楷、系统黑体等，一键切换。" },
];

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.2 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`landing-reveal${visible ? " is-visible" : ""} ${className}`.trim()}
      style={{ "--reveal-delay": `${delay}s` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

function ResumeVisual() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 10;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * -10;
    setTilt({ x, y });
  };

  return (
    <div
      className="landing-resume-visual"
      aria-label="Markdown 编辑内容与 A4 简历实时预览示意"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ "--tilt-x": tilt.x, "--tilt-y": tilt.y } as React.CSSProperties}
    >
      <div className="landing-markdown-card" aria-hidden="true">
        <span># 张三</span>
        <strong>## 实习经历</strong>
        <span>::: left</span>
        <strong>后端实习生</strong>
        <span>:::</span>
      </div>
      <div className="landing-paper-card" aria-hidden="true">
        <strong className="paper-name">张三</strong>
        <span className="paper-contact">后端开发工程师 · 138****0000</span>
        <strong className="paper-section">实习经历</strong>
        <div className="paper-row"><b>示例公司 · 后端实习生</b><span>2025.6–2025.9</span></div>
        <i style={{ width: "92%" }} /><i /><i style={{ width: "78%" }} />
        <strong className="paper-section paper-education">教育背景</strong>
        <div className="paper-row"><b>某某大学 · 计算机科学</b><span>2022–2026</span></div>
      </div>
    </div>
  );
}

export function LandingPage({ onStart, onLogin }: LandingPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [scrollAmount, setScrollAmount] = useState(0);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const handleScroll = () => setScrollAmount(Math.min(1, page.scrollTop / 80));
    page.addEventListener("scroll", handleScroll, { passive: true });
    return () => page.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => pageRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div ref={pageRef} className="landing-page">
      <header
        className="landing-nav"
        style={{
          "--nav-alpha": 0.5 + scrollAmount * 0.4,
          "--nav-blur": `${8 + scrollAmount * 14}px`,
          "--nav-border-alpha": scrollAmount,
        } as React.CSSProperties}
      >
        <Brand className="landing-brand" />
        <nav className="landing-nav-links" aria-label="落地页导航">
          <button type="button" onClick={() => scrollTo("features")}>功能</button>
          <button type="button" onClick={() => scrollTo("steps")}>使用步骤</button>
          <button type="button" onClick={() => scrollTo("help")}>帮助</button>
        </nav>
        <div className="landing-auth-links">
          <button type="button" onClick={onLogin}>登录</button>
          <button className="is-strong" type="button" onClick={onStart}>开始使用</button>
        </div>
      </header>

      <main>
        <section className="landing-hero">
          <span className="landing-kicker">LinkCV</span>
          <h1>写 Markdown，<br />出一份干净的简历</h1>
          <p>不需要排版软件，也不需要模板市场。你专注写内容，LinkCV 负责把它变成一页规整的 A4 简历。</p>
          <div className="landing-hero-actions">
            <Button className="landing-primary-cta" onClick={onStart}>创建你的第一份简历</Button>
            <button className="landing-login-link" type="button" onClick={onLogin}>登录 &gt;</button>
          </div>
          <ResumeVisual />
        </section>

        <section id="steps" className="landing-section landing-steps">
          <Reveal className="landing-section-heading">
            <span>使用步骤</span>
            <h2>三步，完成一份简历</h2>
          </Reveal>
          <div className="landing-step-grid">
            {steps.map((step, index) => (
              <Reveal key={step.number} delay={index * 0.1}>
                <article className="landing-step">
                  <span>{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        <section id="features" className="landing-section landing-features">
          <Reveal className="landing-section-heading">
            <span>功能</span>
            <h2>专为简历场景打造</h2>
          </Reveal>
          <div className="landing-feature-grid">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <Reveal key={feature.title} delay={index * 0.08}>
                  <article className="landing-feature-card">
                    <Icon size={24} />
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>
      </main>

      <footer id="help" className="landing-footer">
        <Brand className="landing-brand" />
        <div><span>关于</span><span>隐私</span><span>帮助</span></div>
      </footer>
    </div>
  );
}
