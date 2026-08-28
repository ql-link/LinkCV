"""Pure Python compiler for the v1 canonical resume layout plan.

Templates describe where semantic kinds may render.  The compiler makes the
single routing decision for each top-level canonical node and emits a closed
``LayoutPlan``.  It never mutates the canonical document or calculates its
content digest in a frontend-specific way.
"""

from __future__ import annotations

from collections import defaultdict

from linkcv.domain.resume.models import (
    CanonicalResumeDocument,
    LayoutNode,
    LayoutPlan,
    LayoutRegion,
    ResumePresentation,
    TemplateDefinition,
    TemplateSlot,
    validate_layout_coverage,
)


class LayoutCompilationError(ValueError):
    """A template cannot safely host every top-level canonical node."""


def _select_slot(
    semantic_kind: str,
    slots: list[TemplateSlot],
) -> TemplateSlot:
    explicit = [
        slot
        for slot in slots
        if not slot.universal_fallback and semantic_kind in slot.accepts
    ]
    if len(explicit) > 1:
        # TemplateDefinition normally rejects this.  Keep the compiler
        # defensive for objects assembled by tests or trusted adapters.
        raise LayoutCompilationError(
            f"semantic kind {semantic_kind!r} has multiple explicit slots"
        )
    if explicit:
        return explicit[0]
    fallback = [slot for slot in slots if slot.universal_fallback]
    if len(fallback) != 1 or semantic_kind not in fallback[0].accepts:
        raise LayoutCompilationError(
            f"template has no slot for semantic kind {semantic_kind!r}"
        )
    return fallback[0]


def compile_layout_plan(
    document: CanonicalResumeDocument,
    template: TemplateDefinition,
    presentation: ResumePresentation | None = None,
) -> LayoutPlan:
    """Compile a deterministic layout assignment for ``document``.

    ``presentation`` is accepted for callers that already carry the complete
    render context.  It is intentionally not read for routing: portable and
    template-scoped user settings affect rendering metrics, never semantic
    ownership or source ordering.
    """

    if presentation is not None:
        if presentation.template_snapshot.template_key != template.template_key:
            raise LayoutCompilationError(
                "presentation snapshot does not match the selected template"
            )

    region_by_id = {region.region_id: region for region in template.regions}
    if len(region_by_id) != len(template.regions):
        raise LayoutCompilationError("template region ids must be unique")
    slots_by_region: dict[str, list[TemplateSlot]] = defaultdict(list)
    slots_by_id: dict[str, TemplateSlot] = {}
    for slot in template.slots:
        if slot.slot_id in slots_by_id:
            raise LayoutCompilationError("template slot ids must be unique")
        if slot.region_id not in region_by_id:
            raise LayoutCompilationError("template slot references an unknown region")
        slots_by_id[slot.slot_id] = slot
        slots_by_region[slot.region_id].append(slot)
    for slots in slots_by_region.values():
        slots.sort(key=lambda slot: (slot.order, slot.slot_id))

    # Canonical order is identity first, then the sections exactly as stored.
    # Children are intentionally not top-level layout nodes: their order is
    # owned by the canonical section renderer.
    top_level: list[tuple[str, str]] = [
        (document.identity.node_id, "identity"),
        *[(section.node_id, section.semantic_kind) for section in document.sections],
    ]
    region_nodes: dict[str, list[LayoutNode]] = defaultdict(list)
    for node_id, semantic_kind in top_level:
        slot = _select_slot(semantic_kind, template.slots)
        region_nodes[slot.region_id].append(
            LayoutNode(
                node_id=node_id,
                semantic_kind=semantic_kind,
                slot_id=slot.slot_id,
            )
        )

    regions = [
        LayoutRegion(
            region_id=region.region_id,
            order=region.order,
            nodes=region_nodes.get(region.region_id, []),
        )
        for region in sorted(
            template.regions, key=lambda value: (value.order, value.region_id)
        )
    ]
    plan = LayoutPlan(
        schema_version="layout-plan.v1",
        content_sha256=document.content_sha256(),
        template_key=template.template_key,
        regions=regions,
    )
    try:
        validate_layout_coverage(document, template, plan)
    except (TypeError, ValueError) as error:
        raise LayoutCompilationError(str(error)) from error
    return plan


# Friendly aliases for adapters that use the noun-first naming convention.
compile_resume_layout = compile_layout_plan
build_layout_plan = compile_layout_plan
compile_template_layout = compile_layout_plan


__all__ = [
    "LayoutCompilationError",
    "build_layout_plan",
    "compile_layout_plan",
    "compile_resume_layout",
    "compile_template_layout",
]
