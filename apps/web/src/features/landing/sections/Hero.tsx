import {
  motion,
  type MotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTime,
  useTransform,
} from "motion/react";
import { ArrowDown, ArrowRight } from "lucide-react";
import { useRef, type CSSProperties, type RefObject } from "react";

const ease = [0.21, 0.47, 0.32, 0.98] as const;
const scrollOrbitBoostMs = 14000;

type ResumeProfile = {
  company: string;
  education: string;
  location: string;
  name: string;
  project: string;
  role: string;
  summary: string;
  skills: string[];
};

type ResumeTemplate =
  | "classic"
  | "compact"
  | "editorial"
  | "ledger"
  | "minimal"
  | "sidebar"
  | "split";

type ResumeDesign = {
  accent: string;
  id: number;
  soft: string;
  template: ResumeTemplate;
};

const profiles: ResumeProfile[] = [
  {
    company: "远望科技 · 核心产品组",
    education: "华东理工大学 · 信息管理",
    location: "上海",
    name: "张三",
    project: "求职工作台重构",
    role: "产品经理",
    summary: "把复杂问题拆成清晰、可验证的产品体验。",
    skills: ["产品策略", "用户研究", "数据分析"],
  },
  {
    company: "微光网络 · Web 平台",
    education: "浙江工业大学 · 软件工程",
    location: "杭州",
    name: "李华",
    project: "企业级设计系统",
    role: "前端工程师",
    summary: "关注交互细节，也关注每一次真实交付。",
    skills: ["React", "TypeScript", "设计系统"],
  },
  {
    company: "折页工作室 · 品牌团队",
    education: "中央美术学院 · 视觉传达",
    location: "北京",
    name: "王宁",
    project: "消费品牌视觉升级",
    role: "品牌设计师",
    summary: "用统一的视觉语言，让品牌被准确记住。",
    skills: ["品牌视觉", "动效设计", "创意策划"],
  },
  {
    company: "数桥咨询 · 商业分析",
    education: "中山大学 · 统计学",
    location: "深圳",
    name: "陈晨",
    project: "经营指标分析平台",
    role: "数据分析师",
    summary: "从信息噪声里，找到真正值得行动的信号。",
    skills: ["SQL", "可视化", "商业分析"],
  },
  {
    company: "同行产品 · 用户体验部",
    education: "四川大学 · 应用心理学",
    location: "成都",
    name: "赵清",
    project: "新用户旅程研究",
    role: "用户研究员",
    summary: "把真实用户的声音，转化为可执行的产品判断。",
    skills: ["深度访谈", "可用性测试", "洞察分析"],
  },
  {
    company: "白昼创意 · 设计中心",
    education: "广州美术学院 · 数字媒体",
    location: "广州",
    name: "林墨",
    project: "内容创作工具改版",
    role: "视觉设计师",
    summary: "用清晰的层级和节奏，让复杂功能自然易懂。",
    skills: ["视觉系统", "交互设计", "动态设计"],
  },
  {
    company: "新岸商业 · 增长团队",
    education: "南京大学 · 市场营销",
    location: "南京",
    name: "周冉",
    project: "会员增长策略",
    role: "运营策略",
    summary: "从业务目标出发，建立持续、可衡量的增长机制。",
    skills: ["增长策略", "内容运营", "项目管理"],
  },
];

const orbitProfiles = Array.from({ length: 14 }, (_, index) => profiles[index % profiles.length]);
const resumeDesigns: ResumeDesign[] = [
  { accent: "#355f85", id: 1, soft: "#edf4f8", template: "classic" },
  { accent: "#8a4f45", id: 2, soft: "#f8efed", template: "editorial" },
  { accent: "#496a58", id: 3, soft: "#edf4ef", template: "sidebar" },
  { accent: "#876a35", id: 4, soft: "#f7f2e7", template: "ledger" },
  { accent: "#66558a", id: 5, soft: "#f2eff8", template: "split" },
  { accent: "#39757a", id: 6, soft: "#eaf5f5", template: "compact" },
  { accent: "#5e6472", id: 7, soft: "#f0f1f3", template: "minimal" },
  { accent: "#9a5b37", id: 8, soft: "#faefe8", template: "classic" },
  { accent: "#376b63", id: 9, soft: "#eaf4f1", template: "editorial" },
  { accent: "#596f9c", id: 10, soft: "#edf1f8", template: "sidebar" },
  { accent: "#7e526f", id: 11, soft: "#f6edf3", template: "ledger" },
  { accent: "#5c7444", id: 12, soft: "#eff4e9", template: "split" },
  { accent: "#8a623d", id: 13, soft: "#f7f0e8", template: "compact" },
  { accent: "#426b7c", id: 14, soft: "#ebf3f6", template: "minimal" },
];

export function Hero({
  onStart,
  scrollContainerRef,
}: {
  onStart: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const orbitTime = useTime();
  const { scrollYProgress } = useScroll({
    container: scrollContainerRef,
    target: sectionRef,
    offset: ["start start", "end end"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 24,
    mass: 0.35,
  });

  const orbitOpacity = useTransform(progress, [0, 0.72, 0.96, 1], [1, 1, 0.26, 0.08]);
  const copyY = useTransform(progress, [0, 0.7, 1], [0, -12, -72]);
  const copyOpacity = useTransform(progress, [0, 0.7, 0.96, 1], [1, 1, 0.34, 0.08]);
  const cueOpacity = useTransform(progress, [0, 0.18], [1, 0]);

  return (
    <section ref={sectionRef} id="top" className="landing-orbit-hero">
      <div className="landing-orbit-stage">
        <div className="landing-orbit-halo" aria-hidden />

        <motion.div
          className="landing-orbit-scroll-layer"
          style={reduceMotion ? undefined : { opacity: orbitOpacity }}
          aria-hidden
        >
          <div className="landing-orbit-stream">
            {orbitProfiles.map((profile, index) => (
              <OrbitResume
                design={resumeDesigns[index]}
                index={index}
                key={`${profile.name}-${index}`}
                profile={profile}
                reduceMotion={Boolean(reduceMotion)}
                scrollProgress={progress}
                time={orbitTime}
                total={orbitProfiles.length}
              />
            ))}
          </div>
        </motion.div>

        <motion.div
          className="landing-orbit-copy"
          style={reduceMotion ? undefined : { y: copyY, opacity: copyOpacity }}
        >
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease }}
            className="landing-orbit-kicker"
          >
            <span>LINKCV</span>
            <i aria-hidden />
            <span>求职工作台</span>
          </motion.div>
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.75, delay: 0.08, ease }}
          >
            把经历，写成
            <span>下一份机会。</span>
          </motion.h1>
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, delay: 0.16, ease }}
          >
            从一份简历开始，管理版本、岗位与每一次成长。
          </motion.p>
          <motion.button
            type="button"
            onClick={onStart}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24, ease }}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            className="landing-orbit-cta"
          >
            开始创建简历
            <ArrowRight aria-hidden />
          </motion.button>
        </motion.div>

        <motion.a
          href="#workspace-intro"
          className="landing-orbit-scroll-cue"
          style={reduceMotion ? undefined : { opacity: cueOpacity }}
        >
          <span>向下探索</span>
          <ArrowDown aria-hidden />
        </motion.a>
      </div>
    </section>
  );
}

function OrbitResume({
  design,
  index,
  profile,
  reduceMotion,
  scrollProgress,
  time,
  total,
}: {
  design: ResumeDesign;
  index: number;
  profile: ResumeProfile;
  reduceMotion: boolean;
  scrollProgress: MotionValue<number>;
  time: MotionValue<number>;
  total: number;
}) {
  const phase = (value: number) => {
    const elapsed = reduceMotion ? 0 : value + scrollProgress.get() * scrollOrbitBoostMs;
    return ((elapsed / 58000 + index / total) % 1) * Math.PI * 2;
  };
  const depth = (value: number) => (Math.sin(phase(value)) + 1) / 2;
  const transform = useTransform(time, (value) => {
    const angle = phase(value);
    const foreground = depth(value);
    const x = Math.cos(angle) * 58;
    const y = Math.sin(angle) * 42;
    const scale = 0.58 + foreground * 0.92;
    return `translate3d(calc(-50% + ${x.toFixed(3)}vw), calc(-50% + ${y.toFixed(3)}vh), 0) scale(${scale.toFixed(4)})`;
  });
  const opacity = useTransform(time, (value) => 0.28 + depth(value) * 0.72);
  const filter = useTransform(time, (value) => `blur(${((1 - depth(value)) * 2.1).toFixed(2)}px)`);
  const zIndex = useTransform(time, (value) => Math.round(10 + depth(value) * 80));

  return (
    <motion.div
      className="landing-orbit-card"
      style={{ filter, opacity, transform, zIndex }}
    >
      <ResumeCard design={design} profile={profile} />
    </motion.div>
  );
}

function ResumeCard({ design, profile }: { design: ResumeDesign; profile: ResumeProfile }) {
  const style = {
    "--resume-accent": design.accent,
    "--resume-accent-soft": design.soft,
  } as CSSProperties;

  return (
    <article
      className="landing-resume-card"
      data-resume-design={design.id}
      data-resume-template={design.template}
      data-testid="orbit-resume"
      style={style}
    >
      <header>
        <div>
          <strong>{profile.name}</strong>
          <small>{profile.role}</small>
        </div>
        <address>{profile.location} · 求职中</address>
      </header>
      <div className="landing-resume-contact">
        <span>linkcv.example</span>
        <span>作品集 / 项目经历</span>
      </div>
      <p className="landing-resume-summary">{profile.summary}</p>
      <section>
        <div className="landing-resume-section-title">
          <span>工作经历</span>
          <i />
        </div>
        <div className="landing-resume-row">
          <strong>{profile.company}</strong>
          <time>2022.06 — 至今</time>
        </div>
        <small>{profile.role}</small>
        <p>负责核心项目规划与落地，持续推动关键体验与业务指标改进。</p>
      </section>
      <section>
        <div className="landing-resume-section-title">
          <span>项目经历</span>
          <i />
        </div>
        <div className="landing-resume-row">
          <strong>{profile.project}</strong>
          <time>2024</time>
        </div>
        <p>从需求梳理到最终交付，建立可复用的方法并沉淀完整成果。</p>
      </section>
      <footer>
        <div>
          <strong>教育经历</strong>
          <span>{profile.education}</span>
        </div>
        <div>
          <strong>专业能力</strong>
          <span>{profile.skills.join(" · ")}</span>
        </div>
      </footer>
    </article>
  );
}
