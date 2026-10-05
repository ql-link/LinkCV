const CONTEXT_TYPES = new Set([
  "resume",
  "dataset",
  "job",
  "application",
  "interview",
]);
const CONTEXT_FIELDS = new Set([
  "type",
  "id",
  "version",
  "lock_version",
  "version_id",
  "resume_id",
  "label",
  "description",
  "updated_at",
  "content",
  "presentation",
]);
const MAX_CONTEXT_MATERIALS = 10;
const MAX_CONTEXT_ITEM_CHARS = 24_000;
const MAX_CONTEXT_TOTAL_CHARS = 60_000;
const CONTENT_FIELDS_BY_TYPE = {
  resume: new Set(["resume_markdown", "summary"]),
  dataset: new Set(["dataset_markdown"]),
  job: new Set([
    "job_title",
    "company_name",
    "description",
    "skills",
    "experience_requirement",
    "education_requirement",
    "work_city",
    "work_mode",
    "summary",
  ]),
  application: new Set([
    "company_name",
    "job_title",
    "stage",
    "stage_type",
    "status",
    "offer_status",
    "notes",
    "summary",
  ]),
  interview: new Set([
    "stage",
    "status",
    "mode",
    "preparation_note",
    "questions",
    "review_summary",
    "improvement",
    "summary",
  ]),
};

function isBoundedString(value, maxLength, required = false) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (!required || value.trim().length > 0)
  );
}

export function validateContextMaterials(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CONTEXT_MATERIALS) {
    throw new Error("INVALID_CONTEXT_MATERIALS");
  }
  const seenTypes = new Set();
  let totalChars = 0;
  for (const material of value) {
    if (!material || typeof material !== "object" || Array.isArray(material)) {
      throw new Error("INVALID_CONTEXT_MATERIALS");
    }
    for (const key of Object.keys(material)) {
      if (!CONTEXT_FIELDS.has(key)) throw new Error("INVALID_CONTEXT_MATERIALS");
    }
    if (
      !CONTEXT_TYPES.has(material.type) ||
      (material.presentation != null && !["mention", "implicit"].includes(material.presentation)) ||
      seenTypes.has(material.type) ||
      !isBoundedString(material.id, 64, true) ||
      !isBoundedString(material.version, 128, true) ||
      !isBoundedString(material.label, 255, true) ||
      !isBoundedString(material.updated_at, 128, true) ||
      (material.version_id != null && !isBoundedString(material.version_id, 64, true)) ||
      (material.resume_id != null && !isBoundedString(material.resume_id, 64, true)) ||
      (material.description != null && !isBoundedString(material.description, 500)) ||
      !material.content ||
      typeof material.content !== "object" ||
      Array.isArray(material.content)
    ) {
      throw new Error("INVALID_CONTEXT_MATERIALS");
    }
    for (const key of Object.keys(material.content)) {
      if (!CONTENT_FIELDS_BY_TYPE[material.type].has(key)) {
        throw new Error("INVALID_CONTEXT_MATERIALS");
      }
    }
    const contentText = JSON.stringify(material.content);
    if (contentText.length > MAX_CONTEXT_ITEM_CHARS) {
      throw new Error("INVALID_CONTEXT_MATERIALS");
    }
    totalChars += contentText.length;
    if (totalChars > MAX_CONTEXT_TOTAL_CHARS) {
      throw new Error("INVALID_CONTEXT_MATERIALS");
    }
    seenTypes.add(material.type);
  }
  return value;
}

export function validateConversationMemory(value) {
  if (value == null) return { schema_version: 1, events: [], truncated: false };
  const plain = (item) => item && typeof item === "object" && !Array.isArray(item);
  const keys = (item, allowed) => plain(item) && Object.keys(item).every((key) => allowed.includes(key));
  const invalid = () => { throw new Error("INVALID_CONVERSATION_MEMORY"); };
  const bounded = (item, max, required = false) => typeof item === "string"
    && [...item].length <= max && (!required || item.trim().length > 0);
  if (!keys(value, ["schema_version", "events", "truncated"]) || value.schema_version !== 1
      || !Array.isArray(value.events) || value.events.length > 41 * 10
      || typeof value.truncated !== "boolean" || [...JSON.stringify(value)].length > 6000) invalid();
  const refs = new Set();
  const ids = new Set();
  for (const event of value.events) {
    if (!keys(event, ["memory_ref", "source_sequence_no", "resource", "source", "tasks"])
        || !Number.isSafeInteger(event.source_sequence_no) || event.source_sequence_no < 1
        || !keys(event.resource, ["type", "id", "label"]) || !CONTEXT_TYPES.has(event.resource.type)
        || !/^[1-9][0-9]{0,19}$/.test(event.resource.id)
        || !bounded(event.resource.label, 255)
        || event.memory_ref !== `m:${event.source_sequence_no}:${event.resource.type}:${event.resource.id}`
        || refs.has(event.memory_ref) || !["explicit", "implicit", "memory"].includes(event.source)
        || !Array.isArray(event.tasks) || event.tasks.length > 8) invalid();
    for (const task of event.tasks) {
      if (!keys(task, ["id", "label", "status", "result"])
          || !bounded(task.id, 32, true) || !bounded(task.label, 120, true)
          || !["planned", "running", "completed", "partial", "blocked", "failed"].includes(task.status)
          || (task.result != null && !bounded(task.result, 300))) invalid();
    }
    refs.add(event.memory_ref);
    ids.add(`${event.resource.type}:${event.resource.id}`);
  }
  if (ids.size > 10) invalid();
  return value;
}
