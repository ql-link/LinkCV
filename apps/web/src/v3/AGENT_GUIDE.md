# V3 前端复刻 · 子代理共用约定

目标：把 Figma「V3 · 单栏」（fileKey `a5BQtKwoGEDvCg5Iv13nPr`）一比一复刻到 `apps/web`。只动前端，不改后端。

## 已经做好的地基（只读，不要改；确实需要新增公共件时在自己模块里写）
- `src/v3/v3.css`：全部颜色 / 字体 Token（`--v3-*`）和公共样式：按钮 `.v3-btn(-dark|-ghost|-danger|-text)`、`.v3-chip`、`.v3-pill`、`.v3-be-tag`、`.v3-card`、`.v3-stage.has-dots`（插图舞台，点阵底）、`.v3-gcard/.v3-grow`（收纳卡片）、弹窗 `.v3-dialog*`、表单 `.v3-field/.v3-input/.v3-textarea`、搜索框 `.v3-search`、下拉 `.v3-select`、分段 `.v3-seg`、开关 `.v3-toggle`、单选 `.v3-radio`、空状态 `.v3-empty`、页头 `.v3-page/.v3-page-title`。
- `src/v3/primitives.tsx`：`Popover`、`Menu`、`Select`（自绘下拉，箭头离右边框 14px）、`DateTimeField`（自绘日期时间）、`Dialog`、`ConfirmDialog`（居中确认）、`DialogFooter`、`BeTag`、`Segmented`、`Toggle`、`SearchBox`（无蓝框）、`Avatar`、`Toast`。
- `src/v3/Icon.tsx` + `iconPaths.ts`：设计稿同款线性图标 `<Icon name="cal" size={14} />`，名字与 Figma 图层 `icon/xxx` 一致。
- `src/v3/art.tsx`：插图零件 `Bar`、`Paper`、`MiniResume`、`FilePaper`、`Badge`、`DashArrow`、`TagCard`、`Dot`、`StageText`、`Centered`。
- `src/v3/Shell.tsx`：`V3Shell`（侧栏 216 + 右侧白色内容卡 left 229 / top 12 / 右下 12，圆角 16，边框 #e4e4e0）。App.tsx 已经把所有工作区页面包进去，页面组件只渲染内容卡里的东西。
- `src/v3/mocks.ts`：需后端的示例数据集中放这里（可以追加自己模块的条目，注释写清楚缺哪个字段 / 接口）。

## 硬性规则（用户要求）
1. 按 Figma 一比一复刻：尺寸、字号、颜色、间距、文案都照画板。内容卡坐标系：内容卡宽 1151、高 952，页面正文列 `CX=146, CW=860`（即左右各留 145）。用 flex / grid 写出等效布局，宽度随窗口伸缩时正文居中。
2. 下拉框、时间填写框一律用 `primitives.tsx` 的 `Select` / `DateTimeField`，不用原生 `<select>`、`<input type=date>`。
3. 搜索框里不能出现蓝色的框（用 `SearchBox` 或同样的写法：`outline: none; box-shadow: none`）。
4. 下拉框的箭头不要贴边框，保持 `.v3-select` 的 14px 右内边距。
5. 注意有的画板左上角图标是错的（例如画板里出现了不该有的图标或默认图形）——以功能和同类画板为准，不要照抄明显的错误图标。拿不准的在汇报里列出来。
6. 后端没有的功能先写前端，用 `mocks.ts` 的假数据，界面上照 Figma 贴 `<BeTag />`（橙色「需后端」）。
7. 每页只有一个黑色主按钮；危险操作用红色。
8. 字体：衬线标题 `font-family: var(--v3-serif); font-weight: 600`；数字 `var(--v3-num)`（Inter）；正文 `var(--v3-sans)`。
9. 复用现有 API（`src/api/client.ts` 的 `api.*`）和现有业务逻辑（store、hooks、校验函数），不要改接口契约，不要改 `apps/backend`。
10. 不要做 git commit / push。不要改其他模块负责的文件。

## 怎么读 Figma
- 用 `mcp__plugin_figma_figma__use_figma`（skillNames 填 `resource:figma-use`）执行只读脚本拿结构，比 get_design_context 省得多。示例（紧凑打印某节点子树）：
```js
const hex=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
const dump=(n,d,o)=>{if(n.name==='Dot grid')return;let s='  '.repeat(d)+(n.type==='TEXT'?'T':n.type[0])+' '+(n.type==='TEXT'?'':n.name+' ')+Math.round(n.x)+','+Math.round(n.y)+' '+Math.round(n.width)+'x'+Math.round(n.height);
if(n.type==='TEXT')s+=' "'+n.characters+'" '+n.fontSize+(n.fontName.style!=='Regular'?' '+n.fontName.style:'')+(n.fontName.family!=='Noto Sans SC'?' '+n.fontName.family:'');
const f=n.fills&&n.fills[0];if(f&&f.color)s+=' '+hex(f.color)+(f.opacity<1?'/'+f.opacity.toFixed(2):'')+(n.opacity<1?' op'+n.opacity.toFixed(2):'');
if(n.strokes&&n.strokes[0]&&n.strokes[0].color)s+=' s'+hex(n.strokes[0].color)+(n.dashPattern&&n.dashPattern.length?'dash':'');if(typeof n.cornerRadius==='number'&&n.cornerRadius)s+=' r'+n.cornerRadius;if(n.effects&&n.effects.length)s+=' fx';if(n.rotation)s+=' rot'+Math.round(n.rotation);
o.push(s);if('children' in n&&!n.name.startsWith('icon/'))n.children.forEach(c=>dump(c,d+1,o));};
const o=[];dump(await figma.getNodeByIdAsync('NODE_ID'),0,o);return o.join('\n');
```
- 只读，绝对不要修改 Figma 文件。
- 需要看图：`mcp__plugin_figma_figma__get_screenshot`（你可能看不到图片，那就按坐标核对）。
- 设计稿脚本（坐标和文案的原始来源，很有用）：`/Users/fang/Downloads/linkresume-figma/`，公共库 `lib.js`～`lib12.js`，页面 `pNN.js`；对照表见同目录 `HANDOFF.md`。

## 验证
- 本地 dev server：`http://127.0.0.1:5174`（已登录测试账号 v3-preview@example.com / Preview12345）。浏览器工具：`mcp__Claude_Browser__preview_*`，serverId `304f4bc8-171a-4488-80c5-463bfdca7e1d`；用 `preview_resize` 设 1440×1024 对照 Figma（画板窗口 1392×976，内容卡从 (229,12) 开始）。浏览器是共享的，多个代理同时在用：每次操作前先 `location.href=` 到自己的页面。
- 用 `preview_eval` 读 `getBoundingClientRect()` 核对关键元素的位置和尺寸，和 Figma 坐标比（Figma 内容卡坐标 +229/+12 = 视口坐标）。
- 跑 `cd apps/web && npx tsc --noEmit -p .` 必须通过；跑自己模块相关的 vitest（旧测试若因 UI 改版失效，按新 UI 更新测试断言，保留业务行为测试）。
- 汇报：做了哪些画板、哪些用了假数据、哪些与 Figma 有出入以及原因、跑过的检查和结果。

## 07 模拟面试（2026-09-30 追加）
- 用户已授权实现 07（之前约定「不动」作废）。后端 /api/mock-interviews 已存在，但前端先全部走本地假数据：`src/features/mock-interview/mockInterviewApi.ts`（主代理维护，类型与 FastAPI schemas.py 对齐，函数与接口一一对应）。页面只调 `mockInterviewApi.*`，不要直接 fetch。需要新增假数据能力时在汇报里说明，由主代理改；小的纯展示常量可以放本模块文件里。
- 路由（主代理已接好）：`/mock-interviews`（07.1 首页，view=home）、`/mock-interviews/new?application=&resume=`（07.1a）、`/mock-interviews/:id`（07.2 准备中 / 进行中，07.4 / 07.5 语音）、`/mock-interviews/:id/report`（07.3 / 07.6 报告）。路径函数 `mockInterviewPath`、`newMockInterviewPath` 在 routing.ts。
- `MockInterviewPage.tsx` 是入口分发，页面自己包 `<V3Shell active="mock">`；07.5 语音面试进行中是无侧栏整窗，用 `<V3Shell active="mock" bare>`。
- 侧栏已加「模拟面试」（icon mic）；图标新增 `mic`、`wave`。
- 界面上凡是假数据驱动的部分贴 `<BeTag />`（接口已有但前端未接，也算「需后端」）。
