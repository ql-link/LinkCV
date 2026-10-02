// 识别稿手动修改的变化比例，与后端 15% 规则同口径。
export function changeRatio(original: string, next: string) {
  const a = original.trim();
  const b = next.trim();
  if (!a) return b ? 1 : 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = temp;
    }
  }
  return previous[b.length] / a.length;
}

// 后端错误码对应的用户可读提示。未列出的错误码只显示通用提示，不暴露内部码。
export const MOCK_INTERVIEW_ERROR_MESSAGES: Record<string, string> = {
  MOCK_INTERVIEW_NOT_FOUND: "这场模拟面试不存在或已被删除。",
  MOCK_INTERVIEW_IN_PROGRESS: "已有一场进行中的模拟面试，请先完成或放弃它。",
  MOCK_INTERVIEW_QUESTION_MISMATCH: "题目已经变化，请刷新后再作答。",
  MOCK_INTERVIEW_STATE_INVALID: "当前状态不能执行这个操作，请刷新后重试。",
  MOCK_INTERVIEW_RESUME_REQUIRED: "这条求职记录没有关联简历，请另选一份简历。",
  MOCK_INTERVIEW_RESUME_INVALID: "这份简历暂时无法用于模拟面试，请换一份或重新保存后再试。",
  MOCK_INTERVIEW_MATERIAL_INVALID: "参考资料不可用：最多选择 10 份已解析成功的文字资料。",
  MOCK_INTERVIEW_SOURCE_NOT_FOUND: "选择的简历、岗位或求职记录不存在。",
  MOCK_INTERVIEW_CURSOR_INVALID: "列表翻页失败，请刷新后重试。",
  MOCK_INTERVIEW_TURN_FAILED: "面试官没能生成回复，回答已保存，请重新生成。",
  MOCK_INTERVIEW_SPEECH_UNAVAILABLE: "语音面试暂不可用，请改用文字面试。",
  MOCK_INTERVIEW_SPEECH_SESSION_INVALID: "语音识别已过期，请重新录音。",
  MOCK_INTERVIEW_SPEECH_EMPTY: "没有识别到文字，请重新录音或改用打字。",
  MOCK_INTERVIEW_SPEECH_FAILED: "语音识别失败，请重录或改用文字。",
  MOCK_INTERVIEW_TRANSCRIPT_ALREADY_CORRECTED: "本场识别稿已经修正过一次。",
  MOCK_INTERVIEW_TRANSCRIPT_CORRECTION_REJECTED: "修改幅度超过原识别稿的 15%，只能修正错字和术语。",
  MOCK_INTERVIEW_RECORDING_NOT_FOUND: "录音已删除或不存在。",
  MOCK_INTERVIEW_RE_EVALUATE_LIMIT: "每道题最多重新评估 3 次。",
  MOCK_INTERVIEW_PLAN_INCOMPLETE: "面试题目没有准备完整，请重试。",
  MOCK_INTERVIEW_TASK_INTERRUPTED: "后台任务被中断，请重试。",
  LLM_MODEL_NOT_CONFIGURED: "AI 模型暂未配置，请稍后再试。",
  LLM_RESPONSE_INVALID: "AI 返回的内容无法使用，请重试。",
  VALIDATION_ERROR: "提交的内容不符合要求，请检查后重试。",
  UNAUTHORIZED: "登录已过期，请重新登录。",
};
