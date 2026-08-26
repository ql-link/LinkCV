const CONTEXT_TYPES = new Set([
  "resume",
  "resume_version",
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
]);
const MAX_CONTEXT_MATERIALS = 10;
const MAX_CONTEXT_ITEM_CHARS = 24_000;
const MAX_CONTEXT_TOTAL_CHARS = 60_000;
const CONTENT_FIELDS_BY_TYPE = {
  resume: new Set(["resume_markdown", "summary"]),
  resume_version: new Set(["resume_markdown", "summary"]),
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
