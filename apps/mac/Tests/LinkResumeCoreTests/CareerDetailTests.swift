import Foundation
import Testing
@testable import LinkResumeCore

private func json(_ source: String) throws -> JSONValue { try JSONDecoder().decode(JSONValue.self, from: Data(source.utf8)) }
private var shanghai: Calendar { var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!; return calendar }
private let now = ISO8601DateFormatter().date(from: "2030-10-06T02:00:00Z")!

private let scheduledApplication = #"""
{"id":"7","status":"active","lifecycle_status":"active","phase":"applied","archived_at":null,"stage_state":"scheduled",
 "current_stage_type":"interview","current_stage_label":"一面 · 技术基础","current_round_no":1,"offer_status":"none",
 "applied_at":"2030-09-28T02:00:00Z","applied_channel":"同事内推","resume_title_snapshot":"Backend_v3.pdf","created_at":"2030-09-27T02:00:00Z","updated_at":"2030-10-05T02:00:00Z",
 "current_stage":{"id":"13","stage_type":"interview","stage_label":"一面 · 技术基础"},
 "stages":[
  {"id":"11","sequence_no":1,"stage_type":"screening","stage_label":"筛选中","stage_result":"passed","entered_at":"2030-09-28T02:00:00Z","completed_at":"2030-09-30T02:00:00Z"},
  {"id":"12","sequence_no":2,"stage_type":"written_test","stage_label":"技术笔试","stage_result":"passed","entered_at":"2030-09-30T02:00:00Z","completed_at":"2030-10-05T02:00:00Z"},
  {"id":"13","sequence_no":3,"stage_type":"interview","stage_label":"一面 · 技术基础","stage_result":"pending","current_marker":1,"entered_at":"2030-10-05T02:00:00Z"}]}
"""#
private let sessions = #"""
[{"id":"31","application_id":"7","application_stage_id":"13","status":"scheduled","stage_type":"interview","stage_label":"一面 · 技术基础","round_no":1,
  "start_at":"2030-10-08T06:00:00Z","end_at":"2030-10-08T07:00:00Z","mode":"video","interviewer_name":"李老师","schedule_kind":"fixed_slot"},
 {"id":"30","application_id":"7","application_stage_id":"12","status":"completed","stage_type":"other","stage_label":"技术笔试",
  "start_at":"2030-10-04T12:10:00Z","end_at":"2030-10-04T13:25:00Z","mode":"other","schedule_kind":"fixed_slot"}]
"""#

@Test func scheduledInterviewProjectsDateTileAndRecordAction() throws {
    let model = CareerDetailModel(application: try json(scheduledApplication), sessions: try json(sessions).items, now: now, calendar: shanghai)
    #expect(model.steps.map(\.label) == ["已投递", "筛选", "技术笔试", "一面 · 技术基础", "下一阶段"])
    #expect(model.steps.map(\.state) == [.done, .done, .done, .current, .next])
    #expect(model.steps[1].meta == "09.30 · 已通过")
    #expect(model.steps[3].meta == "10.08")
    guard case .date(let head, let day, let foot) = model.next.tile else { Issue.record("expected a date tile"); return }
    #expect(head == "10月 · 周二" && day == "8" && foot == "14:00")
    #expect(model.next.chips.map(\.label) == ["一面 · 技术基础", "已安排", "还有 2 天"])
    #expect(model.next.detail == "10.08 14:00–15:00 · 视频面试 · 面试官 李老师")
    #expect(model.next.primary?.action == .recordReview)
    #expect(model.next.secondary.map(\.action) == [.reschedule, .cancelSession])
    #expect(model.next.accent == .blue)
    #expect(model.currentSession?.text("id") == "31")
    #expect(model.history.map(\.title) == ["一面 · 技术基础", "技术笔试", "简历筛选", "提交投递"])
    #expect(model.history[0].highlight == .blue && model.history[0].sessionID == "31")
    #expect(model.history[1].detail == "10.04 20:10–21:25 完成")
    #expect(model.history[3].detail == "同事内推 · Backend_v3.pdf")
    #expect(model.deliveryRows.map(\.value) == ["09.28", "同事内推", "Backend_v3.pdf"])
    #expect(model.headerMeta == "已投递 8 天")
}

@Test func elapsedSessionWaitsForResultWithoutManualCompletion() throws {
    let later = ISO8601DateFormatter().date(from: "2030-10-09T02:00:00Z")!
    let model = CareerDetailModel(application: try json(scheduledApplication), sessions: try json(sessions).items, now: later, calendar: shanghai)
    #expect(model.next.title == "一面 · 技术基础已结束，等待面试结果")
    #expect(model.next.primary?.action == .advance)
    #expect(model.steps[3].meta == "10.08 · 已面完")
    #expect(model.history[0].chip == CareerChip("等待结果", .orange))
    #expect(model.latestRecorded?.text("id") == "31")
}

@Test func pendingVerbalAndReceivedOfferStates() throws {
    let pending = CareerDetailModel(application: try json(#"{"id":"1","status":"active","lifecycle_status":"active","phase":"pending","archived_at":null,"current_stage_type":"screening","current_stage_label":"待投递","offer_status":"none","created_at":"2030-10-01T02:00:00Z","stages":[]}"#), sessions: [], now: now, calendar: shanghai)
    #expect(pending.pending && pending.steps.count == 5 && pending.next.primary?.action == .recordApplied)
    #expect(pending.deliveryRows[0].value == "未投递")

    let oc = try json(#"{"id":"2","status":"active","lifecycle_status":"active","phase":"applied","archived_at":null,"current_stage_type":"offer","current_stage_label":"OC","offer_status":"none","applied_at":"2030-09-01T02:00:00Z","oc_communicated_at":"2030-10-02T02:00:00Z","oc_salary_text":"30K × 15","current_stage":{"id":"5","stage_type":"oc","stage_label":"OC"},"stages":[{"id":"5","sequence_no":1,"stage_type":"oc","stage_label":"OC","current_marker":1,"entered_at":"2030-10-02T02:00:00Z"}]}"#)
    let verbal = CareerDetailModel(application: oc, sessions: [], now: now, calendar: shanghai)
    #expect(verbal.verbalOffer && verbal.next.primary?.action == .recordOffer)
    #expect(verbal.offerCard?.title == "口头意向")
    #expect(verbal.history[0].title == "OC · 口头意向" && verbal.history[0].detail == "口头薪酬 30K × 15")

    let received = try json(#"{"id":"3","status":"active","lifecycle_status":"active","phase":"applied","archived_at":null,"current_stage_type":"offer","current_stage_label":"Offer","offer_status":"received","offer_reply_due_on":"2030-10-09","offer_received_on":"2030-10-03","offer_salary":"35000","offer_salary_period":"month","offer_base_location":"北京","applied_at":"2030-09-01T02:00:00Z","current_stage":{"id":"6","stage_type":"offer","stage_label":"Offer"},"stages":[{"id":"6","sequence_no":1,"stage_type":"offer","stage_label":"Offer","current_marker":1,"entered_at":"2030-10-03T02:00:00Z"}]}"#)
    let decision = CareerDetailModel(application: received, sessions: [], now: now, calendar: shanghai)
    #expect(decision.next.chips.last == CareerChip("还有 3 天回复", .orange))
    #expect(decision.next.detail == "北京 · 35000 / 月 · 回复截止 10.09")
    #expect(decision.offerCard?.rows.first { $0.label == "回复截止" }?.value == "2030年10月9日")
    #expect(decision.steps.last?.state == .offer && decision.steps.last?.meta == "10.03 · 已收到")
}

@Test func rejectedApplicationEndsWithFailedStep() throws {
    let source = #"{"id":"4","status":"active","lifecycle_status":"terminated","termination_reason":"company_rejected","terminated_at":"2030-10-05T02:00:00Z","archived_at":null,"current_stage_type":"interview","current_stage_label":"二面","offer_status":"none","applied_at":"2030-09-01T02:00:00Z","stages":[{"id":"8","sequence_no":1,"stage_type":"interview","stage_label":"二面","entered_at":"2030-09-20T02:00:00Z"}]}"#
    let model = CareerDetailModel(application: try json(source), sessions: [], now: now, calendar: shanghai)
    #expect(model.ended && model.steps.last?.state == .failed)
    #expect(model.next.title == "流程已结束：二面未通过" && model.next.accent == .red)
    #expect(model.next.primary?.action == .viewReview && model.next.primary?.dark == false)
}

@Test func reviewReportProjectionsMatchWeb() throws {
    #expect(CareerReview.score100(try json(#"{"schema_version":2,"total_score":81.4}"#)) == 81)
    #expect(CareerReview.score100(try json(#"{"overall_score":7.26}"#)) == 73)
    #expect(CareerReview.grade(81) == CareerChip("良好", .green))
    #expect(CareerReview.verdict("at_risk") == CareerChip("存在风险", .orange))
    #expect(CareerReview.statusText(try json(#"{"review_stale":true}"#)) == "记录已修改，待重新生成")
    #expect(CareerReview.statusText(try json(#"{"review_report":{"schema_version":2,"total_score":88}}"#)) == "复盘 88")
    let points = CareerReview.radarPoints([5, nil, 5, 5, 5], radius: 78, center: 110)
    #expect(abs(points[0].x - 110) < 0.001 && abs(points[0].y - 32) < 0.001)
    #expect(abs(points[1].x - 110) < 0.001 && abs(points[1].y - 110) < 0.001)
    #expect(CareerReview.dimensionNote(try json(#"{"key":"job_fit","assessed":false}"#)) == "没有岗位要求，不评这一项")
    #expect(CareerReview.dimensionNote(try json(#"{"key":"structure","assessed":true,"weight":0.2,"comment":"先结论"}"#)) == "权重 20% · 先结论")
    let notes = CareerReview.notes(session: try json(#"{"review_question_notes":[{"question_key":"a"},{"question_key":"gone"}]}"#), report: try json(#"{"questions":[{"key":"a"}]}"#))
    #expect(notes.byKey["a"] != nil && notes.unmatched.map { $0.text("question_key") } == ["gone"])
}

@Test func transcriptAndQuestionParsingMatchesWeb() {
    let lines = CareerTranscript.lines("面试官：先自我介绍\n我: 我负责订单\n  \n普通段落")
    #expect(lines == [.init(speaker: "面试官", text: "先自我介绍"), .init(speaker: "我", text: "我负责订单"), .init(speaker: nil, text: "普通段落")])
    #expect(lines[1].isMe && !lines[0].isMe)
    // Same rule as Web: the marker must be followed by whitespace.
    #expect(CareerTranscript.questions("1. 第一题\n2、 第二题\n- 第三题\n3.没有空格\n4、紧跟文字\n普通") == ["第一题", "第二题", "第三题"])
    #expect(CareerSessions.questionCount("1. a\n2) b\n说明") == 2)
    #expect(CareerTranscript.transcriptionError("INTERVIEW_TRANSCRIPTION_EMPTY") == "录音里没有识别到有效的语音。")
}

@Test func stageDetailRoutesAreNarrow() {
    for (path, method) in [("/api/interview-sessions/3/review:generate", "POST"), ("/api/interview-sessions/3/review-notes", "PUT"),
                           ("/api/interview-sessions/3/review-notes/9", "DELETE"), ("/api/interview-sessions/3/transcriptions/4:retry", "POST"),
                           ("/api/interview-sessions/3/transcriptions/4:apply", "POST"), ("/api/interview-sessions/3/written-questions:extract", "POST"),
                           ("/api/interview-sessions/3/assets", "GET"), ("/api/interview-sessions/3", "DELETE"), ("/api/interview-assets/4/content", "GET")] {
        #expect(CareerRequest.allowed(path: path, method: method), "\(method) \(path)")
    }
    for (path, method) in [("/api/interview-sessions/3/prep-items:generate", "POST"), ("/api/interview-sessions/3/transcriptions/4:drop", "POST"),
                           ("/api/interview-sessions/3/review-notes/x", "DELETE"), ("/api/interview-assets/4", "DELETE"), ("/api/interview-sessions/3/review:generate", "GET")] {
        #expect(!CareerRequest.allowed(path: path, method: method), "\(method) \(path)")
    }
}

@Test func writtenImportMultipartCarriesOnlyTheChosenSource() throws {
    let (text, type) = try CareerUpload.writtenImport(try json(#"{"source":"text","text":"1. 题目"}"#))
    #expect(type.hasPrefix("multipart/form-data; boundary="))
    let body = String(decoding: text, as: UTF8.self)
    #expect(body.contains("name=\"source\"\r\n\r\ntext\r\n") && body.contains("1. 题目") && !body.contains("dataset_id"))
    #expect(throws: APIError.server(status: 400, code: "INTERVIEW_IMPORT_IMAGE_INVALID")) {
        try CareerUpload.writtenImport(try json(#"{"source":"images","images":[{"base64":"AAAA","content_type":"image/gif"}]}"#))
    }
    #expect(throws: APIError.invalidResponse) { try CareerUpload.writtenImport(try json(#"{"source":"dataset","dataset_id":"0"}"#)) }
}
