import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/600.css";
import { useEffect, useState, type ReactNode } from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneList } from "./scenes/Scenes";
import { easeInOut } from "./app/anim";

export const FPS = 30;
const overlap = 0.4;

const timeline = sceneList.reduce<{ from: number; frames: number; name: string; component: () => ReactNode }[]>((list, scene) => {
  const previous = list[list.length - 1];
  const from = previous ? previous.from + previous.frames - Math.round(overlap * FPS) : 0;
  return [...list, { ...scene, from, frames: Math.round(scene.seconds * FPS) }];
}, []);

export const totalFrames = timeline[timeline.length - 1].from + timeline[timeline.length - 1].frames;

/** 场景淡入（与上一场景交叠），字体就绪后才截帧。 */
function Fade({ children, first }: { children: ReactNode; first: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => { document.fonts.ready.then(() => continueRender(handle)); }, [handle]);
  const p = first ? 1 : easeInOut(Math.min(1, frame / (overlap * fps)));
  return <AbsoluteFill style={{ opacity: p }}>{children}</AbsoluteFill>;
}

export function ProductIntro() {
  return <AbsoluteFill style={{ background: "#fff" }}>
    {timeline.map(({ name, from, frames, component: Scene }, i) => <Sequence key={name} name={name} from={from} durationInFrames={frames}><Fade first={i === 0}><Scene /></Fade></Sequence>)}
  </AbsoluteFill>;
}
