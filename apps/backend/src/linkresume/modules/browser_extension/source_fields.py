"""Read explicit, compact source headers when optional import annotations are absent.

This projection never edits the canonical document or asks a model to invent
facts. Unrecognized entries remain empty so later entries cannot shift forward.
"""
import re


_MONTH = r"\d{4}[./-]\d{1,2}(?:[./-]\d{1,2})?"
_RANGE = re.compile(rf"^({_MONTH})\s*[-–—~～至]\s*({_MONTH}|至今|现在|Present)$", re.I)
_SCHOOL = re.compile(r"^(.{2,60}?(?:大学|学院|学校|University|College))(?=$|\s|[-–—])", re.I)
_EMPLOYER = re.compile(r"^.{2,80}(?:公司|集团|研究院|研究所|事务所|医院|大学|学院)$")
_CAREER_TITLE = re.compile(r"工程师|开发|实习生|设计师|求职|应聘|产品经理|运营|分析师")


def person_name(value):
    """Split only an explicit Chinese name / career-title header."""
    match = re.fullmatch(r"([\u4e00-\u9fff]{2,4})\s*[-—|｜]\s*(.{2,80})", value)
    return match[1] if match and _CAREER_TITLE.search(match[2]) else value


def _header(raw, group, parse_date):
    parts = [part.strip() for part in re.split(r"[|｜]", raw)]
    if not 2 <= len(parts) <= 3 or len(raw) > 240:
        return None
    dates = [(i, match) for i, part in enumerate(parts) if (match := _RANGE.fullmatch(part))]
    if len(dates) != 1:
        return None
    index, match = dates[0]
    if index == 0:
        return None
    start, end = (parse_date({"value": match[i]}) for i in [1, 2])
    # An apparent entry with invalid dates still occupies its original position.
    if not start or not end:
        return {}
    if group == "education":
        school = _SCHOOL.match(parts[0])
        if not school:
            return {}
        item = {"school": school[1], "enrollDate": start, "gradDate": end}
        rest = parts[0][school.end():].strip(" -–—")
        major_parts = [part.strip() for part in re.split(r"\s*[-–—]\s*", rest) if part.strip()]
        if len(parts) == 3 and index == 2:
            major_parts = [parts[1]]
        # College/faculty names are not majors; keep only an explicit trailing major.
        if major_parts and not re.search(r"学院$|学部$|系$", major_parts[-1]):
            item["major"] = major_parts[-1]
        return item
    if group in {"work", "internship"}:
        if not _EMPLOYER.fullmatch(parts[0]):
            return {}
        item = {"company": parts[0], "startDate": start, "endDate": end}
        roles = [part for i, part in enumerate(parts) if i not in {0, index}]
        if len(roles) == 1 and 1 < len(roles[0]) <= 80:
            item["title"] = roles[0]
        return item
    return None


def recover_entries(section, group, block_text, parse_date):
    blocks = section.get("blocks", [])
    if group == "projects":
        # A compact leading project title is usable; a flattened body may mix
        # several projects, so never attribute its descriptions or dates here.
        if not blocks or blocks[0].get("block_type") != "paragraph":
            return []
        raw = block_text([blocks[0]]).strip()
        explicit = re.fullmatch(r"项目名称\s*[:：]\s*(.{1,80})", raw)
        if explicit:
            return [{"name": explicit[1]}]
        next_text = block_text(blocks[1:2])
        if (re.fullmatch(r"[\w\u4e00-\u9fff][\w\u4e00-\u9fff .+()-]{1,47}", raw)
                and not re.search(r"描述|介绍|负责|参与|基于|使用|开发了", raw)
                and re.match(r"(?:技术架构|项目描述|项目介绍)\s*[:：]", next_text)):
            return [{"name": raw}]
        return []
    if group not in {"education", "work", "internship"}:
        return []
    entries = []
    current = None
    body = []

    def finish():
        if current and group in {"work", "internship"} and body:
            current["summary"] = block_text(body)

    for block in blocks:
        raw = block_text([block]).strip()
        item = _header(raw, group, parse_date) if block.get("block_type") in {"paragraph", "row"} else None
        if item is not None:
            finish()
            current, body = item, []
            entries.append(item)
        elif current is not None:
            body.append(block)
    finish()
    return entries if any(entries) else []
