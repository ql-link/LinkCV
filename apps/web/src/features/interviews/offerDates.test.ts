import { describe, expect, it } from "vitest";
import { offerDeadline, parseOfferDate } from "./offerDates";

describe("Offer calendar dates", () => {
  it("keeps the exact calendar date without UTC conversion", () => {
    const date = parseOfferDate("2026-10-03")!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 3]);
  });
  it.each([null, undefined, "2026-02-30", "2026-10-03T00:00:00Z", "0001-01-01"])("does not invent a deadline for %s", value => {
    expect(offerDeadline(value, new Date())).toBeNull();
  });
  it.each([
    [new Date(2026, 9, 2, 23, 59), 1, "还有 1 天回复"],
    [new Date(2026, 9, 3, 23, 59), 0, "今天截止"],
    [new Date(2026, 9, 4, 0, 1), -1, "回复截止已过 1 天"],
  ])("uses whole calendar days at %s", (now, daysLeft, label) => {
    expect(offerDeadline("2026-10-03", now)).toMatchObject({ daysLeft, label });
  });
});
