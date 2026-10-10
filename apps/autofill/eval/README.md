# 决策层评测

在同一批带标准答案的仿真网申页上，比较本地向量模型与 Jev 的字段判断效果。

## 数据

测试页与标准答案来自 [bzhengak/nw-autofill](https://github.com/bzhengak/nw-autofill)（GPL-3.0），按真实站点的导出结构复刻（Moka、北森途普、Workday、SuccessFactors、Ant Design、Element 等）。数据只在本地下载，不提交进本仓库。

## 运行

```bash
cd eval
npm ci
npm run fetch-data      # 下载测试页到 .data/
npm run extract         # 抽取字段上下文 → results/fields.json
npm run embedding       # 本地向量模型，默认 bge-small-zh int8，首次运行会下载约 24MB 模型
AHM_KEY=sk-... npm run jev   # Jev：J1 全量 key 直选；J2 向量前 5 名 + Jev
```

`embedding.mjs` 可用环境变量切换模型：`MODEL`、`POOL`（cls/mean）、`FIELD_PREFIX`、`KEY_PREFIX`。`jev.mjs` 可用 `JEV_ENDPOINT`、`JEV_MODEL` 切换接口。

## 2026-10-10 结果

| 方案 | 中文第一名正确 | 中文前三命中 | 英文第一名正确 | 单字段耗时 |
|---|---|---|---|---|
| bge-small-zh（24MB） | 78% | 93% | 7% | 10～15ms（Node CPU） |
| bge-base-zh（102MB，检索前缀） | 82% | 92% | 56% | 60～260ms |
| multilingual-e5-small（118MB） | 79% | 93% | 58% | 约 18ms |
| Jev 从全部 key 直选 | 95.6% | 96.7% | 100% | 中位 266ms |
| 向量前 5 名 + Jev | 91.2% | 94.5% | 25.6% | 中位 253ms |

结论：插件决策层直接用 Jev 从全部 key 中选择。样本只有中文 91 个、英文 43 个字段，均为仿真页面；剩余错误主要来自页面缺少模块标题、同名的起止时间框等结构问题，由规则层处理。
