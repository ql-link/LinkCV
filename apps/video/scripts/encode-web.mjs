// 把渲染好的短片压成落地页使用的网页版本：1080p 与 720p 两档 H.264（faststart，可边下边播）和封面图。
// 先运行 render:teaser 与 render:teaser:en，再运行本脚本；输出直接写入 Web 落地页目录。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "../web/src/features/landing/hero-video");
const sources = { "zh-CN": "out/linkresume-teaser.mp4", "en-US": "out/linkresume-teaser-en.mp4" };

function ffmpeg(args) {
  const result = spawnSync("npx", ["remotion", "ffmpeg", "-loglevel", "error", "-y", ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg 失败：${args.join(" ")}`);
}

const h264 = ["-c:v", "libx264", "-preset", "slow", "-tune", "animation", "-crf", "26", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"];

for (const [locale, source] of Object.entries(sources)) {
  const input = join(root, source);
  if (!existsSync(input)) throw new Error(`缺少渲染结果 ${source}，请先渲染对应语言的短片`);
  const dir = join(target, locale);
  mkdirSync(dir, { recursive: true });
  ffmpeg(["-i", input, ...h264, join(dir, "teaser-1080.mp4")]);
  ffmpeg(["-i", input, "-vf", "scale=1280:-2", ...h264, join(dir, "teaser-720.mp4")]);
  // 封面取片尾品牌落版
  ffmpeg(["-sseof", "-0.6", "-i", input, "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "4", join(dir, "poster.jpg")]);
  for (const name of ["teaser-1080.mp4", "teaser-720.mp4", "poster.jpg"]) {
    console.log(`${locale}/${name}  ${(statSync(join(dir, name)).size / 1024 / 1024).toFixed(2)} MB`);
  }
}
