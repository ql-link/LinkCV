# 简历模板第三方来源

## 用户选定商务与活力版式（0081）

以用户提供的两张独立截图为视觉参考，分别实现 `featured-classic-business-cn`（经典商务）与 `featured-vitality-cn`（活力）。前者提炼浅蓝居中肖像页眉、细蓝章节线与紧凑单栏正文；后者提炼暖橙身份卡、白色经历卡片与右侧技能栏。两套版式复用项目内 `0079` 已验证的虚构产品经理样本，不复制截图中的真人照片、VIP 标识、联系方式、文字、源码或装饰素材，头像继续使用项目内置安全占位。

## 用户选定卡片版式（0080）

以用户提供的同页对比截图为视觉参考，独立实现 `featured-card-dashed-cn`（卡片虚线）与 `featured-card-rail-cn`（卡片分栏）。两套版式复用项目内 `0079` 已验证的虚构产品经理样本，只参考圆角蓝色身份卡、虚线章节和左侧章节索引的视觉关系；不复制截图中的照片、文字、源码或其他素材，头像继续使用项目内置安全占位。

## 用户选定蓝色版式（0079）

以用户提供的九宫格截图为视觉参考，独立实现七套 `featured-*`：40 → 蓝幕校招、60 → 浅蓝社招、70 → 清蓝实习、120 → 钴蓝右栏、160 → 蓝色拼版、90 → 蓝线财务、130 → 蓝带人事。编号是 HireTechUpUp 预览文件的编号，不是独立设计数的证明。

110 新媒体运营、240 程序员分别已有 `studio-layered-capsule` 与 `studio-node-timeline`，未重复新增。其余版式即使配色接近旧主题，仍按截图的身份位置、主辅栏、标题结构独立实现。参考库未发现明确许可证，因此不复制源码、照片或示例文字；沿用本项目内置头像与虚构示例，所有正文可编辑，不把截图作为模板背景。

迁移 `0072` 的六套 `open-*` 模板按 MIT 许可证适配，完整版权与许可声明随 Web 发布于 `public/third-party/template-notices.txt`。分发代码或静态制品时需保留此文件；许可证并不等于对上游名称、商标或第三方素材的独立授权。

| 模板 | 上游 / 固定提交 | 参考文件 |
| --- | --- | --- |
| 灰阶章节索引（`open-even-cn`） | [rbardini/jsonresume-theme-even](https://github.com/rbardini/jsonresume-theme-even/tree/8231a31977aa7bfc7c1724713b523a85f32a760d) | `assets/page.css` |
| 学术短线履历（`open-moderncv-cn`） | [rendercv/rendercv-typst](https://github.com/rendercv/rendercv-typst/tree/71e22e0692fc84518b2255974cf693b3334ab928) | `lib.typ; examples/moderncv.typ` |
| 青绿职业档案（`open-caffeine-cn`） | [kelyvin/jsonresume-theme-caffeine](https://github.com/kelyvin/jsonresume-theme-caffeine/tree/e3a504213c59853e786f0175ef5e4cb85e587edf) | `app/styles/layouts/_page.scss; app/styles/base/_global.scss` |
| 黑白大字专栏（`open-classy-cn`） | [JaredCubilla/jsonresume-theme-classy](https://github.com/JaredCubilla/jsonresume-theme-classy/tree/c5edc25186801533fa750d5e6d4d63a0b31b48be) | `resume.template` |
| 编辑部双栏（`open-actual-cn`） | [davcd/jsonresume-theme-actual](https://github.com/davcd/jsonresume-theme-actual/tree/4176e5ce2e16a964ed4ab515d554bb16706e0858) | `assets/scss/main.scss; assets/scss/basics.scss; assets/scss/skills.scss` |
| 蓝幕分区档案（`open-class-cn`） | [jsonresume/jsonresume-theme-class](https://github.com/jsonresume/jsonresume-theme-class/tree/7c8ed4b40a28164626e419a52dea0d800e37a4a0) | `src/style.css` |

## 适配边界

仅参考并改写上述排版实现，接入项目既有 canonical 区域和共享编辑/打印样式，不引入上游运行时依赖。中文内容来自本项目虚构示例；未引入上游照片、个人履历、远程字体或图标包。RenderCV 的 Typst 排版以 CSS 重新表达，不调用 Typst。

先前 HireTechUpUp/resume-template 参考库在检查的提交 `0e232018c240d4734c2eee3e54fb50369a67722b` 未发现 LICENSE；不能将仓库公开视为搬运代码或图片的授权。既有参考批次不带入该库图片或源码，本批次也不从该库复制资源。

## 跨行业、校招与实习批次（0078）

以下五套均采用 MIT 许可排版，使用项目内独立编写的虚构示例，不引入上游履历、照片、字体、图标或运行时依赖。完整许可声明追加在同一分发声明文件中。

| 模板 | 固定上游 | 参考文件 / 适配 |
| --- | --- | --- |
| `career-kendall-cn` | [LinuxBozo/jsonresume-theme-kendall](https://github.com/LinuxBozo/jsonresume-theme-kendall/tree/90438746fd64fc8184f439d5731a7d118660ab7a) | `style.css`，按 canonical 区域重写 |
| `career-stack-cn` | [phoinixi/jsonresume-theme-stackoverflow](https://github.com/phoinixi/jsonresume-theme-stackoverflow/tree/868d6db3fc322047c05e872f63a56fd026894f0a) | `styles/global.css`，按 canonical 区域重写 |
| `career-spartan-cn` | [phoinixi/jsonresume-theme-spartan](https://github.com/phoinixi/jsonresume-theme-spartan/tree/232edf8c5f5d0ad236b349315d45a80fa6bdd598) | `style.css`，按 canonical 区域重写 |
| `career-onepage-cn` | [ainsleyc/jsonresume-theme-onepage](https://github.com/ainsleyc/jsonresume-theme-onepage/tree/09f639745d868bcd58cfd26be1a0011bb206f092) | `style.css`，按 canonical 区域重写 |
| `career-classic-cn` | [rendercv/rendercv-typst](https://github.com/rendercv/rendercv-typst/tree/71e22e0692fc84518b2255974cf693b3334ab928) | `examples/classic.typ`，CSS 表达居中页眉与短线标题；沿用上文 MIT 声明 |

HireTechUpUp 参考库的金融、制造、医疗、教育、校招和实习分类用于行业覆盖盘点；本批次不复制其未明确授权的代码、图片或示例文字。

## Muse 选择集（0100）

Muse 的 79 套版式来自用户确认的本地原型选择集，按现有 canonical 正文、区域插槽和 CSS 重写。来源编号用于对应原型，不表示引入 Canva 的模板代码、授权资源或服务依赖。参考截图、旧原型脚本、真实照片、插画和媒体 Logo 不随产品分发；头像为空时只显示 CSS 剪影占位，用户上传的头像继续按原图片呈现。

通用 58 套冻结复用 Featured 产品经理虚构样本；行业 21 套使用建筑、金融、审计、法律、硬件、医学、教育、传媒、实验、演艺、咨询的 11 份虚构样本。交易、案例、论文、修订说明、职业路径和核心数据均转换为可编辑的普通章节、段落或列表；不增加公共正文类型。原型中的评分圆点、星级、甘特条、专用卡片和结构化表格没有对应的数据协议，不输出虚构评分或固定专业事实。三列等复杂结构适配为单栏或双栏；装饰保留颜色、标题线条、图框和 CSS 纹理近似，不保证逐像素还原。

所有模板默认关闭智能一页，长内容按 A4 自然分页。章节和身份只出现一次，模板的全语义 fallback 保留新增章节。行业装饰序号仅编号当前章节，不代表履历中的真实编号。

canva-02/03 的十套选择以 canva-08 精修版为依据。完整选择对应关系：

| 原型来源 | 名称 | 产品模板 key |
| --- | --- | --- |
| `canva-07#r52` | 蓝色工牌侧栏 | `muse-badge-cn` |
| `canva-07#r53` | HELLO 粉绿色块 | `muse-hello-cn` |
| `canva-07#r54` | 深蓝代码风 | `muse-code-cn` |
| `canva-07#r55` | 橙红底超大姓名 | `muse-vermilion-cn` |
| `canva-07#r56` | 黄色撕纸便签 + 线圈 | `muse-notebook-cn` |
| `canva-07#r57` | 蓝绿 L 形色块 | `muse-elbow-cn` |
| `canva-07#r58` | 米色半透明圆角卡片 | `muse-translucent-cn` |
| `canva-07#r59` | 深色方块页眉 + 灰侧栏 | `muse-charcoal-cn` |
| `canva-07#r60` | 绿色整页 + 横线分栏 | `muse-evergreen-cn` |
| `canva-07#r61` | 红色圆角框 + 对话气泡照片 | `muse-speech-cn` |
| `canva-07#r62` | 暖灰圆形照片 + 深色页脚 | `muse-taupe-cn` |
| `canva-07#r63` | 蓝框纸纹 | `muse-paperframe-cn` |
| `canva-07#r64` | 珊瑚粉圆角框 | `muse-coral-cn` |
| `canva-06#r33` | 细体大名 + 双线联系栏 | `muse-hairline-cn` |
| `canva-06#r34` | 灰侧栏 + 右上灰色竖条 | `muse-greyrail-cn` |
| `canva-06#r35` | 水彩浅蓝 + 深青右栏 | `muse-watercolor-cn` |
| `canva-06#r36` | 斜杠标题 + 空心圆时间轴 | `muse-slash-cn` |
| `canva-06#r37` | 鼠尾草底 + 双栏网格 | `muse-sagegrid-cn` |
| `canva-06#r38` | 雾青侧栏 + 圆形图标标题 | `muse-mist-cn` |
| `canva-06#r39` | 蓝天弧线 + 红色标签圆角框 | `muse-sky-cn` |
| `canva-06#r40` | 拱形照片 + 圆点评级 | `muse-archphoto-cn` |
| `canva-06#r41` | 海军蓝侧栏 + 错位投影标签 | `muse-shadowtag-cn` |
| `canva-06#r42` | 红色页眉 + 双栏 | `muse-redbanner-cn` |
| `canva-06#r43` | 拍立得照片 + 细体衬线名 | `muse-polaroid-cn` |
| `canva-06#r44` | 深蓝页眉 + 明黄侧栏 | `muse-yellowrail-cn` |
| `canva-06#r45` | 砖红撞色 + 倾斜卡片 | `muse-tilted-cn` |
| `canva-06#r46` | 酒红纹理 + 等宽字体 | `muse-burgundy-cn` |
| `canva-06#r47` | 紫色渐变 + 分栏分隔线 | `muse-violet-cn` |
| `canva-06#r48` | 纯黑页面 + 窄体大名 | `muse-noir-cn` |
| `canva-06#r49` | 线圈笔记本 + 拍立得 | `muse-spiral-cn` |
| `canva-06#r50` | 窄体巨名 + 十字格线 | `muse-crossgrid-cn` |
| `canva-06#r51` | 梦幻光晕 + 右对齐经历框 | `muse-halo-cn` |
| `canva-05#r19` | 深蓝页眉 + 图标时间轴 | `muse-navymast-cn` |
| `canva-05#r21` | 浅灰格线版式 | `muse-formgrid-cn` |
| `canva-05#r23` | 浅蓝页眉 + 蓝色侧栏 | `muse-bluewash-cn` |
| `canva-05#r24` | 灰侧栏 + 黑色姓名条 | `muse-nameband-cn` |
| `canva-05#r26` | 蓝色斜角侧栏 | `muse-diagonal-cn` |
| `canva-05#r28` | 米白纸面 + 圆角侧栏 | `muse-roundrail-cn` |
| `canva-05#r31` | 粗细姓名 + 双时间轴 | `muse-twintimeline-cn` |
| `canva-05#r30` | 深海军蓝侧栏 | `muse-deeprail-cn` |
| `canva-05#r32` | 青色错位照片框 | `muse-offsetphoto-cn` |
| `canva-04#1` | 灰色侧栏 + 折角标题条 | `muse-folded-cn` |
| `canva-01#1` | 灰阶斜切页眉 | `muse-slanted-cn` |
| `prototype#index` | 目录索引 | `muse-contents-cn` |
| `prototype#numeral` | 大号数字锚点 | `muse-numerals-cn` |
| `prototype#spine` | 竖排书脊 | `muse-bookspine-cn` |
| `prototype#annals` | 年谱 | `muse-chronicle-cn` |
| `prototype#tabs` | 侧边页签 | `muse-tabs-cn` |
| `prototype#arch` | 建筑 · 施工图图框 | `muse-blueprint-cn` |
| `prototype#arch2` | 建筑 · 竖向图签 | `muse-titleblock-cn` |
| `prototype#arch3` | 建筑 · 图纸目录 | `muse-drawinglist-cn` |
| `prototype#finance` | 金融 · 交易列表 | `muse-dealbook-cn` |
| `prototype#fin3` | 金融 · 研报首页 | `muse-researchnote-cn` |
| `prototype#audit` | 审计 · 底稿索引 | `muse-workpaper-cn` |
| `prototype#audit2` | 审计 · 明细账 | `muse-ledger-cn` |
| `prototype#law3` | 法律 · 备忘录 | `muse-memorandum-cn` |
| `prototype#law2` | 法律 · 案例摘要 | `muse-casebrief-cn` |
| `prototype#spec` | 硬件 · 规格书 | `muse-datasheet-cn` |
| `prototype#med2` | 医学 · 学术型 | `muse-medicalpapers-cn` |
| `prototype#med3` | 医学 · 职业路径 | `muse-clinicalpath-cn` |
| `prototype#edu2` | 教育 · 页边批注 | `muse-annotations-cn` |
| `prototype#news` | 传媒 · 新闻稿 | `muse-press-cn` |
| `prototype#edu3` | 教育 · 教学·教研·育人 | `muse-teaching-cn` |
| `prototype#news3` | 传媒 · 节目串联单 | `muse-rundown-cn` |
| `prototype#spec3` | 硬件 · 修订记录 | `muse-revisions-cn` |
| `prototype#lab` | 实验 · 实验记录本 | `muse-labbook-cn` |
| `prototype#lab3` | 实验 · 元素卡片 | `muse-element-cn` |
| `prototype#prog3` | 演艺 · 场刊 | `muse-playbill-cn` |
| `prototype#cons` | 咨询 · 结论先行 | `muse-consulting-cn` |
| `canva-03#t94` | 姓名职位等大三区 | `muse-triptych-cn` |
| `canva-03#t84` | 暖红编辑单栏 | `muse-rededitorial-cn` |
| `canva-03#t116` | 黑白五五分 | `muse-halfblack-cn` |
| `canva-03#t98` | 黑色页眉 + 手写体职位 | `muse-blackmast-cn` |
| `canva-03#t113` | 颗粒黑侧栏 + 灰色公司条 | `muse-grainrail-cn` |
| `canva-03#t99` | 米色侧栏 + 签名装饰 | `muse-signaturerail-cn` |
| `canva-03#t114` | 问候语姓名 + 圆角衬底 | `muse-greeting-cn` |
| `canva-02#a` | 灰条标题 + 方形照片 | `muse-greyleaders-cn` |
| `canva-02#d` | 圆形头像页眉 + 底部三栏 | `muse-ruled-cn` |
| `canva-02#e` | 姓名左上 + 职位右对齐 | `muse-righttitle-cn` |
