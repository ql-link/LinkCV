import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SKILLS_ROOT = fileURLToPath(new URL("../../resources/skills/", import.meta.url));
const REGISTERED = new Set([
  "resume-diagnosis", "resume-edit-workflow", "resume-edit-local", "resume-edit-entry-star",
  "resume-generate-from-materials", "resume-translation", "interview-guide", "career-planning",
  "resume-title-generator", "material-lookup", "resource-catalog", "resume-evidence-method",
]);
const cache = new Map();

// Skills hold content rules only. The runtime injects them; the model never reads files.
export async function loadSkillRules(name) {
  if (!REGISTERED.has(name)) throw new Error("AGENT_SKILL_UNKNOWN");
  if (!cache.has(name)) {
    const text = await readFile(`${SKILLS_ROOT}${name}/SKILL.md`, "utf8");
    cache.set(name, text.replace(/^---\n[\s\S]*?\n---\n/, "").trim());
  }
  return cache.get(name);
}

export const REGISTERED_SKILLS = [...REGISTERED];
