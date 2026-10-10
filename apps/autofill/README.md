# LinkAutofill

网申表单自动填写浏览器插件（Chrome / Edge，Manifest V3）。用本机保存的 JSON 简历，在招聘网站的网申页面上一键填写，只填不提交。

本应用位于 LinkResume Monorepo 的 `apps/autofill`，与岗位采集插件 `apps/extension` 同级，各自安装和侧载。它直接使用扩展本机的 JSON 简历与 Jev 配置，暂不连接 LinkResume 工作区或后端。架构边界见 [项目文档](../../docs/internals/autofill.md)。

## 工作方式

点击扩展图标打开侧边栏，在网申页面点“开始填写”：

1. **授权**：首次在某个网站使用时，按站点申请访问权限。
2. **补齐经历条目**：简历里的经历段数多于页面输入块时，自动点击对应模块的“添加”按钮（仅在识别出的站点上执行，带“附件/上传”字样的按钮一律不点）。
3. **扫描字段**：找出可填写的控件，整理标签、所属模块、第几段经历、控件类型和下拉选项。
4. **Jev 判断**：每个字段向 Jev 发一个选择题，从字段目录中选出对应的简历字段或“无对应”。只发送页面字段的标签与结构，不发送简历内容。
5. **出计划**：规则拦截（分机、配偶、高中等不自动填写）→ 起止时间按先后纠正 → 判断第几段经历 → 从简历取值并按页面格式转换。
6. **写入**：按组件库适配器写入（Ant Design、Element、iView、atsx、美团 mtd、北森、Moka、飞书、智联等），最后用文本输入兜底。
7. **标记**：页面上蓝框为已填写、橙框为待处理；侧边栏列出待处理字段，可点击定位、复制建议值。

## 目录

```text
entrypoints/
  background.ts           点击图标打开侧边栏
  autofill.content.ts     页面内脚本（按需注入）：补齐经历、扫描、写入、标记
  sidepanel/              侧边栏：开始填写、进度、结果列表
  options/                设置页：Jev 接口、填写偏好、JSON 简历导入导出
src/
  profile/                字段目录 keys.ts、JSON 简历校验与取值、示例简历
  scan/                   字段扫描、自动补齐经历条目
  decide/                 Jev 客户端、填写计划（规则、取值、格式化）
  writer/                 写入层（JS）：组件库适配、日历导航、本地选项匹配
  run.ts                  一次完整填写的调度
eval/                     决策层评测脚本（测试数据不入库）
docs/profile.md           JSON 简历字段说明
```

## 开发

```bash
# 在 LinkResume 仓库根目录运行
npm ci --prefix apps/autofill   # npm run sync / setup 也会安装本应用
npm run dev:autofill            # WXT 开发模式
npm run typecheck:autofill      # WXT 类型生成与 TypeScript 检查
npm run build:autofill          # 产物在 apps/autofill/.output/chrome-mv3
npm run zip:autofill            # 独立 ZIP，输出在 apps/autofill/.output
```

Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 中开启开发者模式，选择“加载已解压的扩展程序”并加载 `apps/autofill/.output/chrome-mv3`。在 `apps/autofill` 目录内仍可使用 `npm run dev`、`npm run typecheck`、`npm run build` 和 `npm run zip`。

首次使用：

1. 打开设置页，填写 Jev 的接口地址、模型和 API Key，点“测试连接”。默认使用 aihubmix：`https://aihubmix.com/v1/systemone`，模型 `jev-1.13`。
2. 下载示例简历，按自己的信息修改后导入。字段说明见 [docs/profile.md](docs/profile.md)。
3. 打开网申页面，点击扩展图标，在侧边栏点“开始填写”。

## 当前限制

- 只处理页面顶层文档，不进入 iframe（Workday、SuccessFactors 等部分页面的表单在 iframe 中）。
- 写入层尚未在真实网申页面系统验证，交互细节可能需要按站点调整。
- “自动补齐经历条目”只在内置站点配置或识别出北森、Moka、atsx 的页面上执行。
- aihubmix 的 Jev 渠道不在其公开模型列表中，接口可能变化；可在设置页改用 OpenRouter 等兼容 systemone 格式的接口。
- Jev 的概率偏自信，不能单独作为“是否填写”的依据；所有结果都需要人工核对后再提交。

决策层的评测方法与结果见 [eval/README.md](eval/README.md)。
