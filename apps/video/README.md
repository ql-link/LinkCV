# LinkResume 产品视频

用 [Remotion](https://www.remotion.dev/) 以代码生成的两支产品视频，均为 1920×1080、30fps、白底、无配音，不录屏、不连接后端，所有数据均为虚构。

- **短片 `ProductTeaser`**（约 56 秒）：不展示真实页面，沿用 Web 的黑白编辑风格（墨黑文字、细线、衬线标题、Apple 式缓动，蓝色表示扎实、橙色表示薄弱）。主线是“记录沉淀为能力图谱”：扫描导入简历、逐字流动切换模板、逐句检查并采用改写 → 插件收藏岗位、匹配度、面试日程 → 真实面试复盘与模拟面试追问 → 3D 能力图谱聚焦短板并专项补强 → 落版。镜头一镜到底，由上一段的元素承接下一段（横线 → 扫描线、简历 → 缩略图、日程块 → 录音面板、面试画面 → 图谱碎片）；弹层用轻弹簧入场。
- **宣传片 `ProductIntro`**（约 92 秒）：画面是按真实工作区样式重新绘制的界面，跟随虚构用户「张三」投递「星河科技 · 高级产品经理」走完一条求职流程：准备资料 → 导入简历 → 导入岗位 → 按岗位改简历 → 投递推进 → 一面复盘 → 二面准备 → 模拟面试 → 能力看板 → 回到首页。

## 命令

```bash
npm ci --prefix apps/video
npm --prefix apps/video run studio   # 预览与逐帧调试
npm --prefix apps/video run render   # 输出 apps/video/out/linkresume-intro.mp4
npm --prefix apps/video run render:teaser   # 输出 apps/video/out/linkresume-teaser.mp4
npm --prefix apps/video run render:teaser:en   # 全英文版，输出 apps/video/out/linkresume-teaser-en.mp4
npm --prefix apps/video run encode:web   # 把两版短片压成落地页用的 1080p/720p 与封面，写入 apps/web/src/features/landing/hero-video/
npm --prefix apps/video run still -- --frame=690   # 导出单帧
```

渲染需要 Chrome。没有自动下载的 Headless Shell 时，可以追加 `--browser-executable=<Chrome 路径>`。

## 结构

| 位置 | 内容 |
| --- | --- |
| `src/teaser/` | 短片：`ProductTeaser.tsx` 时间轴；`opening`、`resume`、`apply`、`interview`、`graph` 五个镜头（图谱为手写透视投影）；`fx.tsx` 配色、缓动、弹簧弹层、镜头、遮罩揭开、细线与品牌落版；简历镜头在字体就绪后测量逐字坐标，用于模板切换；`copy.ts` 以中文原文为键提供英文文案，渲染时传 `--props='{"locale":"en"}'` 输出英文版，缺译直接报错 |
| `scripts/encode-web.mjs` | 用 Remotion 自带的 ffmpeg 把两版短片压成 H.264（CRF 26、faststart）1080p 与 720p，并截取开场散乱画面作封面 |
| `src/ProductIntro.tsx` | 时间轴：按 `sceneList` 顺序排列，相邻场景交叠 0.4 秒淡入 |
| `src/scenes/Scenes.tsx` | 每个场景的页面、镜头关键帧、光标轨迹和字幕 |
| `src/app/Shell.tsx` | 工作区窗口：侧栏、内容面板、镜头推拉、假光标、字幕 |
| `src/app/anim.ts` | 帧驱动的缓动、逐字输出和关键帧插值 |
| `src/app/theme.ts`、`src/app/ui.tsx` | 与 Web 设计 Token 对齐的配色、字体和基础组件 |
| `src/pages/` | 首页、资料库、我的简历、岗位看板、对话改简历、岗位详情、模拟面试 |

## 约定

- 所有动画都由当前帧计算（`useT`、`ramp`、`keyframes`），不使用 CSS 动画或计时器，保证并行渲染时每帧确定。
- 镜头和光标坐标使用 1440×900 工作区坐标；页面内部使用内容面板坐标，换算见 `Scenes.tsx` 的 `P()`。
- 宣传片只展示已实现的能力，真实界面改版后按 `apps/web` 的页面同步调整绘制。短片的能力图谱段是按产品决定先行展示的规划功能，界面与数据均为示意。
- `@web-assets` 指向 `apps/web/src/assets`，仅用于品牌字标和模型图标。
