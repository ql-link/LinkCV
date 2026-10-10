from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from drawoffer.core.errors import ApiError
from drawoffer.modules.admin_insights.window import (
    costs,
    day_series,
    delta,
    percentile_95,
    resolve_window,
    success_rate,
)

NOW = datetime(2026, 9, 28, 12, tzinfo=UTC)


def test_default_window_and_previous_window() -> None:
    window = resolve_window(None, None, default=timedelta(hours=24), now=NOW)
    assert window.start == NOW - timedelta(hours=24)
    assert window.previous.end == window.start
    assert window.previous.start == NOW - timedelta(hours=48)


@pytest.mark.parametrize(
    ("start", "end"),
    [
        (NOW, NOW),
        (NOW, NOW - timedelta(minutes=1)),
        (NOW - timedelta(days=32), NOW),
        (datetime(2026, 9, 27), NOW),
    ],
)
def test_invalid_windows(start, end) -> None:
    with pytest.raises(ApiError) as error:
        resolve_window(start, end, default=timedelta(hours=1))
    assert error.value.code == "INVALID_ADMIN_INSIGHTS_QUERY"


def test_rates_percentiles_and_deltas_handle_empty_baselines() -> None:
    assert success_rate(0, 0) is None
    assert success_rate(3, 4) == 0.75
    assert percentile_95([]) is None
    assert percentile_95([None, None]) is None
    assert percentile_95(range(1, 101)) == 95
    assert percentile_95([7]) == 7
    assert delta(5, 0) is None
    assert delta(None, 3) is None
    assert delta(15, 10) == "0.5000"


def test_costs_are_grouped_by_currency_and_count_unmetered() -> None:
    summary = costs([
        ("USD", Decimal("0.1")), ("USD", Decimal("0.2")), ("CNY", Decimal("1")),
        (None, None), ("USD", None),
    ])
    assert summary == {
        "costs": [{"currency": "CNY", "amount": "1"}, {"currency": "USD", "amount": "0.3"}],
        "unmeteredCallCount": 2,
    }


def test_day_series_ends_today_in_utc() -> None:
    days = day_series(NOW, 3)
    assert [d.isoformat() for d in days] == ["2026-09-26", "2026-09-27", "2026-09-28"]
