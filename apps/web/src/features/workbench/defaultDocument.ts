import type { JSONContent } from "@tiptap/core";

function placeholderDataUri(label: string, width = 96, height = 96) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#f0f0f0"/><line x1="0" y1="0" x2="0" y2="14" stroke="#e3e3e6" stroke-width="7"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/><rect width="100%" height="100%" fill="none" stroke="#d2d2d7"/><text x="50%" y="50%" font-family="LXGW WenKai" font-size="12" fill="#8a8a8e" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  marks,
});

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const resumeRow = (left: string, right: string, leftWidth = 65): JSONContent => ({
  type: "resumeRow",
  attrs: { leftWidth },
  content: [paragraph(text(left)), paragraph(text(right))],
});

export const defaultResumeDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "avatarImage",
      attrs: { src: placeholderDataUri("头像"), size: 96 },
    },
    {
      type: "heading",
      attrs: { level: 1, textAlign: "center" },
      content: [text("张三")],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [text("电话：13800000000 ｜ 邮箱：zhangsan@example.com ｜ 博客：blog.example.com")],
    },
    { type: "heading", attrs: { level: 2, textAlign: null }, content: [text("教育经历")] },
    resumeRow("示例大学 · 计算机学院 · 软件工程", "2022.9 – 2026.6", 70),
    { type: "heading", attrs: { level: 2, textAlign: null }, content: [text("实习经历")] },
    resumeRow("星河云科技有限公司", "Java 开发实习生"),
    paragraph(text("技术架构：", [{ type: "bold" }]), text("Java、MySQL、Redis、Spring Boot、MyBatis")),
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        { type: "listItem", content: [paragraph(text("设计任务状态流转接口，统一参数校验、权限判断和异常返回。"))] },
        { type: "listItem", content: [paragraph(text("使用 Redis 缓存高频配置数据，降低数据库重复查询压力。"))] },
        { type: "listItem", content: [paragraph(text("配合前端联调列表筛选、详情编辑和批量操作能力。"))] },
      ],
    },
    { type: "heading", attrs: { level: 2, textAlign: null }, content: [text("专业技能")] },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        { type: "listItem", content: [paragraph(text("Java：熟悉集合、多线程、Spring、MyBatis 等常用框架。"))] },
        { type: "listItem", content: [paragraph(text("数据库：了解 MySQL、PostgreSQL 的索引、事务和查询优化。"))] },
        { type: "listItem", content: [paragraph(text("中间件：熟悉 Redis 常见缓存模式和基础队列使用场景。"))] },
      ],
    },
  ],
};

export function parseStoredDocument(value: string): JSONContent | string {
  try {
    const parsed = JSON.parse(value) as JSONContent;
    if (parsed?.type === "doc") return parsed;
  } catch {
    // Existing resumes are Markdown. Tiptap can hydrate from the rendered HTML string.
  }
  return value;
}
