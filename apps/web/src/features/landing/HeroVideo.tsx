import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useLocale } from "@/i18n";
import { lt } from "./landingCopy";

/**
 * Hero 产品短片：`apps/video` 渲染、`encode:web` 压缩出的 1080p / 720p 两档 H.264 与片尾封面。
 * 首屏只加载封面；舞台接近视口时才按实际像素宽度选择清晰度并开始下载，进入视口后静音循环播放，离开时暂停。
 * 系统要求减少动态效果或浏览器开启省流量时不自动播放，由用户点击播放。
 */
const files = import.meta.glob<string>("./hero-video/*/*.{mp4,jpg}", { eager: true, query: "?url", import: "default" });
/** 舞台实际像素宽度超过该值时加载 1080p。 */
const HD_FROM = 1400;

function prefersStill() {
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return reduced || saveData;
}

export function HeroVideo() {
  const locale = useLocale();
  const folder = locale === "en-US" ? "en-US" : "zh-CN";
  const file = (name: string) => files[`./hero-video/${folder}/${name}`];
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string>();
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);
  // 自动播放；用户手动暂停后不再自动恢复，手动播放后恢复自动
  const [auto, setAuto] = useState(() => !prefersStill());

  const pick = (dir = folder) => {
    const width = (stage.current?.clientWidth ?? 0) * (window.devicePixelRatio || 1);
    return files[`./hero-video/${dir}/${width > HD_FROM ? "teaser-1080.mp4" : "teaser-720.mp4"}`];
  };

  // 接近视口时才决定清晰度并开始下载；语言切换时先清空，再换成对应语言的文件
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const load = () => setSrc(pick(folder));
    setSrc(undefined);
    setPlaying(false);
    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }
    const near = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      load();
      near.disconnect();
    }, { rootMargin: "300px 0px" });
    const seen = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= 0.4), { threshold: [0, 0.4] });
    near.observe(element);
    seen.observe(element);
    return () => { near.disconnect(); seen.disconnect(); };
  }, [folder]);

  useEffect(() => {
    const element = video.current;
    if (!element || !src) return;
    if (auto && visible) void element.play()?.catch(() => setPlaying(false));
    else element.pause();
  }, [auto, visible, src]);

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (playing) {
      setAuto(false);
      element.pause();
      return;
    }
    setAuto(true);
    setVisible(true);
    if (!src) setSrc(pick());
    else void element.play()?.catch(() => setPlaying(false));
  };

  return (
    <div ref={stage} id="demo" className="fl-hero-stage fl-hero-video">
      <span className="fl-demo-label">{lt("产品短片 · 示例数据")}</span>
      <div className="fl-demo-viewport">
        <video
          key={folder}
          ref={video}
          src={src}
          poster={file("poster.jpg")}
          muted
          loop
          playsInline
          preload="none"
          aria-label={lt("LinkResume 产品短片")}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        <button type="button" className="fl-video-toggle" data-playing={playing} aria-label={playing ? lt("暂停短片") : lt("播放短片")} onClick={toggle}>
          {playing ? <Pause size={16} strokeWidth={2} /> : <Play size={18} strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}
