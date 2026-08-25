import type { ResumeTemplate } from "../../api/client";

export const DEFAULT_IMPORT_TEMPLATE_KEY = "classic-technical-cn";
const RETIRED_BLANK_TEMPLATE_KEY = "blank-cn";

export function selectImportTemplate(templates: ResumeTemplate[]): ResumeTemplate | null {
  return templates.find((template) => template.key === DEFAULT_IMPORT_TEMPLATE_KEY)
    ?? templates.find((template) => template.key !== RETIRED_BLANK_TEMPLATE_KEY)
    ?? null;
}
