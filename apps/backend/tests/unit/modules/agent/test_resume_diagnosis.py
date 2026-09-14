from linkresume.modules.agent.resume_tools import diagnose_content


def test_qualitative_delivery_is_result_evidence_without_forced_number() -> None:
    diagnosis = diagnose_content(
        "负责构建内部发布流程并完成上线交付",
        {"entry_id": "node_entry00000000001"},
        None,
    )

    assert diagnosis["quantification"]["has_result_metric"] is False
    assert diagnosis["quantification"]["has_qualitative_result"] is True
    assert all(
        issue["code"] != "MISSING_RESULT_EVIDENCE"
        for issue in diagnosis["issues"]
    )


def test_missing_action_and_result_reports_real_gaps_at_medium_severity() -> None:
    diagnosis = diagnose_content(
        "内部平台相关工作",
        {"entry_id": "node_entry00000000001"},
        None,
    )

    assert {item["code"] for item in diagnosis["issues"]} == {
        "MISSING_ACTION",
        "MISSING_RESULT_EVIDENCE",
    }
    assert {item["severity"] for item in diagnosis["issues"]} == {"medium"}
