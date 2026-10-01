import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockInterviewApi, readMockTurn, mockInterviewErrorMessage, type MockTurnEvent } from "./mockInterviewApi";
import { interview } from "./__tests__/fixtures";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
async function collect(source: AsyncGenerator<MockTurnEvent>) { const events = []; for await (const event of source) events.push(event); return events; }
function sse(...chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}
describe("模拟面试 HTTP 与 SSE 契约", () => {
  it("列表使用服务器游标读取全部记录", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [interview()], next_cursor: "next/value" })).mockResolvedValueOnce(json({ items: [interview({ id: "11" })], next_cursor: null }));
    const result = await mockInterviewApi.listAll({ resume_id: "1" });
    expect(result.items.map((item) => item.id)).toEqual(["10", "11"]);
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=next%2Fvalue");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    expect(localStorage.length).toBe(0);
  });
  it("严格创建请求只发送 API 契约字段", async () => {
    fetchMock.mockResolvedValue(json({ mock_interview: interview() }));
    await mockInterviewApi.create({ resume_id: "1", material_ids: ["2"], materials_in_questions: true, answer_mode: "voice" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/mock-interviews");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ resume_id: "1", material_ids: ["2"], materials_in_questions: true, answer_mode: "voice" });
  });
  it("SSE 跨任意 UTF-8/CRLF 分块，保留音频与回合", async () => {
    const text = 'event: interviewer.delta\r\ndata: {"content":"你好"}\r\n\r\nevent: interviewer.audio\ndata: {"seq":0,"text":"你好","format":"mp3","data":"SURz"}\n\nevent: interviewer.turn\ndata: {"action":"next_question","question":null,"closing_message":null,"status":"in_progress","lock_version":2}\n\n';
    const bytes = new TextEncoder().encode(text);
    const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
    const result = await collect(readMockTurn(response));
    expect(result.map((event) => event.type)).toEqual(["interviewer.delta", "interviewer.audio", "interviewer.turn"]);
    expect(result[0]).toMatchObject({ content: "你好" });
    expect(result[2]).toMatchObject({ action: "next_question" });
  });
  it("401 刷新 Cookie 后重试流请求，保留幂等键", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "UNAUTHORIZED" }, 401)).mockResolvedValueOnce(json({ user: { id: "1" } })).mockResolvedValueOnce(sse('event: answer.accepted\ndata: {"question_id":"101","skipped":false,"lock_version":2}\n\n'));
    expect(await collect(mockInterviewApi.answer("10", { question_id: "101", answer: "缓存" }, "same-key-123"))).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("same-key-123");
    expect(fetchMock.mock.calls[2][1].headers["Idempotency-Key"]).toBe("same-key-123");
  });
  it("未完成 SSE 不伪造下一题或结束事件", async () => {
    await expect(collect(readMockTurn(sse('event: interviewer.delta\ndata: {"content":"半句"}\n\n')))).rejects.toThrow("MOCK_INTERVIEW_STREAM_INTERRUPTED");
    await expect(collect(readMockTurn(sse('event: interviewer.turn\ndata: {')))).rejects.toThrow("MOCK_INTERVIEW_STREAM_INTERRUPTED");
  });
  it("后端错误码通过统一错误对象呈现", async () => {
    fetchMock.mockResolvedValue(json({ error: "MOCK_INTERVIEW_IN_PROGRESS" }, 409));
    const error = await mockInterviewApi.create({ resume_id: "1" }).catch((reason) => reason);
    expect(error.status).toBe(409); expect(mockInterviewErrorMessage(error)).toContain("已有一场进行中");
  });
  it("重评响应没有详情，保持真实契约；录音与试音用二进制读取", async () => {
    fetchMock.mockResolvedValueOnce(json({ question_id: "101", total_score: 80, previous_total_score: 75 })).mockResolvedValueOnce(new Response("RIFF", { headers: { "Content-Type": "audio/wav" } })).mockResolvedValueOnce(new Response("ID3", { headers: { "Content-Type": "audio/mpeg" } }));
    const result = await mockInterviewApi.reEvaluate("10", "101"); expect(result).not.toHaveProperty("mock_interview");
    expect((await mockInterviewApi.recording("10", "101")).type).toBe("audio/wav");
    expect((await mockInterviewApi.speechPlayback("10", "101")).type).toBe("audio/mpeg");
    expect(fetchMock.mock.calls[2][1].body).toBe('{"question_id":"101"}');
  });
});
