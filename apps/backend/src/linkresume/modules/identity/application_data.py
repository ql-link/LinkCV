"""User-confirmed application facts. Never infer unknown facts or join by array order."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints, model_validator

FACT_FIELDS = {
    "basics": {"name", "englishName", "gender", "birthDate", "ethnicity", "nationality", "maritalStatus", "politicalStatus", "idType", "idNumber", "hukou", "hukouType", "hometown", "gaokaoOrigin"},
    "contact": {"phone", "altPhone", "email", "city", "address", "postcode", "country", "wechat"},
    "others": {"personalSite", "portfolio", "selfEvaluation", "hobbies"},
    "education": {"school", "major", "degree", "degreeTitle", "enrollDate", "gradDate", "city", "department", "gpa", "gpaScale", "rank", "studyMode", "trainingMode", "duration", "studentNumber", "courses", "advisor"},
    "work": {"company", "title", "startDate", "endDate", "summary", "city", "department", "leaveReason"},
    "internship": {"company", "title", "startDate", "endDate", "summary", "city", "department"},
    "projects": {"name", "role", "startDate", "endDate", "description", "link"},
    "languages": {"language", "level", "cert", "score", "date"},
    "certificates": {"name", "date", "issuer", "number"},
    "awards": {"title", "date", "level", "issuer", "description"},
    "campus": {"name", "organization", "title", "startDate", "endDate", "description"},
}
RecordGroup = Literal["education", "work", "internship", "projects", "languages", "certificates", "awards", "campus"]
Fact = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, max_length=4000)]
def _resume_id(value: str) -> str:
    if int(value) > 18_446_744_073_709_551_615:
        raise ValueError("resume ID exceeds unsigned bigint")
    return value


ResumeId = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,19}$"), AfterValidator(_resume_id)]


def clean_fields(group: str, fields: dict[str, str]) -> dict[str, str]:
    if set(fields) - FACT_FIELDS[group]:
        raise ValueError(f"unsupported {group} fields")
    fields = {key: value for key, value in fields.items() if value}
    for key, value in fields.items():
        if key == "date" or key.endswith("Date"):
            if value == "至今" and key == "endDate":
                continue
            if not re.fullmatch(r"[1-9][0-9]{3}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12][0-9]|3[01]))?)?", value):
                raise ValueError("dates require YYYY, YYYY-MM or YYYY-MM-DD")
            parts = [int(part) for part in value.split("-")]
            date(*([*parts, 1, 1][:3]))
        if key in {"gpa", "gpaScale", "score"} and not re.fullmatch(r"\d{1,5}(?:\.\d{1,4})?", value):
            raise ValueError("scores must be explicit non-negative decimal strings")
        if key in {"idNumber", "phone", "altPhone", "postcode", "studentNumber", "number"} and len(value) > 100:
            raise ValueError("identifier too long")
    start = fields.get("enrollDate", fields.get("startDate"))
    end = fields.get("gradDate", fields.get("endDate"))
    if start and end and end != "至今" and end[:min(len(start), len(end))] < start[:min(len(start), len(end))]:
        raise ValueError("end date precedes start date")
    if fields.get("gpaScale") and (Decimal(fields["gpaScale"]) <= 0 or fields.get("gpa") and Decimal(fields["gpa"]) > Decimal(fields["gpaScale"])):
        raise ValueError("GPA must not exceed its positive scale")
    return fields


class FactSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    resume_id: ResumeId
    # None means an additional record explicitly assigned to this resume by the user.
    index: int | None = Field(default=None, ge=0, le=500)
    fingerprint: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def paired_anchor(self):
        if (self.index is None) != (self.fingerprint is None):
            raise ValueError("index and fingerprint must be supplied together")
        return self


class ApplicationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    group: RecordGroup
    fields: dict[str, Fact] = Field(default_factory=dict, max_length=30)
    source: FactSource | None = None

    @model_validator(mode="after")
    def validate_fields(self):
        self.fields = clean_fields(self.group, self.fields)
        return self


class ApplicationData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    # Explicit user choice controls which resumes may use the basic/contact facts.
    resume_ids: list[ResumeId] = Field(default_factory=list, max_length=20)
    basics: dict[str, Fact] = Field(default_factory=dict, max_length=30)
    contact: dict[str, Fact] = Field(default_factory=dict, max_length=20)
    others: dict[str, Fact] = Field(default_factory=dict, max_length=10)
    records: list[ApplicationRecord] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_data(self):
        for group in ("basics", "contact", "others"):
            setattr(self, group, clean_fields(group, getattr(self, group)))
        if len(self.resume_ids) != len(set(self.resume_ids)) or len({r.id for r in self.records}) != len(self.records):
            raise ValueError("duplicate resume or record IDs")
        anchors = [(r.group, r.source.resume_id, r.source.index) for r in self.records if r.source and r.source.index is not None]
        if len(anchors) != len(set(anchors)):
            raise ValueError("duplicate source records")
        if len(json.dumps(self.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 65_536:
            raise ValueError("application data exceeds 64 KiB")
        return self


def fingerprint(fields: dict) -> str:
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def import_preview(profile: dict, resume_id: str, warnings: list[str] | None = None) -> ApplicationData:
    warnings = warnings if warnings is not None else []
    def safe_fields(group, item):
        result = {}
        for key, value in item.items():
            if key not in FACT_FIELDS[group]:
                continue
            try:
                if len(str(value)) > 4000:
                    raise ValueError("too long")
                result.update(clean_fields(group, {key: str(value)}))
            except ValueError:
                warnings.append(f"{group}.{key} 格式或长度不适合导入，已留空，请手动确认")
        # An explicit but internally inconsistent range is not a confirmed fact.
        try:
            return clean_fields(group, result)
        except ValueError:
            for key in ("enrollDate", "gradDate", "startDate", "endDate"):
                result.pop(key, None)
            for key in ("gpa", "gpaScale"):
                result.pop(key, None)
            warnings.append(f"{group} 日期或绩点范围不一致，已留空")
            return result
    records = []
    for group in ("education", "work", "internship", "projects", "languages", "certificates", "awards", "campus"):
        for index, item in enumerate(profile.get(group, [])):
            if not item:
                continue
            digest = fingerprint(item)
            if index > 500 or len(records) >= 100:
                warnings.append("经历数量超过导入上限，其余条目请手动整理")
                break
            records.append(ApplicationRecord(id=f"import_{resume_id}_{group}_{index}_{digest[:12]}", group=group,
                fields=safe_fields(group, item),
                source=FactSource(resume_id=resume_id, index=index, fingerprint=digest)))
    raw = {"resume_ids": [resume_id], "records": [record.model_dump(mode="json") for record in records], **{
        group: safe_fields(group, profile.get(group, {}))
        for group in ("basics", "contact", "others")}}
    while len(json.dumps(raw, ensure_ascii=False).encode("utf-8")) > 65_000 and raw["records"]:
        raw["records"].pop()
        warnings.append("导入资料超过64KiB，末尾经历未导入，请分批整理")
    return ApplicationData.model_validate(raw)


def merge_application(profile: dict, data: ApplicationData, resume_id: str, warnings: list[str]) -> None:
    """Supplement only confirmed matching records; conflict means leave the field blank."""
    def merge(target, fields, label):
        for key, value in fields.items():
            if key in target and str(target[key]).strip() != value:
                target.pop(key)
                warnings.append(f"{label}.{key} 与简历不一致，未用于自动填写")
            else:
                target[key] = value

    if resume_id in data.resume_ids:
        source_name = profile.get("basics", {}).get("name")
        if source_name and data.basics.get("name") and source_name != data.basics["name"]:
            profile["basics"].pop("name", None)
            warnings.append("画像姓名与所选简历不一致，网申资料暂停使用，请确认身份对应关系")
            return
        else:
            for group in ("basics", "contact", "others"):
                merge(profile.setdefault(group, {}), getattr(data, group), group)
    originals = {group: [fingerprint(item) for item in items] for group, items in profile.items() if isinstance(items, list)}
    primary_fields = {"education": ["school"], "work": ["company"], "internship": ["company"], "projects": ["name"],
                      "languages": ["language", "cert"], "certificates": ["name"], "awards": ["title"], "campus": ["organization", "name"]}
    for record in data.records:
        source = record.source
        if not source or source.resume_id != resume_id or not record.fields:
            continue
        entries = profile.setdefault(record.group, [])
        if source.index is None:
            if not any(record.fields.get(key) for key in primary_fields[record.group]):
                warnings.append(f"{record.group} 补充条目缺少明确的学校、单位或名称，未用于自动填写")
                continue
            entries.append(dict(record.fields))
        elif originals.get(record.group, []).count(source.fingerprint) > 1:
            warnings.append(f"{record.group}.{source.index} 来源条目重复、对应不明确，未用于自动填写")
        elif source.index >= len(originals.get(record.group, [])) or originals[record.group][source.index] != source.fingerprint:
            warnings.append(f"{record.group}.{source.index} 资料对应的简历条目已变化，请重新导入并确认")
        else:
            merge(entries[source.index], record.fields, f"{record.group}.{source.index}")
