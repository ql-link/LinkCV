import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@/api/client";
import { attachGeneratedDocuments } from "./localArtifacts";
const prompt: AgentMessage = { role: "user", sequence_no: 1, content: "生成面试准备文档", created_at: "2026-10-03T00:00:00Z" };
const reply: AgentMessage = { role: "assistant", sequence_no: 2, run_id: "run-1", content: "# 模型生成标题\n\n真实模型正文", created_at: prompt.created_at };
describe("AI document replies", () => {
  it("derives a stable artifact from the actual completed reply across reload", () => {
    const result = attachGeneratedDocuments([prompt, reply], "session-1")[1].generatedDocument;
    expect(result).toEqual({ kind: "generated", id: "session-1:run-1", label: "模型生成标题.md", content: reply.content });
    expect(attachGeneratedDocuments([prompt, reply], "session-1")[1].generatedDocument).toEqual(result);
  });
  it("does not turn clarification, refusal, partial or failed replies into documents", () => {
    for (const answer of [{ ...reply, message_type: "clarification" as const }, { ...reply, content: "请补充目标岗位。" }, { ...reply, temporary: true }, { ...reply, status: "failed" as const }]) {
      expect(attachGeneratedDocuments([prompt, answer], "session")[1].generatedDocument).toBeUndefined();
    }
  });
  it("continues document intent through clarification and sanitizes Markdown filenames", () => {
    const result = attachGeneratedDocuments([prompt, { ...reply, message_type: "clarification" }, { ...prompt, sequence_no: 3, content: "后端开发" }, { ...reply, sequence_no: 4, content: "```markdown\n# 项目/准备\n\n模型正文\n```" }], "session")[3].generatedDocument;
    expect(result?.label).toBe("项目准备.md");
    expect(result?.content).toBe("# 项目/准备\n\n模型正文");
  });
  it("does not create documents for unrelated or explicitly negated prompts", () => {
    for (const content of ["请解释代码", "不要生成文档"]) expect(attachGeneratedDocuments([{ ...prompt, content }, reply], "session")[1].generatedDocument).toBeUndefined();
  });
});
