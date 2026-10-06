// What each workflow needs. The runtime, not the model, walks a task through these.
// resume: "required" needs a target resume before any step, "optional" lets the model
// pick one only when the user points at it, "none" never reads a resume body.
export const WORKFLOWS = Object.freeze({
  resource_catalog: { label: "资源盘点", skills: ["resource-catalog"], resume: "none", purposes: [] },
  resume_diagnosis: {
    label: "简历诊断", skills: ["resume-diagnosis"], resume: "required",
    purposes: ["resume_identity", "content_location"],
  },
  resume_edit: {
    label: "简历修改", skills: ["resume-edit-workflow"], resume: "required",
    purposes: ["resume_identity", "edit_scope", "content_location", "missing_fact", "target_position"],
  },
  resume_translation: {
    label: "简历翻译", skills: ["resume-translation"], resume: "required",
    purposes: ["resume_identity", "edit_scope"],
  },
  interview_guide: {
    label: "面试准备", skills: ["interview-guide"], resume: "optional",
    purposes: ["resume_identity", "target_position", "missing_fact"],
  },
  career_planning: {
    label: "职业规划", skills: ["career-planning"], resume: "optional",
    purposes: ["resume_identity", "target_position", "missing_fact"],
  },
  resume_title: {
    label: "简历标题建议", skills: ["resume-title-generator"], resume: "optional",
    purposes: ["resume_identity", "missing_fact"],
  },
  material_lookup: { label: "资料查找", skills: ["material-lookup"], resume: "none", purposes: ["missing_fact"] },
});

export const EDIT_MODE_SKILLS = Object.freeze([
  "resume-edit-local", "resume-edit-entry-star", "resume-generate-from-materials",
]);

// Failures of the model run itself end the whole run instead of one task.
export const RUN_FATAL_CODES = new Set([
  "AGENT_MODEL_TIMEOUT", "AGENT_MODEL_REQUEST_FAILED", "AGENT_EMPTY_RESPONSE", "AGENT_ABORTED",
  "AGENT_METERING_UNAVAILABLE", "AGENT_STEER_OUTCOME_UNKNOWN", "AGENT_MODEL_UNSUPPORTED",
]);

// Needing the user rather than failing: the task waits instead of being marked broken.
export const TASK_BLOCKED_CODES = new Set(["RESUME_IDENTITY_UNRESOLVED"]);

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const safeCode = (value, fallback) => (SAFE_CODE.test(value ?? "") ? value : fallback);

// The model never states a task's outcome; it follows from what actually happened.
// facts: { proposalIds, summary, error, needsInput, editFailures }
export function computeTaskOutcome(task, facts) {
  const proposalIds = facts.proposalIds ?? [];
  const hasProposals = proposalIds.length > 0;
  if (facts.needsInput) {
    return {
      status: hasProposals ? "partial" : "blocked",
      result: "等待用户澄清",
      errorCode: "USER_INPUT_REQUIRED",
    };
  }
  if (facts.error) {
    const blocked = TASK_BLOCKED_CODES.has(facts.error);
    return {
      status: hasProposals ? "partial" : blocked ? "blocked" : "failed",
      result: facts.summary || undefined,
      errorCode: facts.error,
    };
  }
  if (task.output === "proposal") {
    if (!hasProposals) return { status: "failed", result: facts.summary || undefined, errorCode: "AGENT_TASK_NO_PROPOSAL" };
    return {
      status: facts.editFailures > 0 ? "partial" : "completed",
      result: facts.summary || `已生成 ${proposalIds.length} 份待确认提案`,
      ...(facts.editFailures > 0 && facts.editErrorCode ? { errorCode: facts.editErrorCode } : {}),
    };
  }
  if (!facts.summary) return { status: "failed", errorCode: "AGENT_TASK_RESULT_MISSING" };
  return { status: "completed", result: facts.summary };
}

// Human-readable edit-plan result for the task record and the final reply.
export function editPlanSummary(results, modelSummary) {
  const created = results.reduce((total, item) => total + item.proposal_ids.length, 0);
  const failed = results.filter((item) => item.status !== "succeeded");
  const parts = [`已生成 ${created} 份待确认提案`];
  if (failed.length) {
    parts.push(`${failed.length} 项未完成（${failed.map((item) => `第 ${item.edit} 项 ${item.error_code ?? "AGENT_TOOL_FAILED"}`).join("；")}）`);
  }
  return `${parts.join("，")}。${modelSummary ? `计划说明：${modelSummary}` : ""}`.slice(0, 2000);
}
