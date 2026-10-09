export function assertAgentCompleted(message) {
  if (!message || message.role !== "assistant") {
    throw new Error("AGENT_EMPTY_RESPONSE");
  }
  if (message.stopReason === "error") {
    const detail = String(message.errorMessage ?? "");
    if (/\b(?:timeout|timed out|etimedout)\b/i.test(detail)) {
      throw new Error("AGENT_MODEL_TIMEOUT");
    }
    const toolFailureCode = detail.match(
      /\b(?:WORKFLOW_SKILL_REQUIRED|TARGET_RESOLUTION_REQUIRED|DIAGNOSIS_REQUIRED|SKILL_MODE_CONFLICT|TARGET_STALE|PATCH_OUT_OF_SCOPE|COMPOUND_PLAN_REQUIRED|EDIT_PLAN_TARGET_LIMIT|SOURCE_REQUIRED|SOURCE_FORBIDDEN|USER_INPUT_REQUIRED|AGENT_CLARIFICATION_INVALID)\b/,
    )?.[0];
    if (toolFailureCode) throw new Error(toolFailureCode);
    throw new Error("AGENT_MODEL_REQUEST_FAILED");
  }
  if (message.stopReason === "aborted") {
    throw new Error("AGENT_ABORTED");
  }
}

export function agentUsage(stats) {
  if (!stats?.tokens) return null;
  const inputTokens = Number(stats.tokens.input);
  const outputTokens = Number(stats.tokens.output);
  if (
    !Number.isSafeInteger(inputTokens) || inputTokens < 0 ||
    !Number.isSafeInteger(outputTokens) || outputTokens < 0
  ) {
    return null;
  }
  return {
    inputTokens,
    outputTokens,
    estimatedCost: null,
  };
}

export function createAssistantOutputFilter(
  emit,
  runId,
  {
    isFinalResponse = () => true,
    shouldSuppress = () => false,
    onFinalText = () => {},
  } = {},
) {
  let workingMessageHasText = false;
  let workingOutputHasText = false;
  return (event) => {
    if (event.type === "message_start" && event.message?.role === "assistant") {
      workingMessageHasText = false;
      return;
    }
    if (
      event.type !== "message_update" ||
      event.assistantMessageEvent.type !== "text_delta" ||
      !event.assistantMessageEvent.delta ||
      shouldSuppress()
    ) return;
    if (isFinalResponse()) {
      onFinalText();
      emit("assistant.delta", { runId, delta: event.assistantMessageEvent.delta });
      return;
    }
    const separator = workingOutputHasText && !workingMessageHasText ? "\n" : "";
    emit("assistant.activity.delta", {
      runId,
      delta: `${separator}${event.assistantMessageEvent.delta}`,
    });
    workingMessageHasText = true;
    workingOutputHasText = true;
  };
}

export function clarificationFallbackText(clarification) {
  const lines = ["继续前需要确认："];
  clarification.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.question}`);
    lines.push(`   选项：${question.options.map((option) => option.label).join(" / ")} / 其他`);
  });
  return lines.join("\n");
}
