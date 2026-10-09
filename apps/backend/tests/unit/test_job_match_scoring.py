from __future__ import annotations

from linkresume.application.job_matches.prefilter import prefilter_score, resume_profile
from linkresume.application.job_matches.scoring import score_analysis, summarize
from linkresume.modules.job_matches.schemas import MatchAnalysis

JOB = "负责分布式系统开发，需要 Kubernetes 经验，熟悉 Go"
RESUME = "# 张三\n- 熟悉分布式系统设计与调优\n- 使用 Go 开发过消息系统"


def analysis(*requirements: dict[str, object]) -> MatchAnalysis:
    return MatchAnalysis.model_validate({"requirements": list(requirements)})


def requirement(text: str, importance: str, coverage: str, **extra: object) -> dict[str, object]:
    return {"text": text, "importance": importance, "coverage": coverage, **extra}


def test_score_is_the_weighted_share_of_covered_requirements() -> None:
    scored = score_analysis(
        analysis(
            requirement("分布式系统", "must", "covered", evidence="熟悉分布式系统设计与调优"),
            requirement("会用 Go", "important", "partial", evidence="使用 Go 开发过消息系统"),
            requirement("Kubernetes", "must", "missing"),
        ),
        JOB,
        RESUME,
    )
    # (3×1 + 2×0.5 + 3×0) / 8 = 0.5
    assert scored.score == 50


def test_unverifiable_evidence_counts_as_missing() -> None:
    scored = score_analysis(
        analysis(
            requirement("分布式系统", "must", "covered", evidence="熟悉分布式系统设计与调优"),
            requirement("Kubernetes", "must", "covered", evidence="精通 Kubernetes 集群运维"),
            requirement("消息队列", "nice", "covered"),
        ),
        JOB,
        RESUME,
    )
    covers = {item["text"]: item["coverage"] for item in scored.result["requirements"]}
    assert covers == {"分布式系统": "covered", "Kubernetes": "missing", "消息队列": "missing"}
    assert scored.score == round(100 * 3 / 7)


def test_evidence_matches_across_markdown_and_whitespace() -> None:
    scored = score_analysis(
        analysis(
            requirement("分布式", "must", "covered", evidence="熟悉 分布式系统设计 与调优"),
            requirement("Go", "must", "covered", evidence="- 使用 Go 开发过消息系统"),
            requirement("其他", "nice", "missing"),
        ),
        JOB,
        RESUME,
    )
    assert [item["verified"] for item in scored.result["requirements"]] == [True, True, False]


def test_highlight_terms_must_appear_in_the_job_and_missing_wins() -> None:
    scored = score_analysis(
        analysis(
            requirement(
                "分布式系统",
                "must",
                "covered",
                evidence="熟悉分布式系统设计与调优",
                terms=["分布式系统", "不存在的词", "Go"],
            ),
            requirement("Kubernetes", "must", "missing", terms=["kubernetes", "Go"]),
            requirement("其他", "nice", "missing"),
        ),
        JOB,
        RESUME,
    )
    assert scored.result["highlights"] == {
        "covered": ["分布式系统"],
        "missing": ["kubernetes", "Go"],
    }


def test_summary_headline_is_the_heaviest_missing_requirement() -> None:
    scored = score_analysis(
        analysis(
            requirement("加分项缺失", "nice", "missing"),
            requirement("必须项缺失", "must", "missing"),
            requirement("分布式系统", "important", "covered", evidence="熟悉分布式系统设计与调优"),
        ),
        JOB,
        RESUME,
    )
    headline, hits, gaps = summarize(scored.result)
    assert headline == "必须项缺失"
    assert hits == ["分布式系统"]
    assert gaps == ["加分项缺失", "必须项缺失"]


def test_prefilter_ranks_skill_overlap_above_unrelated_jobs() -> None:
    profile = resume_profile(RESUME)
    related = prefilter_score(
        profile, title="后端开发", description="分布式系统与消息系统", skills=["Go", "分布式系统"]
    )
    unrelated = prefilter_score(
        profile, title="UI 设计师", description="负责视觉与品牌设计", skills=["Figma", "Sketch"]
    )
    assert related > unrelated
    assert 0 <= unrelated <= related <= 1
