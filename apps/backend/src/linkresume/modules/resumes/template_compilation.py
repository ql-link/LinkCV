"""模板快照校验与布局编译的内容寻址缓存。

模板在库里是静态数据,但每次请求都要把全部启用模板重新校验一遍并重算布局方案;
目录越大,这块成本越明显。校验和编译都只取决于 data_json 与 style_json,
所以按两者的规范化 JSON 做缓存键:模板被改写后键自然变化,不存在过期结果。
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from linkresume.application.resumes.service import (
    StoredTemplateSnapshot,
    parse_persisted_template_snapshot,
)
from linkresume.domain.resume import LayoutPlan, compile_layout_plan

# 目录规模是有界的(当前不到 100 套),留出余量覆盖管理员导入后被停用的模板。
TEMPLATE_COMPILATION_CACHE_SIZE = 256


def _canonical_json(value: Any) -> str:
    """把数据库返回的 JSON 值规范成稳定的缓存键。"""

    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def validated_template_snapshot(data_json: Any, style_json: Any) -> StoredTemplateSnapshot:
    """校验模板快照。解析失败保持抛出 TypeError/ValueError。"""

    return _validated_snapshot(_canonical_json(data_json), _canonical_json(style_json))


def compiled_template_layout_plan(data_json: Any, style_json: Any) -> LayoutPlan:
    """编译模板布局方案。编译失败保持抛出 LayoutCompilationError。"""

    return _compiled_layout_plan(_canonical_json(data_json), _canonical_json(style_json))


@lru_cache(maxsize=TEMPLATE_COMPILATION_CACHE_SIZE)
def _validated_snapshot(data_json: str, style_json: str) -> StoredTemplateSnapshot:
    return parse_persisted_template_snapshot(data_json, style_json)


@lru_cache(maxsize=TEMPLATE_COMPILATION_CACHE_SIZE)
def _compiled_layout_plan(data_json: str, style_json: str) -> LayoutPlan:
    snapshot = _validated_snapshot(data_json, style_json)
    return compile_layout_plan(snapshot.data, snapshot.style)
