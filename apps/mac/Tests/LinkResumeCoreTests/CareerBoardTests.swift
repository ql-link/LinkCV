import Foundation
import Testing
@testable import LinkResumeCore

private func raw(_ source: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(source.utf8))
}

private let utc: Calendar = { var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "UTC")!; return calendar }()

@Test func boardCardCopyFollowsWebProjection() throws {
    let now = CareerApplication.date("2030-01-05T08:00:00Z")!
    let pending = try raw(#"{"status":"active","phase":"pending","current_stage_type":"screening","current_stage_label":"待投递","created_at":"2030-01-02T03:04:00Z"}"#)
    #expect(CareerBoard.cardStatus(pending, completed: false, now: now) == "等待确认投递")
    #expect(CareerBoard.cardTime(pending, calendar: utc) == "创建于 1月2日 03:04")

    let today = try raw(#"{"status":"active","phase":"applied","current_stage":{"id":"1","stage_type":"interview","stage_label":"技术二面"},"current_stage_type":"interview","stage_state":"scheduled","next_session_start_at":"2030-01-05T10:00:00Z","next_session_end_at":"2030-01-05T11:00:00Z"}"#)
    #expect(CareerBoard.cardStatus(today, completed: false, now: now) == "2 小时后")
    #expect(CareerBoard.today(today, now: now, calendar: utc) == "今天 10:00")
    #expect(CareerBoard.cardTime(today, calendar: utc) == "1月5日 10:00–11:00")
    #expect(CareerBoard.tone(today, completed: false, now: now) == .blue)
    #expect(CareerBoard.progressLabel(today, completed: false, now: now) == "技术二面 · 2 小时后")

    let later = CareerApplication.date("2030-01-05T12:00:00Z")!
    #expect(CareerBoard.cardStatus(today, completed: false, now: later) == "等待结果")
    #expect(CareerBoard.tone(today, completed: false, now: later) == .orange)
    #expect(CareerBoard.cardStatus(today, completed: true, now: later) == "已完成")
    #expect(CareerBoard.tone(today, completed: true, now: later) == .green)

    let rejected = try raw(#"{"status":"rejected","lifecycle_status":"terminated","termination_reason":"company_rejected","current_stage":{"stage_type":"interview","stage_label":"一面"}}"#)
    #expect(CareerBoard.cardStatus(rejected, completed: false, now: now) == "结束阶段：一面")
    #expect(CareerBoard.progressLabel(rejected, completed: false, now: now) == "一面 · 未通过")
    #expect(CareerBoard.tone(rejected, completed: false, now: now) == .red)

    let oc = try raw(#"{"status":"active","phase":"applied","current_stage":{"stage_type":"oc","stage_label":"OC"},"current_stage_type":"oc","offer_status":"none"}"#)
    #expect(CareerBoard.cardStatus(oc, completed: false, now: now) == "口头意向")
    #expect(CareerBoard.tone(oc, completed: false, now: now) == .green)
}

@Test func acceptedOfferStaysInOfferColumn() throws {
    let accepted = CareerApplication(try raw(#"{"id":"1","status":"closed","current_stage_type":"offer","offer_status":"accepted"}"#))
    #expect(accepted.column == "offer")
    #expect(!accepted.movable)
    #expect(CareerBoard.cardStatus(accepted.raw, completed: false) == "已收到 Offer")
}

@Test func relativeDayMatchesListCopy() {
    let now = CareerApplication.date("2030-01-05T08:00:00Z")!
    #expect(CareerBoard.relativeDay("2030-01-05T07:05:00Z", now: now, calendar: utc) == "今天 07:05")
    #expect(CareerBoard.relativeDay("2030-01-04T07:05:00Z", now: now, calendar: utc) == "昨天 07:05")
    #expect(CareerBoard.relativeDay("2029-12-24T07:05:00Z", now: now, calendar: utc) == "12月24日")
}
