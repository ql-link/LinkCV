import { Composition } from "remotion";
import { FPS, ProductIntro, totalFrames } from "./ProductIntro";
import { ProductTeaser, TEASER_SECONDS } from "./teaser/ProductTeaser";

export function Root() {
  return <>
    <Composition id="ProductIntro" component={ProductIntro} durationInFrames={totalFrames} fps={FPS} width={1920} height={1080} />
    <Composition id="ProductTeaser" component={ProductTeaser} durationInFrames={TEASER_SECONDS * FPS} fps={FPS} width={1920} height={1080} />
  </>;
}
