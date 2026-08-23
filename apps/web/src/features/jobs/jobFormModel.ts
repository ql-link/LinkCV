import type {
  JobDescriptionCreatePayload,
  JobDescriptionRecord,
  JobEmploymentType,
  JobSalaryPeriod,
  JobWorkMode,
} from "../../api/client";

export type JobFormState = {
  job_title: string;
  company_name: string;
  employment_type: JobEmploymentType | "";
  description: string;
  skills: string;
  education_requirement: string;
  experience_requirement: string;
  work_schedule: string;
  work_city: string;
  work_address: string;
  work_mode: JobWorkMode | "";
  salary_text: string;
  salary_min: string;
  salary_max: string;
  salary_currency: string;
  salary_period: JobSalaryPeriod | "";
  salary_months_per_year: string;
  company_legal_name: string;
  company_industry: string;
  company_size: string;
  company_financing_stage: string;
  company_description: string;
  recruiter_name: string;
  recruiter_title: string;
  source_url: string;
  notes: string;
};

export const emptyJobForm: JobFormState = {
  job_title: "", company_name: "", employment_type: "", description: "", skills: "",
  education_requirement: "", experience_requirement: "", work_schedule: "", work_city: "",
  work_address: "", work_mode: "", salary_text: "", salary_min: "", salary_max: "",
  salary_currency: "", salary_period: "", salary_months_per_year: "", company_legal_name: "",
  company_industry: "", company_size: "", company_financing_stage: "", company_description: "",
  recruiter_name: "", recruiter_title: "", source_url: "", notes: "",
};

export function jobPayloadFromForm(form: JobFormState): JobDescriptionCreatePayload {
  return {
    job_title: form.job_title.trim(),
    company_name: form.company_name.trim(),
    employment_type: form.employment_type || null,
    description: form.description.trim(),
    skills: form.skills.split(/[,，\n]/).map((value) => value.trim()).filter(Boolean),
    education_requirement: nullable(form.education_requirement),
    experience_requirement: nullable(form.experience_requirement),
    work_schedule: nullable(form.work_schedule),
    work_city: nullable(form.work_city),
    work_address: nullable(form.work_address),
    work_mode: form.work_mode || null,
    salary_text: nullable(form.salary_text),
    salary_min: nullable(form.salary_min),
    salary_max: nullable(form.salary_max),
    salary_currency: nullable(form.salary_currency),
    salary_period: form.salary_period || null,
    salary_months_per_year: form.salary_months_per_year ? Number(form.salary_months_per_year) : null,
    company_legal_name: nullable(form.company_legal_name),
    company_industry: nullable(form.company_industry),
    company_size: nullable(form.company_size),
    company_financing_stage: nullable(form.company_financing_stage),
    company_description: nullable(form.company_description),
    recruiter_name: nullable(form.recruiter_name),
    recruiter_title: nullable(form.recruiter_title),
    notes: nullable(form.notes),
    source_type: "manual",
    source_url: nullable(form.source_url),
  };
}

export function jobFormFromRecord(record: JobDescriptionRecord): JobFormState {
  return {
    ...emptyJobForm,
    ...record,
    employment_type: record.employment_type ?? "",
    skills: record.skills.join(", "),
    work_mode: record.work_mode ?? "",
    salary_min: record.salary_min ?? "",
    salary_max: record.salary_max ?? "",
    salary_currency: record.salary_currency ?? "",
    salary_period: record.salary_period ?? "",
    salary_months_per_year: record.salary_months_per_year?.toString() ?? "",
    source_url: record.source_url ?? "",
    education_requirement: record.education_requirement ?? "",
    experience_requirement: record.experience_requirement ?? "",
    work_schedule: record.work_schedule ?? "",
    work_city: record.work_city ?? "",
    work_address: record.work_address ?? "",
    salary_text: record.salary_text ?? "",
    company_legal_name: record.company_legal_name ?? "",
    company_industry: record.company_industry ?? "",
    company_size: record.company_size ?? "",
    company_financing_stage: record.company_financing_stage ?? "",
    company_description: record.company_description ?? "",
    recruiter_name: record.recruiter_name ?? "",
    recruiter_title: record.recruiter_title ?? "",
    notes: record.notes ?? "",
  };
}

function nullable(value: string): string | null {
  return value.trim() || null;
}
