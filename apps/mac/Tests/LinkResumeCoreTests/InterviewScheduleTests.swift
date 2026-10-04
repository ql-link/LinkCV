import Foundation
import Testing
@testable import LinkResumeCore

private func appointment(_ id: String, _ start: String, _ end: String, status: String = "scheduled", window: Bool = false) -> ScheduledInterview {
    ScheduledInterview(.object(["id": .string(id), "start_at": .string(start), "end_at": .string(end), "status": .string(status), "schedule_kind": .string(window ? "open_window" : "fixed_slot")]))
}
@Test func monthCalendarUsesActualFourFiveOrSixWeeksAndMondayStart() {
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
    for (year, month, expected) in [(2021, 2, 28), (2026, 10, 35), (2026, 3, 42)] {
        let date = calendar.date(from: DateComponents(year: year, month: month, day: 15))!
        let days = ScheduleCalendar.monthDays(date, calendar: calendar)
        #expect(days.count == expected); #expect(calendar.component(.weekday, from: days[0]) == 2)
        #expect(Set(days).count == expected)
        #expect(days.filter { calendar.component(.month, from: $0) == month }.count == calendar.range(of: .day, in: .month, for: date)!.count)
    }
}
@Test func monthCalendarPreservesLocalMidnightAcrossDaylightSaving() {
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/New_York")!
    let days = ScheduleCalendar.monthDays(calendar.date(from: DateComponents(year: 2026, month: 3, day: 15))!, calendar: calendar)
    #expect(days.allSatisfy { calendar.component(.hour, from: $0) == 0 })
    #expect(zip(days, days.dropFirst()).contains { $1.timeIntervalSince($0) == 23 * 3600 })
}
@Test func scheduleConflictsUseHalfOpenIntervalsAndIgnoreCancelledAndWindows() {
    let from = CareerApplication.date("2030-01-01T10:00:00Z")!, until = from.addingTimeInterval(3600)
    let a = appointment("1", "2030-01-01T09:00:00Z", "2030-01-01T10:00:00Z")
    let b = appointment("2", "2030-01-01T10:30:00Z", "2030-01-01T11:30:00Z")
    let c = appointment("3", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", status: "cancelled")
    let d = appointment("4", "2030-01-01T00:00:00Z", "2030-01-02T00:00:00Z", window: true)
    #expect(ScheduleCalendar.conflicts([a,b,c,d], excluding: nil, start: from, end: until).map(\.id) == ["2"])
    #expect(ScheduleCalendar.conflicts([a,b,c,d], excluding: "2", start: from, end: until).isEmpty)
    #expect(!a.overlaps(from, until))
}
@Test func overlappingEventsUseIndependentLanesAndNextArrangementsUseWindowDeadline() {
    let a = appointment("1", "2030-01-01T09:00:00Z", "2030-01-01T10:00:00Z")
    let b = appointment("2", "2030-01-01T09:30:00Z", "2030-01-01T10:30:00Z")
    let c = appointment("3", "2030-01-01T10:30:00Z", "2030-01-01T11:30:00Z")
    let lanes = ScheduleCalendar.lanes([c,b,a])
    #expect(lanes["1"]?.count == 2); #expect(lanes["2"]?.index == 1); #expect(lanes["3"]?.count == 1)
    let window = appointment("4", "2029-12-31T09:00:00Z", "2030-01-02T10:00:00Z", window: true)
    #expect(ScheduleCalendar.upcoming([window,c,a,b], now: CareerApplication.date("2030-01-01T08:00:00Z")!).map(\.id) == ["1","2","3"])
}
@Test func desktopSessionEditingHasNarrowMethodBoundary() {
    #expect(CareerRequest.allowed(path: "/api/interview-sessions/12", method: "PUT"))
    // Stage detail (04.C03) deletes a session; the backend keeps ownership checks.
    #expect(CareerRequest.allowed(path: "/api/interview-sessions/12", method: "DELETE"))
    #expect(!CareerRequest.allowed(path: "/api/interview-sessions/12", method: "POST"))
    #expect(!CareerRequest.allowed(path: "/api/interview-sessions/12", method: "PATCH"))
}

@Test func openWindowPersonalPlanProjectsWithoutChangingOfficialDates() {
    let official = ScheduledInterview(.object(["id": .string("9"), "schedule_kind": .string("open_window"), "start_at": .string("2030-01-01T00:00:00Z"), "end_at": .string("2030-01-05T00:00:00Z"), "answer_plan_start_at": .string("2030-01-02T10:00:00Z"), "answer_plan_end_at": .string("2030-01-02T11:00:00Z")]))
    #expect(official.timed?.start == CareerApplication.date("2030-01-02T10:00:00Z"))
    #expect(official.start == CareerApplication.date("2030-01-01T00:00:00Z"))
    #expect(official.timed?.id == official.id)
    #expect(appointment("1", "2030-01-01T00:00:00Z", "2030-01-05T00:00:00Z", window: true).timed == nil)
}
