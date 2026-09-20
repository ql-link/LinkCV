# 简历模板第三方来源

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
