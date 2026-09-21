# 简历模板第三方来源

## 用户选定商务与活力版式（0079）

以用户提供的两张独立截图为视觉参考，分别实现 `featured-classic-business-cn`（经典商务）与 `featured-vitality-cn`（活力）。前者提炼浅蓝居中肖像页眉、细蓝章节线与紧凑单栏正文；后者提炼暖橙身份卡、白色经历卡片与右侧技能栏。两套版式复用项目内 `0077` 已验证的虚构产品经理样本，不复制截图中的真人照片、VIP 标识、联系方式、文字、源码或装饰素材，头像继续使用项目内置安全占位。

## 用户选定卡片版式（0078）

以用户提供的同页对比截图为视觉参考，独立实现 `featured-card-dashed-cn`（卡片虚线）与 `featured-card-rail-cn`（卡片分栏）。两套版式复用项目内 `0077` 已验证的虚构产品经理样本，只参考圆角蓝色身份卡、虚线章节和左侧章节索引的视觉关系；不复制截图中的照片、文字、源码或其他素材，头像继续使用项目内置安全占位。

## 用户选定蓝色版式（0077）

以用户提供的九宫格截图为视觉参考，独立实现七套 `featured-*`：40 → 蓝幕校招、60 → 浅蓝社招、70 → 清蓝实习、120 → 钴蓝右栏、160 → 蓝色拼版、90 → 蓝线财务、130 → 蓝带人事。编号是 HireTechUpUp 预览文件的编号，不是独立设计数的证明。

110 新媒体运营、240 程序员分别已有 `studio-layered-capsule` 与 `studio-node-timeline`，未重复新增。其余版式即使配色接近旧主题，仍按截图的身份位置、主辅栏、标题结构独立实现。参考库未发现明确许可证，因此不复制源码、照片或示例文字；沿用本项目内置头像与虚构示例，所有正文可编辑，不把截图作为模板背景。

迁移 `0070` 的六套 `open-*` 模板按 MIT 许可证适配，完整版权与许可声明随 Web 发布于 `public/third-party/template-notices.txt`。分发代码或静态制品时需保留此文件；许可证并不等于对上游名称、商标或第三方素材的独立授权。

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

## 跨行业、校招与实习批次（0076）

以下五套均采用 MIT 许可排版，使用项目内独立编写的虚构示例，不引入上游履历、照片、字体、图标或运行时依赖。完整许可声明追加在同一分发声明文件中。

| 模板 | 固定上游 | 参考文件 / 适配 |
| --- | --- | --- |
| `career-kendall-cn` | [LinuxBozo/jsonresume-theme-kendall](https://github.com/LinuxBozo/jsonresume-theme-kendall/tree/90438746fd64fc8184f439d5731a7d118660ab7a) | `style.css`，按 canonical 区域重写 |
| `career-stack-cn` | [phoinixi/jsonresume-theme-stackoverflow](https://github.com/phoinixi/jsonresume-theme-stackoverflow/tree/868d6db3fc322047c05e872f63a56fd026894f0a) | `styles/global.css`，按 canonical 区域重写 |
| `career-spartan-cn` | [phoinixi/jsonresume-theme-spartan](https://github.com/phoinixi/jsonresume-theme-spartan/tree/232edf8c5f5d0ad236b349315d45a80fa6bdd598) | `style.css`，按 canonical 区域重写 |
| `career-onepage-cn` | [ainsleyc/jsonresume-theme-onepage](https://github.com/ainsleyc/jsonresume-theme-onepage/tree/09f639745d868bcd58cfd26be1a0011bb206f092) | `style.css`，按 canonical 区域重写 |
| `career-classic-cn` | [rendercv/rendercv-typst](https://github.com/rendercv/rendercv-typst/tree/71e22e0692fc84518b2255974cf693b3334ab928) | `examples/classic.typ`，CSS 表达居中页眉与短线标题；沿用上文 MIT 声明 |

HireTechUpUp 参考库的金融、制造、医疗、教育、校招和实习分类用于行业覆盖盘点；本批次不复制其未明确授权的代码、图片或示例文字。
