import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useLocale } from "@/i18n";
import wordmark from "@/assets/linkresume-wordmark.png";
import { HeroDemo, useDemoShots } from "./HeroDemo";
import { lt } from "./landingCopy";

/**
 * Hero 展示区：先播放 `apps/video` 渲染的产品短片，播完后片尾字标收进侧栏，画框从 16:9 变成工作区比例，
 * 侧栏逐行滑入、内容面板上浮、首页内容依次弹入，最后换成可点击的 `HeroDemo`。
 * 拼装动画全部由 Web Animations 驱动。“重看短片”不倒放：工作区直接淡出、画框收回 16:9，同时淡入短片开头，
 * 避免字标先回到中央、又在开场和片尾反复出现。
 * 首屏只加载封面；舞台接近视口时才按实际像素宽度选择清晰度并下载，进入视口才播放，离开时暂停。
 * 系统要求减少动态效果或浏览器开启省流量时，直接展示互动演示，需要时由用户点击观看短片。
 */
const videos = import.meta.glob<string>("./hero-video/*/*.{mp4,jpg}", { eager: true, query: "?url", import: "default" });
/** 舞台实际像素宽度超过该值时加载 1080p。 */
const HD_FROM = 1400;
const VIDEO_W = 1920;
const VIEW_W = 1440;
const VIEW_H = 900;
const PAGE_X = 216;
/** 片尾落版里的字标（1920×1080 视频坐标）与截图侧栏里的字标（1440×900 工作区坐标）。 */
const LOGO_FROM = { x: 600, y: 378.27, w: 720 };
const LOGO_TO = { x: 22.12, y: 24.31, w: 146.4 };
/** 侧栏逐行（工作区纵向范围），第 0 行是字标。 */
const SIDEBAR_ROWS = [[16, 60], [65, 95], [110, 143], [149, 180], [187, 218], [225, 255], [263, 294], [301, 332], [339, 370], [388, 417], [420, 450], [452, 482], [484, 515], [516, 547], [822, 882]];
/** 首页内容块（页面截图坐标）：问候、副标题、输入框、快捷按钮、三张卡片。 */
const HOME_PIECES = [
  { x: 246, y: 232, w: 733, h: 52 },
  { x: 246, y: 288, w: 733, h: 28 },
  { x: 246, y: 345, w: 733, h: 133 },
  { x: 246, y: 482, w: 733, h: 34 },
  { x: 246, y: 535, w: 241, h: 250 },
  { x: 492, y: 535, w: 241, h: 250 },
  { x: 738, y: 535, w: 241, h: 250 },
];
/** 页面截图里白色内容卡片的位置与圆角。 */
const CARD = { x: 13.5, y: 17, w: 1197, h: 868, r: 16 };
/** 拼装总时长（秒）。 */
const TOTAL = 2.2;
/** 字标开始移动的时刻（秒）；视频必须在此之前完全淡出。 */
const LOGO_AT = .15;
/** 字标飞到侧栏所需时长（秒）；落位瞬间截图字标在下方出现，网页字标再在其上淡出。 */
const LOGO_FLY = .72;
const LOGO_LAND = LOGO_AT + LOGO_FLY;
const EASE = "cubic-bezier(.65, 0, .35, 1)";
const OUT = "cubic-bezier(.22, 1, .36, 1)";
const SPRING = "linear(0, .06 4%, .24 9%, .53 16%, .86 24%, 1.03 31%, 1.08 37%, 1.06 45%, 1.01 56%, .995 70%, 1)";

type Phase = "video" | "assembling" | "done" | "leaving";
export type HeroShowcaseHandle = { watch: () => void };

function prefersStill() {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return reduced || saveData;
}

export function HeroShowcase({ ref }: { ref?: Ref<HeroShowcaseHandle> }) {
  const locale = useLocale();
  const folder = locale === "en-US" ? "en-US" : "zh-CN";
  const { shot } = useDemoShots();
  const [still] = useState(prefersStill);
  const [phase, setPhaseState] = useState<Phase>(still ? "done" : "video");
  const [film, setFilm] = useState(!still);
  const [src, setSrc] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const pieces = useRef<HTMLDivElement>(null);
  const logo = useRef<HTMLImageElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  const visible = useRef(false);
  /** 用户主动要求播放（按钮或 CTA），不受可见性判断限制。 */
  const wanted = useRef(false);
  const anims = useRef<Animation[]>([]);
  const run = useRef(0);
  const width = useRef(0);

  const setPhase = (next: Phase) => { phaseRef.current = next; setPhaseState(next); };
  const pick = () => videos[`./hero-video/${folder}/${(stage.current?.clientWidth ?? 0) * (window.devicePixelRatio || 1) > HD_FROM ? "teaser-1080.mp4" : "teaser-720.mp4"}`];
  const clearAnims = () => { anims.current.forEach(animation => animation.cancel()); anims.current = []; };

  const measure = useCallback(() => {
    const element = stage.current;
    if (!element?.clientWidth) return;
    const w = element.clientWidth;
    width.current = w;
    if (win.current) win.current.style.transform = `scale(${w / VIEW_W})`;
    if (viewport.current) viewport.current.style.borderRadius = `${(CARD.r + 12) * w / VIEW_W}px`;
    if (!anims.current.length) element.style.height = `${phaseRef.current === "done" ? w * VIEW_H / VIEW_W : w * 9 / 16}px`;
  }, []);

  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, [measure]);

  // 切换阶段的渲染提交后才卸下动画与碎片：拼装完成时互动演示已经接管画面，回到短片时工作区已经隐藏；
  // 提前取消会让被动画压住的工作区恢复不透明，在下一帧闪现一下。阶段变化后按新比例重设画框高度
  useLayoutEffect(() => {
    if (phase === "done" || phase === "video") {
      clearAnims();
      pieces.current?.replaceChildren();
    }
    measure();
  }, [phase, measure]);

  /** 搭建整段拼装动画；所有动画统一延长到总时长，一起结束。 */
  const build = () => {
    clearAnims();
    const box = pieces.current, element = stage.current, film = video.current, mark = logo.current, back = bg.current, frame = win.current;
    if (!box || !element || !film || !mark || !back || !frame) return 0;
    box.replaceChildren();
    const w = width.current;
    const sv = w / VIDEO_W, sw = w / VIEW_W;
    const ms = (seconds: number) => seconds * 1000;
    // 每段动画都用 endDelay 补齐到总时长，全部结束时才交给互动演示
    const go = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const used = Number(options.delay ?? 0) + Number(options.duration ?? 0);
      anims.current.push(target.animate(keyframes, { fill: "both", ...options, endDelay: Math.max(0, ms(TOTAL) - used) }));
    };
    const piece = (image: string, x: number, y: number, w: number, h: number, offsetX = 0) => {
      const element = document.createElement("div");
      element.className = "fl-showcase-piece";
      Object.assign(element.style, { left: `${offsetX + x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, backgroundImage: `url(${image})`, backgroundSize: `${offsetX ? VIEW_W - PAGE_X : PAGE_X}px ${VIEW_H}px`, backgroundPosition: `${-x}px ${-y}px` });
      box.appendChild(element);
      return element;
    };

    // 1. 网页字标与视频最后一帧重合，视频在字标起步前淡完、操作按钮暂时隐去；
    //    两者有交叠时移动中的字标会与视频里的字标错位成重影
    mark.style.width = `${LOGO_FROM.w * sv}px`;
    go(film, [{ opacity: 1 }, { opacity: 0 }], { duration: ms(LOGO_AT), easing: "ease-out" });
    if (bar.current) go(bar.current, [{ opacity: 1 }, { opacity: 0, offset: .06 }, { opacity: 0, offset: .85 }, { opacity: 1 }], { duration: ms(TOTAL) });
    // 2. 字标收进侧栏；落位瞬间截图里的字标已在下方就绪，网页字标再在其上淡出，
    //    两者颜色略有差异，先淡出再出现会在落点闪一下
    const k = (LOGO_TO.w * sw) / (LOGO_FROM.w * sv);
    go(mark, [
      { transform: `translate(${LOGO_FROM.x * sv}px, ${LOGO_FROM.y * sv}px) scale(1)` },
      { transform: `translate(${LOGO_TO.x * sw}px, ${LOGO_TO.y * sw}px) scale(${k})` },
    ], { duration: ms(LOGO_FLY), delay: ms(LOGO_AT), easing: EASE });
    go(mark, [{ opacity: 1 }, { opacity: 0 }], { duration: ms(.25), delay: ms(LOGO_LAND), easing: "ease-in-out" });
    // 3. 画框 16:9 → 工作区比例，底色过渡
    go(element, [{ height: `${w * 9 / 16}px` }, { height: `${w * VIEW_H / VIEW_W}px` }], { duration: ms(.8), delay: ms(.25), easing: EASE });
    go(back, [{ opacity: 0 }, { opacity: 1 }], { duration: ms(.5), delay: ms(.15), easing: "ease-out" });
    // 4. 侧栏逐行滑入
    SIDEBAR_ROWS.forEach(([top, bottom], index) => {
      const row = piece(shot("sidebar"), 0, top, PAGE_X, bottom - top);
      if (index === 0) go(row, [{ opacity: 0 }, { opacity: 1 }], { duration: 1, delay: ms(LOGO_LAND) - 1 });
      else go(row, [{ opacity: 0, transform: "translateX(-14px)" }, { opacity: 1, transform: "none" }], { duration: ms(.5), delay: ms(.82 + index * .035), easing: OUT });
    });
    // 5. 白色内容卡片上浮
    const card = document.createElement("div");
    card.className = "fl-showcase-card";
    Object.assign(card.style, { left: `${PAGE_X + CARD.x}px`, top: `${CARD.y}px`, width: `${CARD.w}px`, height: `${CARD.h}px`, borderRadius: `${CARD.r}px` });
    box.appendChild(card);
    go(card, [{ opacity: 0, transform: "translateY(28px) scale(.985)" }, { opacity: 1, transform: "none" }], { duration: ms(.7), delay: ms(.55), easing: OUT });
    // 6. 首页内容依次弹入
    HOME_PIECES.forEach((part, index) => {
      const element = piece(shot("home"), part.x, part.y, part.w, part.h, PAGE_X);
      const delay = ms(.95 + index * .08);
      go(element, [{ transform: "translateY(22px) scale(.96)" }, { transform: "none" }], { duration: ms(.75), delay, easing: SPRING });
      go(element, [{ opacity: 0 }, { opacity: 1 }], { duration: ms(.3), delay, easing: "linear" });
    });
    go(frame, [{ opacity: 1 }, { opacity: 1 }], { duration: ms(TOTAL) });
    return ms(TOTAL);
  };
  const allDone = () => Promise.all(anims.current.map(animation => animation.finished));

  const finish = () => {
    setFilm(false);
    setPhase("done");
  };

  const assemble = () => {
    if (phaseRef.current !== "video") return;
    const id = ++run.current;
    setPhase("assembling");
    build();
    window.setTimeout(() => { if (id === run.current) setFilm(false); }, 200);
    allDone().then(() => { if (id === run.current) finish(); }).catch(() => {});
  };

  const play = () => { void video.current?.play()?.catch(() => {}); };

  const restart = () => {
    run.current += 1;
    // 已在短片阶段时不会重新提交，直接清理；其余阶段等切回短片的渲染提交后再清理
    if (phaseRef.current === "video") {
      clearAnims();
      pieces.current?.replaceChildren();
    }
    setFilm(true);
    setPhase("video");
    wanted.current = true;
    if (!src) setSrc(pick());
    const element = video.current;
    if (element) {
      if (element.readyState > 0) element.currentTime = 0;
      play();
    }
  };

  // 重看：工作区淡出、画框收回 16:9，同时淡入短片第一帧，然后从头播放；字标不参与，避免反复出现
  const rewatch = () => {
    const film = video.current, element = stage.current, frame = win.current;
    if (phaseRef.current !== "done" || still || !film || !element || !frame || !width.current) { restart(); return; }
    const id = ++run.current;
    const w = width.current;
    clearAnims();
    const go = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => { anims.current.push(target.animate(keyframes, { fill: "both", ...options })); };
    if (film.readyState > 0) film.currentTime = 0;
    go(element, [{ height: `${w * VIEW_H / VIEW_W}px` }, { height: `${w * 9 / 16}px` }], { duration: 650, easing: EASE });
    go(frame, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: "ease-out" });
    go(film, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 230, easing: "ease-out" });
    setPhase("leaving");
    window.setTimeout(() => { if (id === run.current) setFilm(true); }, 200);
    allDone().then(() => { if (id === run.current) restart(); }).catch(() => {});
  };

  // 跳过：视频短暂淡出，跳到最后一帧，再接拼装
  const skip = () => {
    if (phaseRef.current !== "video") return;
    const element = video.current;
    if (still || !element || !element.duration) { run.current += 1; element?.pause(); finish(); return; }
    const id = ++run.current;
    element.pause();
    element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" }).finished.then(() => {
      element.addEventListener("seeked", () => {
        if (id !== run.current) return;
        element.getAnimations().forEach(animation => animation.cancel());
        element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 }).finished.then(() => { if (id === run.current) assemble(); });
      }, { once: true });
      element.currentTime = Math.max(0, element.duration - .05);
    }).catch(() => {});
  };

  useImperativeHandle(ref, () => ({ watch: () => { stage.current?.scrollIntoView({ behavior: "smooth", block: "center" }); rewatch(); } }));

  // 语言切换：回到短片开头（或减少动态效果时的互动演示）
  useEffect(() => {
    run.current += 1;
    wanted.current = false;
    clearAnims();
    pieces.current?.replaceChildren();
    setSrc(undefined);
    setFilm(!still);
    setPhase(still ? "done" : "video");
  }, [folder]);

  // 接近视口时才决定清晰度并开始下载；进入视口 40% 才播放，离开时暂停
  useEffect(() => {
    const element = stage.current;
    if (!element || still) return;
    if (typeof IntersectionObserver === "undefined") {
      setSrc(pick());
      return;
    }
    const near = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSrc(pick());
      near.disconnect();
    }, { rootMargin: "300px 0px" });
    const seen = new IntersectionObserver(([entry]) => {
      visible.current = entry.intersectionRatio >= .4;
      if (phaseRef.current !== "video") return;
      if (visible.current && !video.current?.ended) play();
      else video.current?.pause();
    }, { threshold: [0, .4] });
    near.observe(element);
    seen.observe(element);
    return () => { near.disconnect(); seen.disconnect(); };
  }, [folder]);

  useEffect(() => {
    if (!src) return;
    // 视频开始下载后预载拼装用到的截图
    [shot("sidebar"), shot("home")].forEach(url => { new Image().src = url; });
    if ((visible.current || wanted.current) && phaseRef.current === "video") play();
  }, [src]);

  const onEnded = () => {
    wanted.current = false;
    if (visible.current) assemble();
    else { run.current += 1; finish(); }
  };

  const live = phase === "done";
  const demo = live || phase === "leaving";
  return (
    <div ref={stage} id="demo" className="fl-hero-stage fl-showcase" data-phase={phase} aria-label={lt(film ? "LinkResume 产品短片" : "LinkResume 产品首页演示")}>
      <div ref={bar} className="fl-showcase-bar">
        {film
          ? <button type="button" onClick={skip}>{lt("跳过短片")}<ArrowRight size={12} strokeWidth={2} /></button>
          : <button type="button" onClick={rewatch}><RotateCcw size={12} strokeWidth={2} />{lt(still ? "观看短片" : "重看短片")}</button>}
      </div>
      <div ref={viewport} className="fl-demo-viewport">
        <video
          key={folder}
          ref={video}
          src={src}
          poster={videos[`./hero-video/${folder}/poster.jpg`]}
          muted
          playsInline
          preload="none"
          aria-label={lt("LinkResume 产品短片")}
          aria-hidden={live}
          style={live ? { opacity: 0 } : undefined}
          onEnded={onEnded}
        />
        <div ref={win} className="fl-demo-window" style={{ width: VIEW_W, height: VIEW_H, visibility: phase === "video" ? "hidden" : "visible" }}>
          <div ref={bg} className="fl-showcase-bg" style={demo ? { opacity: 1 } : undefined} />
          <div ref={pieces} />
          {demo && <HeroDemo key={locale} />}
        </div>
        <img ref={logo} className="fl-showcase-logo" src={wordmark} alt="" hidden={phase !== "assembling"} />
      </div>
      <span className="fl-showcase-note">{lt(film ? "产品短片 · 示例数据" : "互动演示 · 示例数据")}</span>
    </div>
  );
}
