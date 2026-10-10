# 浏览器网申填写插件

## 职责与边界

`apps/autofill` 是 LinkAutofill 网申填写插件，使用 WXT、React 19、TypeScript 和 Manifest V3，面向 Chrome / Edge。它与岗位采集插件 `apps/extension` 同级，拥有独立依赖锁文件、扩展身份、构建目录和浏览器存储。

用户在设置页配置 Jev 接口、模型、API Key，并导入本机 JSON 简历；在招聘网站的网申页面点击“开始填写”，插件按站点申请访问权限、补齐经历条目、扫描字段、生成填写计划并写入控件。它不自动提交表单。当前没有 LinkResume 登录或简历同步能力，也不调用 FastAPI，不依赖 Web、MySQL 或 MinIO。

## 入口与填写流程

| 位置 | 职责 |
| --- | --- |
| `apps/autofill/wxt.config.ts` | MV3 Manifest、默认 Jev 接口权限、可选网页访问权限 |
| `entrypoints/background.ts` | 点击扩展图标打开侧边栏 |
| `entrypoints/sidepanel/` | 发起填写、进度、结果与待处理字段定位 |
| `entrypoints/options/` | 接口设置、连接测试、JSON 简历导入导出与偏好 |
| `entrypoints/autofill.content.ts` | 用户点击时按需注入，处理经历补齐、扫描、写入和标记 |
| `src/profile/` | 简历字段目录、校验、数组经历取值及虚构示例 |
| `src/scan/` | 页面字段上下文抽取及已识别站点的经历补齐 |
| `src/decide/` | Jev 选择题客户端、规则与填写计划 |
| `src/writer/` | 组件库和站点适配、本地选项匹配、日期与级联写入 |
| `src/run.ts` | 一次填写的阶段调度与错误反馈 |
| `eval/` | 独立字段决策评测工具，不纳入默认安装与 CI |

除第一行外，表中路径相对于 `apps/autofill`。JSON 简历字段见 [字段说明](../../apps/autofill/docs/profile.md)，组件适配与写入边界见 [写入层说明](../../apps/autofill/src/writer/README.md)。

填写计划按页面模块和经历序号取值，纠正同标签日期框的起止顺序，并按提示格式转换日期。分机、配偶、高中等规则命中的字段不自动填写；低于概率阈值或简历缺值的字段留给用户处理，默认不覆盖已有内容。经历补齐只在识别出的站点运行，带附件或上传字样的添加按钮会跳过。页面蓝框表示已填写，橙框表示待处理。

## 数据、网络与权限

设置和 JSON 简历保存在该扩展的 `browser.storage.local` 中。Jev 请求只包含页面字段的标签、模块、控件类型、输入提示、少量选项和字段目录，不包含简历值。写入层在本地匹配选项，不调用模型或 LinkResume API。

Manifest 使用 `storage`、`scripting`、`activeTab` 和 `sidePanel`；默认声明 aihubmix 与 OpenRouter 的访问权限。网页以及自定义接口由用户点击时按 Origin 申请可选权限，内容脚本不随任意网页自动注入。默认 Jev 地址为 `https://aihubmix.com/v1/systemone`，模型为 `jev-1.13`，可以在设置页替换；API Key 默认为空。

## 开发与验证边界

根级命令、安装和侧载说明见 [本地开发](../ops/development.md#常用命令) 与 [插件 README](../../apps/autofill/README.md)。`apps/autofill/package.json` 和对应 lockfile 独立管理版本及依赖。根级 `sync` 安装运行依赖，`typecheck`、`build` 包含本应用；GitHub Actions 的 `autofill` job 按目录变化执行安装、类型检查和构建。

插件只扫描页面顶层文档，不进入 iframe。组件交互尚未在真实招聘页面系统验证，写入后也没有读回校验；用户需要核对后自行提交。评测仅覆盖仿真页面的字段决策，方法、外部数据来源和样本限制见 [评测说明](../../apps/autofill/eval/README.md)，不能用来证明真实页面控件填写成功。
