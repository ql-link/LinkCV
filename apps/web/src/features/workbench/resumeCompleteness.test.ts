import { describe, expect, it } from "vitest";
import { defaultResumeMarkdown } from "../../parser/defaultResume";
import { evaluateResumeCompleteness, resumeCompletenessTone } from "./resumeCompleteness";

const completeResume = `# 李明

前端开发工程师，3 年 React 与 TypeScript 项目经验

电话：13912345678 ｜ 邮箱：liming@linkcv.test

## 工作经历

未来科技有限公司 · 前端开发工程师

2023.03 - 至今

1. 重构核心编辑器，首屏加载时间降低 35%。
2. 建立组件测试体系，关键路径覆盖率提升至 85%。
3. 推动设计系统落地，重复样式代码减少 40%。

## 教育经历

南山大学 · 软件工程

2018.09 - 2022.06

## 专业技能

1. React 与 TypeScript
2. 前端工程化与性能优化
3. Vitest 与组件测试`;

describe("evaluateResumeCompleteness", () => {
  it("为结构完整且没有示例占位符的简历计算 100 分", () => {
    const result = evaluateResumeCompleteness(completeResume);

    expect(result).toMatchObject({ score: 100, rawScore: 100, level: "完整", maxPoints: 100 });
    expect(result.scoreCaps).toEqual([]);
    expect(result.checks.every((item) => item.status === "passed")).toBe(true);
  });

  it("保留部分得分并返回可执行建议", () => {
    const result = evaluateResumeCompleteness(`# 王小明

产品经理

邮箱：wang@example.com

## 项目经历

个人作品

- 完成需求分析

## 教育经历

2020 - 2024`);

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(70);
    expect(result.checks.find((item) => item.id === "positioning")).toMatchObject({
      status: "partial",
      earnedPoints: 5,
    });
    expect(result.checks.find((item) => item.id === "email")).toMatchObject({
      status: "failed",
      earnedPoints: 0,
    });
    expect(result.checks.find((item) => item.id === "experience-details")?.recommendation).toContain("3 条");
  });

  it("系统默认简历即使规则原始分较高也封顶为 20 分", () => {
    const result = evaluateResumeCompleteness(defaultResumeMarkdown);

    expect(result.rawScore).toBeGreaterThan(60);
    expect(result.score).toBe(20);
    expect(result.scoreCaps.map((cap) => cap.id)).toEqual(["sample-identity", "sample-content"]);
    expect(result.checks.find((item) => item.id === "name")).toMatchObject({ status: "failed" });
  });

  it("替换身份后若正文仍有示例组织则封顶为 60 分", () => {
    const result = evaluateResumeCompleteness(
      defaultResumeMarkdown
        .replace("# 张三", "# 李明")
        .replace("13800000000", "13912345678")
        .replace("zhangsan@example.com", "liming@linkcv.test"),
    );

    expect(result.rawScore).toBeGreaterThan(60);
    expect(result.score).toBe(60);
    expect(result.scoreCaps.map((cap) => cap.id)).toEqual(["sample-content"]);
  });

  it("优先把教育经历识别为教育章节而不是普通经历", () => {
    const result = evaluateResumeCompleteness(`# 李明

电话：13912345678 ｜ 邮箱：liming@linkcv.test

## 教育经历

南山大学 · 软件工程

2018 - 2022

## 专业技能

- React
- TypeScript
- Vitest`);

    expect(result.checks.find((item) => item.id === "education-section")).toMatchObject({ status: "passed" });
    expect(result.checks.find((item) => item.id === "experience-section")).toMatchObject({ status: "failed" });
  });

  it("不把左右分栏指令误认为教育或经历内容", () => {
    const result = evaluateResumeCompleteness(`# 李明

## 教育经历

::: right
2020 - 2024
:::`);

    expect(result.checks.find((item) => item.id === "education-basics")).toMatchObject({
      status: "partial",
      earnedPoints: 3,
    });
  });

  it("识别与日期写在同一行的学校或单位信息", () => {
    const result = evaluateResumeCompleteness(`# 李明

## 工作经历

未来科技有限公司 · 前端工程师 ｜ 2022.03 - 至今

- 完成核心模块开发

## 教育经历

南山大学 · 软件工程 ｜ 2018.09 - 2022.06`);

    expect(result.checks.find((item) => item.id === "experience-basics")).toMatchObject({ status: "passed" });
    expect(result.checks.find((item) => item.id === "education-basics")).toMatchObject({ status: "passed" });
  });

  it("格式化后的系统示例手机号仍按未填写处理", () => {
    const result = evaluateResumeCompleteness(`# 李明

电话：138-0000-0000`);

    expect(result.checks.find((item) => item.id === "phone")).toMatchObject({
      status: "failed",
      earnedPoints: 0,
    });
  });

  it("技能章节必须包含具体内容，只有标题或占位文字不得分", () => {
    const titleOnly = evaluateResumeCompleteness(`# 李明\n\n## 专业技能`);
    const placeholder = evaluateResumeCompleteness(`# 李明\n\n## 专业技能\n\n待补充`);

    expect(titleOnly.checks.find((item) => item.id === "skills-section")).toMatchObject({ status: "failed", earnedPoints: 0 });
    expect(placeholder.checks.find((item) => item.id === "skills-section")).toMatchObject({ status: "failed", earnedPoints: 0 });
  });

  it("技能条目同时评价数量与具体程度", () => {
    const vague = evaluateResumeCompleteness(`# 李明\n\n## 核心能力\n\n- 沟通能力强\n- 学习能力强\n- 责任心强`);
    const specific = evaluateResumeCompleteness(`# 李明\n\n## 技术能力\n\n- 熟练使用 React 与 TypeScript 开发业务系统\n- 使用 Vitest 搭建组件测试并维护关键路径\n- 掌握 Vite 工程化配置与性能优化`);

    expect(vague.checks.find((item) => item.id === "skills-section")).toMatchObject({ status: "passed", earnedPoints: 7 });
    expect(vague.checks.find((item) => item.id === "skills-entries")).toMatchObject({ status: "partial", earnedPoints: 4 });
    expect(specific.checks.find((item) => item.id === "skills-entries")).toMatchObject({ status: "passed", earnedPoints: 8 });
  });

  it("不从教育和项目正文借用技能得分", () => {
    const result = evaluateResumeCompleteness(`# 小湛

## 教育经历

北辰科技大学 · 信息工程学院 · 软件工程 ｜ 2021.09 - 2025.06

1. Go：能够使用 Gin、gRPC 与 context 构建服务，重视错误处理、接口边界和可测试性。

## 项目经历

TraceHarbor

技术环境：Go、TypeScript、ClickHouse、OpenTelemetry、Prometheus

1. 实现 OpenTelemetry 数据接收与字段归一化。
2. 设计 ClickHouse 分区与 TTL 策略。
3. 开发历史流量回放器。`);

    expect(result.checks.find((item) => item.id === "skills-section")).toMatchObject({ status: "failed", earnedPoints: 0 });
    expect(result.checks.find((item) => item.id === "skills-entries")).toMatchObject({ status: "failed", earnedPoints: 0 });
  });

  it("按固定边界返回红黄蓝三档色彩", () => {
    expect(resumeCompletenessTone(39)).toBe("low");
    expect(resumeCompletenessTone(40)).toBe("medium");
    expect(resumeCompletenessTone(80)).toBe("medium");
    expect(resumeCompletenessTone(81)).toBe("high");
  });
});
