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

- 命令:`npm run build:desktop`(编译主进程并由 electron-builder 产出 dmg)。
- 产物位置:`apps/desktop/release/`;记录实际文件名与大小。
- 验证:双击 dmg 安装并启动,确认连接默认生产源(`https://linkresume.cn`)、微信扫码登录可用;需要连 Dev 环境时以 `LINKCV_DESKTOP_ORIGIN` 覆盖后重新打包。
- 如实告知:该包未签名,仅用于本机或团队内验证。

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
