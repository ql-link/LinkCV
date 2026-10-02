// 真实数据层：请求形状、错误映射与 SSE 回合流解析（fetch 全部替身，不连后端）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveMockInterviewApi } from "./mockInterviewLive";
import { MockInterviewError, type MockTurnEvent } from "./mockInterviewTypes";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sse(frames: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        frames.forEach((frame) => controller.enqueue(encoder.encode(frame)));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function collect(stream: AsyncGenerator<MockTurnEvent>) {
  const events: MockTurnEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("liveMockInterviewApi", () => {
  it("create 不向后端发送演示用的 display 字段", async () => {
    fetchMock.mockResolvedValue(json({ mock_interview: { id: "i1" } }, 201));
    await liveMockInterviewApi.create({ resume_id: "7", question_count: 5, display: { resume_title: "示例简历" } });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/mock-interviews");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ resume_id: "7", question_count: 5 });
  });

  it("repeat 可选带 answer_mode 覆盖新场作答方式，省略时不带请求体", async () => {
    fetchMock.mockResolvedValue(json({ mock_interview: { id: "i2" } }, 201));
    await liveMockInterviewApi.repeat("i1", { answer_mode: "voice" });
    await liveMockInterviewApi.repeat("i1");
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/mock-interviews/i1/repeat");
    expect(JSON.parse(init.body)).toEqual({ answer_mode: "voice" });
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it("speechPlayback 省略题号为设备试音，带题号时请求当前题目，失败映射为错误码", async () => {
    // jsdom 的 Blob 不能作为 Response 体，直接用最小响应替身
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(["mp3"], { type: "audio/mpeg" }) });
    const blob = await liveMockInterviewApi.speechPlayback("i1");
    expect(blob.size).toBe(3);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/mock-interviews/i1/speech/playback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({});

    fetchMock.mockResolvedValueOnce(json({ error: "MOCK_INTERVIEW_QUESTION_MISMATCH" }, 409));
    await expect(liveMockInterviewApi.speechPlayback("i1", "9")).rejects.toMatchObject({ code: "MOCK_INTERVIEW_QUESTION_MISMATCH" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ question_id: "9" });
  });

  it("list 跟随游标翻页直到没有下一页", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ id: "a" }], next_cursor: "c1" }))
      .mockResolvedValueOnce(json({ items: [{ id: "b" }], next_cursor: null }));
    const result = await liveMockInterviewApi.list({ status: "completed" });
    expect(result.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(fetchMock.mock.calls[0][0]).toContain("status=completed");
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=c1");
  });

  it("后端错误码映射为带中文提示的 MockInterviewError", async () => {
    fetchMock.mockResolvedValue(json({ error: "MOCK_INTERVIEW_IN_PROGRESS" }, 409));
    const error = await liveMockInterviewApi.create({ resume_id: "7" }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MockInterviewError);
    expect((error as MockInterviewError).code).toBe("MOCK_INTERVIEW_IN_PROGRESS");
    expect((error as MockInterviewError).message).toContain("进行中");
  });

  it("answer 携带幂等键并按顺序产出 SSE 事件，turn 结束后停止", async () => {
    fetchMock.mockResolvedValue(sse([
      frame("answer.accepted", { question_id: "9", skipped: false, lock_version: 3 }),
      frame("interviewer.delta", { content: "请" }),
      frame("interviewer.audio", { seq: 0, text: "请", format: "mp3", data: "QUJD" }),
      frame("not.a.known.event", { x: 1 }),
      frame("interviewer.turn", { status: "in_progress", action: "next", question: null, closing_message: null, lock_version: 4 }),
    ]));
    const events = await collect(liveMockInterviewApi.answer("i1", { question_id: "9", answer: "回答" }));
    expect(events.map((event) => event.type)).toEqual(["answer.accepted", "interviewer.delta", "interviewer.audio", "interviewer.turn"]);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/mock-interviews/i1/answers");
    expect(init.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_.:-]{8,64}$/);
    expect(JSON.parse(init.body)).toEqual({ question_id: "9", answer: "回答" });
  });

  it("没有终止事件的回合流视为中断", async () => {
    fetchMock.mockResolvedValue(sse([frame("interviewer.delta", { content: "请" })]));
    await expect(collect(liveMockInterviewApi.skip("i1", { question_id: "9" }))).rejects.toMatchObject({ code: "MOCK_INTERVIEW_TURN_FAILED" });
  });

  it("回合流返回错误状态时抛出带错误码的错误", async () => {
    fetchMock.mockResolvedValue(json({ error: "MOCK_INTERVIEW_QUESTION_MISMATCH" }, 409));
    await expect(collect(liveMockInterviewApi.answer("i1", { question_id: "1", answer: "x" }))).rejects.toMatchObject({ code: "MOCK_INTERVIEW_QUESTION_MISMATCH" });
  });

  it("recording 对 404 返回 null，成功时返回音频 Blob", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await liveMockInterviewApi.recording("i1", "9")).toBeNull();
    // jsdom 的 Blob 不能作为 Response body，这里直接替身一个只提供 blob() 的响应
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, blob: async () => new Blob(["wav"], { type: "audio/wav" }) });
    const blob = await liveMockInterviewApi.recording("i1", "9");
    expect(blob?.type).toBe("audio/wav");
  });
});
