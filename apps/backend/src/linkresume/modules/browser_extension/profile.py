"""Deterministic canonical resume projection, without rendering or inference."""
import re
from datetime import date as calendar_date

from .source_fields import person_name, recover_entries
from linkresume.modules.identity.application_data import ApplicationData, merge_application


def text(value):
    return value.get("value", "").strip() if isinstance(value, dict) else ""


def block_text(blocks):
    lines = []
    for block in blocks:
        kind = block.get("block_type")
        if kind == "paragraph":
            lines.append("".join(run.get("text", "") for run in block.get("runs", []) if run.get("inline_type") == "text"))
        elif kind in {"ordered_list", "bullet_list"}:
            for item in block.get("items", []):
                lines.append("".join(run.get("text", "") for run in item.get("runs", []) if run.get("inline_type") == "text"))
        elif kind == "row":
            lines.append(" · ".join(block_text(cell.get("blocks", [])) for cell in block.get("cells", [])))
    return "\n".join(line for line in lines if line.strip())


def date(value):
    raw = text(value)
    if raw in {"至今", "Present", "present", "现在"}:
        return "至今"
    match = re.fullmatch(r"(\d{4})[-./年](\d{1,2})(?:[-./月](\d{1,2})日?)?月?", raw)
    if match and 1 <= int(match[2]) <= 12:
        if match[3]:
            try:
                calendar_date(int(match[1]), int(match[2]), int(match[3]))
            except ValueError:
                return ""
        return f"{match[1]}-{int(match[2]):02}" + (f"-{int(match[3]):02}" if match[3] else "")
    return raw if re.fullmatch(r"\d{4}", raw) else ""


def project(document, user_profile=None, resume_id=None):
    profile = {}
    warnings = []
    identity = document.get("identity", {})
    name = text(identity.get("name"))
    if name:
        profile["basics"] = {"name": person_name(name)}
    contact = {}
    links = {}
    for item in identity.get("contacts", []):
        kind, value = item.get("contact_kind"), text(item)
        key = {"phone": "phone", "email": "email", "location": "city"}.get(kind)
        if key and value:
            if key in contact and contact[key] != value:
                warnings.append(f"多个{kind}，当前使用文档中的第一项")
            contact.setdefault(key, value)
        link_key = {"github": "portfolio", "website": "personalSite"}.get(kind)
        if link_key and value:
            links.setdefault(link_key, value)
    if contact:
        profile["contact"] = contact
    if links:
        profile["others"] = links
    for section in document.get("sections", []):
        kind = section.get("semantic_kind")
        group = {"education": "education", "work": "work", "project": "projects",
                 "awards": "awards", "certificates": "certificates", "languages": "languages", "activity": "campus"}.get(kind)
        if kind == "work" and re.search(r"实习|internship", text(section.get("title")), re.I):
            group = "internship"
        if kind == "skills":
            descriptions = [block_text(section.get("blocks", []))]
            descriptions.extend(block_text(entry.get("blocks", [])) for entry in section.get("entries", []))
            value = "\n".join(filter(None, descriptions))
            if value:
                current = profile.setdefault("skills", {}).get("domain", "")
                profile["skills"]["domain"] = "\n".join(filter(None, [current, value]))
        if kind in {"profile", "interests"} and (value := block_text(section.get("blocks", []))):
            profile.setdefault("others", {})["selfEvaluation" if kind == "profile" else "hobbies"] = value
        if not group:
            if section.get("entries") and kind not in {"skills", "profile"}:
                warnings.append(f"「{text(section.get('title')) or kind}」未映射，请在填写时核对")
            continue
        if not section.get("entries") and section.get("blocks"):
            recovered = recover_entries(section, group, block_text, date)
            if recovered:
                profile.setdefault(group, []).extend(recovered)
                warnings.append(f"「{text(section.get('title')) or kind}」仅使用正文中明确的资料，其余字段请补充")
            else:
                warnings.append(f"「{text(section.get('title')) or kind}」资料无法明确分项，未用于自动填写")
        for entry in section.get("entries", []):
            fields = entry.get("fields", {})
            item = {}
            mapping = {
                "education": {"organization": "school", "major": "major", "degree": "degree", "location": "city"},
                "work": {"organization": "company", "role": "title", "location": "city"},
                "internship": {"organization": "company", "role": "title"},
                "projects": {"name": "name", "role": "role", "url": "link"},
                "awards": {"name": "title"},
                "certificates": {"name": "name"},
                "languages": {"name": "language", "role": "level"},
                "campus": {"organization": "organization", "role": "title", "name": "name"},
            }[group]
            for source, target in mapping.items():
                if value := text(fields.get(source)):
                    item[target] = value
            if group in {"education", "work", "internship", "projects", "campus"}:
                for source, target in [("start_date", "enrollDate" if group == "education" else "startDate"),
                                       ("end_date", "gradDate" if group == "education" else "endDate")]:
                    if value := date(fields.get(source)):
                        item[target] = value
                    elif text(fields.get(source)):
                        warnings.append(f"「{text(section.get('title'))}」日期格式无法确定，已留空")
            if group in {"work", "internship", "projects", "campus"} and (value := block_text(entry.get("blocks", []))):
                item["description" if group in {"projects", "campus"} else "summary"] = value
            # Keep empty entries so positional correspondence never silently shifts.
            profile.setdefault(group, []).append(item)
    if user_profile:
        if user_profile.candidate_cities:
            profile["intent"] = {"cities": user_profile.candidate_cities}
        intent = profile.setdefault("intent", {})
        if user_profile.years_experience is not None:
            intent["workExperience"] = user_profile.years_experience
        if user_profile.employment_types:
            intent["jobType"] = [{"internship": "实习", "full_time": "全职"}[kind] for kind in user_profile.employment_types]
        # Preserve the user's range, currency and period rather than selecting an amount.
        if user_profile.salary_min is not None or user_profile.salary_max is not None:
            low, high = user_profile.salary_min, user_profile.salary_max
            amount = f"{low:g}–{high:g}" if low is not None and high is not None and low != high else f"{low if low is not None else high:g}"
            if low is None:
                amount = "不高于 " + amount
            elif high is None:
                amount = "不低于 " + amount
            period = {"month": "月", "year": "年", "day": "日", "hour": "小时"}.get(user_profile.salary_period, user_profile.salary_period or "")
            intent["salary"] = " ".join(filter(None, [amount, user_profile.salary_currency])) + (f"/{period}" if period else "")
        if "skills" not in profile and user_profile.skills:
            profile["skills"] = {"domain": "、".join(user_profile.skills)}
    if user_profile and resume_id and getattr(user_profile, "application_data", None):
        merge_application(profile, ApplicationData.model_validate(user_profile.application_data), str(resume_id), warnings)
    missing = [key for key in ["basics.name", "contact.phone", "contact.email", "basics.birthDate", "basics.idNumber"]
               if not profile.get(key.split(".")[0], {}).get(key.split(".")[1])]
    return profile, list(dict.fromkeys(warnings)), missing
