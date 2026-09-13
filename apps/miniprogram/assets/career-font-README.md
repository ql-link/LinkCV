# 求职页面字体

`career-font.wxss` 内嵌 Figma 使用的 LXGW WenKai TC Regular / Bold 的 WOFF2 字符子集，CSS 家族名为 `LinkCV Career UI`。字体来源为 Google Fonts 的 `ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf` 和 `LXGWWenKaiTC-Bold.ttf`：
https://github.com/google/fonts/tree/main/ofl/lxgwwenkaitc

许可证保留在 `career-font-OFL.txt`。子集保留原版权字段，修改内部家族名以区分原字体。使用 fontTools 的 subset 与 Brotli 转换，覆盖小程序源码内的文字及 Figma 示例公司名；动态内容中的其他字形回退到系统字体。字体以内嵌数据提供，不依赖运行时字体 CDN。此资源由求职页面、添加安排组件和三个页面共用的底部导航选择使用，其他页面正文继续使用原字体。
