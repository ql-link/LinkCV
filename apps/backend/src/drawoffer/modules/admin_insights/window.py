"""Time windows and aggregate arithmetic shared by every admin insight."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Iterable

from drawoffer.core.errors import ApiError

QUERY_ERROR = "INVALID_ADMIN_INSIGHTS_QUERY"
MAX_WINDOW = timedelta(days=31)
FINISHED = ("succeeded", "failed", "cancelled")


def utcnow() -> datetime:
    return datetime.now(UTC)


def aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)


@dataclass(frozen=True)
class Window:
    start: datetime
    end: datetime

    @property
    def previous(self) -> "Window":
        span = self.end - self.start
        return Window(self.start - span, self.start)


def resolve_window(
    from_at: datetime | None,
    to_at: datetime | None,
    *,
    default: timedelta,
    now: datetime | None = None,
) -> Window:
    end = to_at or now or utcnow()
    start = from_at or end - default
    if start.tzinfo is None or end.tzinfo is None or start >= end or end - start > MAX_WINDOW:
        raise ApiError(400, QUERY_ERROR)
    return Window(start, end)


def success_rate(succeeded: int, finished: int) -> float | None:
    """Share of finished calls that succeeded; pending calls are never in ``finished``."""
    if finished <= 0:
        return None
    return round(succeeded / finished, 4)


def percentile_95(values: Iterable[int | float | None]) -> int | None:
    samples = sorted(v for v in values if v is not None)
    if not samples:
        return None
    index = int(0.95 * (len(samples) - 1))
    return int(samples[index])


def delta(current: float | int | Decimal | None, previous: float | int | Decimal | None) -> str | None:
    """Relative change as a decimal string; ``None`` when there is no baseline."""
    if current is None or previous is None or previous == 0:
        return None
    return str(round((Decimal(str(current)) - Decimal(str(previous))) / Decimal(str(previous)), 4))


def costs(rows: Iterable[tuple[str | None, Decimal | None]]) -> dict[str, object]:
    """Sum costs per currency and count calls without a cost figure."""
    totals: dict[str, Decimal] = defaultdict(Decimal)
    unmetered = 0
    for currency, amount in rows:
        if amount is None or currency is None:
            unmetered += 1
            continue
        totals[currency] += Decimal(amount)
    return {
        "costs": [
            {"currency": currency, "amount": str(amount)}
            for currency, amount in sorted(totals.items())
        ],
        "unmeteredCallCount": unmetered,
    }


def primary_cost(summary: dict[str, object]) -> Decimal | None:
    """First currency amount, used only to compute a comparable delta."""
    entries = summary["costs"]
    if not entries:
        return None
    return Decimal(entries[0]["amount"])  # type: ignore[index]


def day_series(end: datetime, days: int) -> list[date]:
    last = end.astimezone(UTC).date()
    return [last - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


def day_of(value: datetime | str | date) -> date:
    if isinstance(value, datetime):
        return aware(value).astimezone(UTC).date()  # type: ignore[union-attr]
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])
