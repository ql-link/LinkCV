# 写入层

网申表单的“值写入层”：给定输入框和要填的值，负责展开下拉、翻日历、选级联，并把值写进去。

选项通过 `match.js` 在本地匹配，整个模块不发任何网络请求。

字段识别和取值在 `src/scan`、`src/decide` 中完成，本模块只负责把给定的值写进给定的控件。

## 用法

插件内容脚本 `entrypoints/autofill.content.ts` 的用法：

```js
import { fillAll } from '../src/writer/fill.js';

const results = await fillAll(
  [
    { element: nameInput, value: '张三', label: '姓名' },
    { element: schoolInput, value: '示例大学', label: '学校名称' },
    { element: degreeSelect, value: '本科', label: '学历' },
    // 日期区间：开始、结束两个输入框相邻传入，先开始后结束
    { element: startInput, value: '2021-09-01', label: '开始时间' },
    { element: endInput, value: '2025-06-30', label: '结束时间' },
    // 级联：用 / 分隔各级
    { element: cityInput, value: '广东省/深圳市', label: '期望城市' },
  ],
  { onProgress: (done, total) => console.log(done, total) },
);
// results[i]：filled 已选中 / typed 未识别组件，按文本写入，需复核 / failed / skipped
```

- 日期统一写成 `YYYY-MM-DD` 或 `YYYY-MM`。
- `label` 会影响行为：含“学校/专业”的下拉按远程搜索处理，北森的“学校名称”会等联想结果。
- 也可以用 `fillField(el, value, { label })` 单独填一个字段。

## 结构

| 文件 | 内容 |
|---|---|
| `src/dom.js` | 可见性判断、真实点击（pointer + mouse 事件序列）、滚动、轮询、就近浮层 |
| `src/input.js` | 原生 setter 写值、整段替换、逐字符模拟、按键 |
| `src/match.js` | 本地选项匹配：精确、归一化、同义词组、包含、二元组相似度 |
| `src/calendar.js` | 通用日历导航（翻年 → 选月 → 选日）和各组件库预设 |
| `src/options.js` | 下拉选项收集与点选、树形下拉、多列级联 |
| `src/sites.js` | 27 个站点配置和北森、Moka、atsx 三套招聘系统的识别 |
| `src/adapters/` | antd、Element、atsx、iView、美团 mtd、kuma、北森、Moka、飞书、智联 |
| `src/fill.js` | 调度顺序与 `fillAll` |

调度顺序：antd → atsx → Element → iView → mtd/kuma → 原生日期 → 站点专用（北森 / Moka / 飞书 / 智联）→ 通用下拉 → 文本兜底。每个字段填完点一次空白处，收起残留浮层。

## 行为与边界

- `match.js` 在本地匹配选项；匹配不到返回失败。
- 级联和树形下拉：把值按 `/`、`-`、空格拆成路径逐级匹配。
- iView 级联通过 `menuItemSelector` 定位选项。
- 只有一项且文本为占位提示时视为空列表，“无锡”等有效选项正常参与匹配。
- 北森普通下拉匹配不到时不选择候选项，并按实际操作结果返回状态。
- atsx 和 iView 下拉在没有站点配置时使用默认浮层选择器。
- antd 普通输入框会先尝试“点击弹出对话框选择”，没有对话框再直接输入，每个字段多约 100ms。
- atsx 年月区间控件当前把同一个值同时用作开始和结束。

## 验证状态

- 已做：所有文件 `node --check` 语法检查；`pickOption`、`splitPath` 的 Node 冒烟测试。
- 未做：没有在任何真实网申页面或浏览器里运行过，建议先在 2～3 个常见站点逐个字段验证组件交互。
- 当前没有“填完读回校验”这一步，写入后控件是否真的显示目标值需要自己确认。
