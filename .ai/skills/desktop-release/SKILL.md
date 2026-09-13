---
name: desktop-release
description: 引导 LinkCV macOS 桌面客户端的开发启动、验证打包与正式发布。使用者以自然语言提出"启动桌面开发""打一个客户端验证包""发布客户端正式版本"等意图时进入本技能；负责环境自检、按模式执行真实命令并汇报产物与验证状态，签名公证等前置条件缺失时明确说明并停止，不猜测执行，不代替 branch-pr-workflow 完成提交与 PR。
---

# Skill: desktop-release

## 1. 职责

引导 LinkCV macOS 桌面客户端(`apps/desktop`)的开发启动、验证打包与正式发布。使用者以自然语言提出意图,例如"启动桌面开发""打一个客户端验证包""发布客户端正式版本";本技能负责环境自检、选择正确模式、执行真实命令并如实汇报产物与验证状态。

本技能不修改业务代码,不代替 `branch-pr-workflow` 创建提交、推送或 PR;不自动安装 Apple 证书,不猜测执行未具备前置条件的发布动作。

## 2. 前置事实

- 桌面壳是 Electron 工程,业务全部来自加载的 LinkCV Web 端;壳与后端零耦合,业务迭代不需要改壳或重新打包。
- 开发模式加载本地 Vite 开发服务器(默认 `http://127.0.0.1:5173`),享受网页端热更新;打包模式默认加载 `https://linkresume.cn`,可用 `LINKCV_DESKTOP_ORIGIN` 覆盖(如指向 Dev 环境)。
- 两个配置键均为非敏感地址;非法值由壳回落默认并在主进程日志告警(见 `apps/desktop/src/config.ts`)。
- Mac 开发无需额外安装大件:Electron 二进制随 `npm run sync` 下载(已配 npmmirror 镜像);签名与公证仅在正式对外发布时需要。
- 当前打包产物为**未签名** dmg:在本机可直接运行,分发到他人电脑会被 Gatekeeper 拦截,需右键打开或先补签名公证。

## 3. 环境自检(所有模式先执行)

1. `node --version` 为 22+;`git branch --show-current` 确认当前分支。
2. 确认 `apps/desktop/node_modules` 存在;缺失时提示先运行 `npm run sync`。
3. 按模式补充检查:
   - 开发启动:确认开发者已按中间件目标选择 `npm run dev:local` 或 `npm run dev:development` 并仍在运行(以启动器输出为准);桌面脚本自身也会等待 Vite 端口就绪,超时会明确报错退出。
   - 打包与发布:确认 `apps/desktop/dist/main.cjs` 可通过 `npm --prefix apps/desktop run build:main` 重新生成,`npm --prefix apps/desktop run typecheck` 与 `npm run test:desktop` 通过。
4. 环境不满足时报告缺口并停止,不代替用户选择其他模式。

## 4. 模式一:启动桌面开发

- 命令:`npm run dev:desktop`(内部等待 Vite 就绪后以 dev 模式启动 Electron)。
- 验证:窗口打开并加载本地页面;登录、简历、智能助手等行为与浏览器一致;修改 `apps/web` 代码窗口即时热更新。
- 常见问题:等待超时说明开发服务未启动;窗口展示"无法连接 LinkCV"说明服务中断,恢复后可点击重试。

## 5. 模式二:打验证包

客户端分两种打包目标,按使用者意图直接映射:

| 使用者意图 | 命令 | 目标环境 | 登录方式 |
| --- | --- | --- | --- |
| "打一个测试包""开发版打包""打一个连 Dev 的包" | `npm run build:desktop:dev` | Dev `http://100.86.10.52:18002` | 邮箱密码 + 微信扫码 |
| "打一个正式包""生产包""对外分发的包" | `npm run build:desktop` | 生产 `https://linkresume.cn` | 仅微信扫码 |

映射原则:提到"测试/开发版/Dev/联调"一律走开发版包;提到"正式/生产/对外/发布给用户"一律走正式包;意图含糊时先与使用者确认目标环境再执行,不猜。本地验证不需要打包——`npm run dev:desktop` 即本地版(密码登录)。

补充规则:

- 登录方式由目标后端的 `/api/auth/capabilities` 决定(`APP_ENV` 为 local/development 时提供邮箱密码登录,production 仅微信扫码),壳只负责指向正确环境。
- 开发版产物使用独立应用名 LinkCV-Dev 与 appId `cn.linkresume.desktop.dev`,不与正式版互相覆盖安装。
- 两种打包均可用 `LINKCV_DESKTOP_ORIGIN` 显式覆盖目标源(production 包拒绝非回环 http,连内网 Dev 必须使用开发版目标);`scripts/write-build-env.mjs` 在构建期把目标写入产物并在非法输入时硬失败。
- 产物位置:`apps/desktop/release/`;记录实际文件名与大小。
- **产物管理规范**:`release/`、`dist/` 与 `node_modules/` 均被 Git 忽略,任何 dmg、blockmap 或构建中间产物不得提交;需要交付给使用者时把 dmg 移动或复制到约定位置(如对方下载文件夹),随后清空 `release/`,不留待提交产物。
- **图标规范**:应用图标使用 `apps/desktop/build/icon.png`(复制自 `apps/web/src/assets/linkresume-mark.png`,1080×1080 带透明);品牌图更新后必须重新复制该副本再打包,不在线引用 Web 资产;开发版与正式版共用同一图标,以应用名区分。
- 验证:双击 dmg 安装并启动——开发版确认连 Dev 环境且登录页出现邮箱密码表单;正式版确认连生产源、微信扫码登录可用。
- 如实告知:两种包均未签名,仅用于本机或团队内验证。

## 6. 模式三:正式发布(当前未启用)

请求正式发布时,先核对前置条件,任一缺失即停止并说明,不执行猜测动作:

1. Apple Developer 账号与 `Developer ID Application` 证书已导入本机钥匙串;
2. 公证凭据(App-specific password 或 App Store Connect API Key)可用;
3. `apps/desktop/electron-builder.yml` 已配置签名身份与公证参数(当前为 `identity: null`);
4. 分发渠道(官网下载地址或更新源)已确定。

全部就绪后,签名公证配置、版本管理与分发流程属于独立交付,先与用户确认范围再实施;本次仓库不包含该配置。

## 7. 汇报要求

- 每次执行后汇报:实际命令、退出结果、产物路径或窗口状态、未执行项与原因。
- 打包成功不等于发布完成;未经用户确认,不把验证包说成正式版。
- 环境阻塞(如未启动开发服务、缺少证书)如实说明,不用历史成功结果代替当前验证。
