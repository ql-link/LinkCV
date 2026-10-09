import { objectSchema, codedError } from "./util.js";

// The selected resource is request-scoped authority, not a title-search hint.
export function createResumeContextPolicy(materials = []) {
  const material = materials.find((item) => item.type === "resume");
  const backgroundId = material?.presentation === "implicit" ? (material.resume_id ?? material.id) : null;
  const resumeId = backgroundId ? null : material?.resume_id ?? material?.id ?? null;
  return Object.freeze({
    resumeId,
    backgroundId,
    // Going through the reference endpoint is what grants the current task access to the resume.
    resolveReference: (client, params) => resumeId && !params.memory_ref
      ? client.resolveResumeReference({ resume_id: resumeId })
      : backgroundId && !params.memory_ref && !params.title && !params.resume_id
        ? client.resolveResumeReference({ resume_id: backgroundId })
        : client.resolveResumeReference(params),
    unresolvedQuestions: (questions, selectionConflict = false) => questions.filter((question) => (
      selectionConflict || !resumeId || question.purpose !== "resume_identity"
    )),
  });
}

export function resourceReferenceParameters(memory, content, answers = []) {
  const refs = [...new Set(memory.events.map((event) => event.memory_ref))];
  const texts = [content, ...answers.map((answer) => answer.value)]
    .filter((value) => typeof value === "string" && value.trim());
  // Long requests still need a verbatim excerpt, checked by the runtime.
  const evidence = texts.every((value) => value.length <= 300) ? [...new Set(texts)] : [];
  return objectSchema({
    memory_ref: { type: "string", pattern: "^m:[1-9][0-9]*:(user_profile|resume|dataset|job|application|interview):[1-9][0-9]*$", ...(refs.length ? { enum: refs } : {}) },
    relation: { type: "string", enum: ["continuation", "historical_selection"] },
    referring_text: {
      type: "string", minLength: 1, maxLength: 300,
      description: "逐字使用本轮用户原话或已校验澄清答案，不使用历史原话、不改写。",
      ...(evidence.length ? { enum: evidence } : {}),
    },
  }, ["memory_ref", "relation", "referring_text"]);
}

export function resumeReferenceParameters(memory, content, answers = []) {
  const explicit = {
    title: { type: "string", minLength: 1, maxLength: 255 },
    resume_id: { type: "string", pattern: "^[0-9]+$" },
  };
  const resumeMemory = { ...memory, events: memory.events.filter((event) => event.resource.type === "resume") };
  if (!resumeMemory.events.length) return objectSchema(explicit);
  const historical = resourceReferenceParameters(resumeMemory, content, answers);
  return {
    ...objectSchema({ ...explicit, ...historical.properties }),
    anyOf: [objectSchema(explicit), historical],
  };
}

export function validateMemoryReference(params, memory, content, answers = [], expectedType = "resume") {
  const event = memory.events.find((item) => item.memory_ref === params.memory_ref);
  const texts = [content, ...answers.map((item) => item.value)];
  if (!event || (expectedType && event.resource.type !== expectedType) || params.title != null || params.resume_id != null
      || !["continuation", "historical_selection"].includes(params.relation)
      || typeof params.referring_text !== "string" || !params.referring_text.trim()
      || !texts.some((text) => typeof text === "string" && text.includes(params.referring_text))) {
    throw codedError("AGENT_MEMORY_REFERENCE_INVALID");
  }
  return event.resource.id;
}

export function selectionForResume(policy, resumeId, selection) {
  return resumeId && [policy.backgroundId, policy.resumeId].includes(resumeId) ? selection : null;
}

export function referenceNeedsResolution(params, materials, content, answers = []) {
  if (params.memory_ref) return true;
  const explicit = materials.find((item) => item.type === "resume" && item.presentation !== "implicit");
  if (!explicit) return Boolean(params.title || params.resume_id);
  const id = explicit.resume_id ?? explicit.id;
  const titleKey = (value) => (value ?? "").trim().replace(/\s+/gu, " ").toLowerCase();
  const namesDifferentTarget = (params.resume_id && params.resume_id !== id)
    || (params.title && titleKey(params.title) !== titleKey(explicit.label));
  // Preserve explicit IDs against model guesses; real user alternatives must
  // reach the server conflict check rather than being silently ignored.
  return Boolean(namesDifferentTarget && isExplicitResumeReference(params, content, answers));
}

export function isExplicitResumeReference(params, content, clarificationAnswers = []) {
  const supplied = [content, ...clarificationAnswers.map((answer) => answer?.value)]
    .filter((value) => typeof value === "string");
  if (params.title) return supplied.some((value) => value.includes(params.title));
  if (params.resume_id) {
    const pattern = new RegExp(`(?:^|\\D)${params.resume_id}(?:\\D|$)`);
    return supplied.some((value) => pattern.test(value));
  }
  return false;
}
