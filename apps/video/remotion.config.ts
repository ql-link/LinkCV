import path from "node:path";
import { Config } from "@remotion/cli/config";

const videoRoot = process.cwd();

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);

Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    // 只引用 Web 的品牌与模型图标资源，界面全部在本应用内绘制。
    alias: { ...config.resolve?.alias, "@web-assets": path.resolve(videoRoot, "../web/src/assets") },
  },
}));
