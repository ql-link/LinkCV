// 模拟面试数据层门面：页面只从这里调用，默认走真实的 /api/mock-interviews（mockInterviewLive.ts）。
// 自动化测试（vitest MODE=test）默认使用本地假数据实现（mockInterviewDemo.ts），保证不依赖后端。
import { liveMockInterviewApi } from "./mockInterviewLive";
import { demoMockInterviewApi, resetMockInterviewStore } from "./mockInterviewDemo";
import { MOCK_INTERVIEW_ERROR_MESSAGES, changeRatio } from "./mockInterviewText";
import { MockInterviewError, type MockInterviewApi } from "./mockInterviewTypes";

export * from "./mockInterviewTypes";
export { subscribeMockInterviews } from "./mockInterviewEvents";
export { changeRatio, resetMockInterviewStore };

const demoByDefault = import.meta.env.MODE === "test";
let current: MockInterviewApi = demoByDefault ? demoMockInterviewApi : liveMockInterviewApi;
let live = !demoByDefault;

// 显式切换实现：传 true 用本地假数据，传 false 用真实接口（用于测试真实实现的调用方式）。
export function useDemoMockInterviewApi(demo = true) {
  current = demo ? demoMockInterviewApi : liveMockInterviewApi;
  live = !demo;
}

// 真实接口下后台任务（准备、评估）不会主动通知页面，页面需要轮询。
export function isLiveMockInterviewApi() {
  return live;
}

// 每个方法都在调用时取当前实现，这样 vi.spyOn(mockInterviewApi, ...) 与实现切换都有效。
export const mockInterviewApi: MockInterviewApi = {
  list: (...args) => current.list(...args),
  get: (...args) => current.get(...args),
  create: (...args) => current.create(...args),
  answer: (...args) => current.answer(...args),
  skip: (...args) => current.skip(...args),
  retryReply: (...args) => current.retryReply(...args),
  finish: (...args) => current.finish(...args),
  abandon: (...args) => current.abandon(...args),
  retry: (...args) => current.retry(...args),
  repeat: (...args) => current.repeat(...args),
  remove: (...args) => current.remove(...args),
  speechCapability: (...args) => current.speechCapability(...args),
  startRecognition: (...args) => current.startRecognition(...args),
  speechPlayback: (...args) => current.speechPlayback(...args),
  correctTranscripts: (...args) => current.correctTranscripts(...args),
  editTranscript: (...args) => current.editTranscript(...args),
  reEvaluate: (...args) => current.reEvaluate(...args),
  deleteRecordings: (...args) => current.deleteRecordings(...args),
  recording: (...args) => current.recording(...args),
};

export function mockInterviewErrorMessage(error: unknown) {
  const generic = "操作没有完成，请稍后重试。";
  if (error instanceof MockInterviewError) {
    if (error.message !== error.code) return error.message;
    return MOCK_INTERVIEW_ERROR_MESSAGES[error.code] ?? generic;
  }
  // SSE 的 interviewer.failed 只带错误码，页面会把它包成普通 Error
  if (error instanceof Error) return MOCK_INTERVIEW_ERROR_MESSAGES[error.message] ?? generic;
  return generic;
}
