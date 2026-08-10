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
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { useT } from "../locales/LanguageContext";

const ease = [0.21, 0.47, 0.32, 0.98] as const;
const scrollOrbitBoostMs = 14000;

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
  const t = useT();
  const taglines = t.hero.taglines;
  const profiles = t.hero.profiles;
  const orbitProfiles = Array.from({ length: 14 }, (_, index) => profiles[index % profiles.length]);

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

  const orbitOpacity = useTransform(progress, [0, 0.72, 0.96, 1], [1, 1, 0.26, 0]);
  const copyY = useTransform(progress, [0, 0.7, 1], [0, -12, -72]);
  const copyOpacity = useTransform(progress, [0, 0.7, 0.96, 1], [1, 1, 0.34, 0.08]);
  const cueOpacity = useTransform(progress, [0, 0.18], [1, 0]);

  const [taglineIndex, setTaglineIndex] = useState(0);
  const [typedCount, setTypedCount] = useState(reduceMotion ? taglines[0].length : 0);

  useEffect(() => {
    if (reduceMotion) {
      setTypedCount(taglines[0].length);
      return;
    }

    let currentTagline = 0;
    let index = 0;
    let phase: "typing" | "holding" | "erasing" = "typing";
    let cancelled = false;
    let timer: number | undefined;

    setTaglineIndex(0);
    setTypedCount(0);

    const typeMs = 110;
    const eraseMs = 38;
    const holdMs = 2400;
    const startDelay = 500;

    const tick = () => {
      if (cancelled) return;
      const text = taglines[currentTagline];

      if (phase === "typing") {
        index += 1;
        setTypedCount(index);
        if (index >= text.length) {
          phase = "holding";
          timer = window.setTimeout(tick, holdMs);
        } else {
          timer = window.setTimeout(tick, typeMs);
        }
        return;
      }

      if (phase === "holding") {
        phase = "erasing";
        timer = window.setTimeout(tick, eraseMs);
        return;
      }

      index -= 1;
      setTypedCount(index);
      if (index <= 0) {
        currentTagline = (currentTagline + 1) % taglines.length;
        setTaglineIndex(currentTagline);
        phase = "typing";
        timer = window.setTimeout(tick, typeMs);
      } else {
        timer = window.setTimeout(tick, eraseMs);
      }
    };

    timer = window.setTimeout(tick, startDelay);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reduceMotion, taglines]);

  const activeTagline = taglines[taglineIndex];

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
            className="landing-orbit-brand"
          >
            <span className="landing-orbit-brand-mark" aria-hidden>
              L
            </span>
            <span className="landing-orbit-brand-name">{t.hero.brand}</span>
          </motion.div>
          <motion.h1
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="landing-orbit-tagline"
          >
            <span className="sr-only">{activeTagline}</span>
            <span aria-hidden className="landing-orbit-tagline-visible">
              {activeTagline.slice(0, typedCount)}
              <span className="landing-orbit-caret" />
            </span>
          </motion.h1>
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.72, delay: 0.16, ease }}
          >
            {t.hero.subtitle}
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
            {t.hero.cta}
            <ArrowRight aria-hidden />
          </motion.button>
        </motion.div>

        <motion.a
          href="#workspace-intro"
          className="landing-orbit-scroll-cue"
          style={reduceMotion ? undefined : { opacity: cueOpacity }}
        >
          <span>{t.hero.scrollCue}</span>
          <ArrowDown aria-hidden />
        </motion.a>
      </div>
    </section>
  );
}

type ProfileData = {
  company: string;
  company2: string;
  education: string;
  location: string;
  name: string;
  project: string;
  projectDesc: string;
  projectPeriod: string;
  role: string;
  summary: string;
  skills: string[];
  workDesc: string;
  workDesc2: string;
  workPeriod: string;
  workPeriod2: string;
};

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
  profile: ProfileData;
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

function ResumeCard({ design, profile }: { design: ResumeDesign; profile: ProfileData }) {
  const t = useT();
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
        <address>{profile.location} · {t.hero.cardStatus}</address>
      </header>
      <div className="landing-resume-contact">
        <span>linkcv.example</span>
        <span>{t.hero.cardPortfolio}</span>
      </div>
      <p className="landing-resume-summary">{profile.summary}</p>
      <section>
        <div className="landing-resume-section-title">
          <span>{t.hero.cardWork}</span>
          <i />
        </div>
        <div className="landing-resume-row">
          <strong>{profile.company}</strong>
          <time>{profile.workPeriod}</time>
        </div>
        <small>{profile.role}</small>
        <p>{profile.workDesc}</p>
        <div className="landing-resume-row landing-resume-row--next">
          <strong>{profile.company2}</strong>
          <time>{profile.workPeriod2}</time>
        </div>
        <p>{profile.workDesc2}</p>
      </section>
      <section>
        <div className="landing-resume-section-title">
          <span>{t.hero.cardProject}</span>
          <i />
        </div>
        <div className="landing-resume-row">
          <strong>{profile.project}</strong>
          <time>{profile.projectPeriod}</time>
        </div>
        <p>{profile.projectDesc}</p>
      </section>
      <footer>
        <div>
          <strong>{t.hero.cardEducation}</strong>
          <span>{profile.education}</span>
        </div>
        <div>
          <strong>{t.hero.cardSkills}</strong>
          <span>{profile.skills.join(" · ")}</span>
        </div>
      </footer>
    </article>
  );
}
