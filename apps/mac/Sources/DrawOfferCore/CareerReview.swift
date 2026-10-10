import Foundation

/// Native port of Web `reviewReport.ts`: AI review report v1/v2 projections.
public enum CareerReview {
    public static func isV2(_ report: JSONValue?) -> Bool { report?["schema_version"]?.integer == 2 }

    /// 0–100 total for both report versions; v1 stored a 0–10 average.
    public static func score100(_ report: JSONValue?) -> Int? {
        guard let report, report != .null else { return nil }
        if isV2(report) { return report["total_score"]?.numberValue.map { Int($0.rounded()) } }
        return report["overall_score"]?.numberValue.map { Int(($0 * 10).rounded()) }
    }

    public static func grade(_ score: Int?) -> CareerChip? {
        guard let score else { return nil }
        if score >= 85 { return .init("优秀", .green) }
        if score >= 70 { return .init("良好", .green) }
        if score >= 60 { return .init("合格", .orange) }
        return .init("待提升", .red)
    }

    public static func dimensionLabel(_ key: String) -> String {
        ["professional_depth": "专业深度", "motivation_fit": "动机与稳定性", "structure": "表达结构", "job_fit": "岗位匹配",
         "resume_consistency": "经历可信度", "communication": "沟通与应变"][key] ?? key
    }

    public static func categoryLabel(_ key: String) -> String {
        ["technical": "技术题", "project": "项目题", "behavioral": "行为题", "hr": "HR 题"][key] ?? key
    }

    public static func verdict(_ level: String) -> CareerChip {
        ["likely_pass": CareerChip("大概率通过", .green), "promising": CareerChip("有希望通过", .blue),
         "at_risk": CareerChip("存在风险", .orange), "likely_fail": CareerChip("大概率未通过", .red)][level] ?? CareerChip("存在风险", .orange)
    }

    public static func confidenceLabel(_ value: String) -> String {
        value == "high" ? "判断把握 高" : value == "medium" ? "判断把握 中" : "判断把握 低"
    }

    /// Per-question score tone.
    public static func scoreTone(_ score: Double?) -> CareerTone {
        guard let score else { return .gray }
        return score >= 75 ? .green : score >= 50 ? .orange : .red
    }

    /// Short status line for lists and timeline rows.
    public static func statusText(_ session: JSONValue) -> String {
        if session["review_stale"]?.bool == true { return "记录已修改，待重新生成" }
        if session.text("review_status") == "generating" { return "正在生成…" }
        if let report = session["review_report"], report != .null {
            return score100(report).map { "复盘 \($0)" } ?? "已复盘"
        }
        return session.text("review_status") == "failed" ? "生成失败" : "待复盘"
    }

    /// Points of a regular polygon for a radar with values on a 0–5 scale; `nil` draws at the centre.
    public static func radarPoints(_ values: [Double?], radius: Double, center: Double) -> [(x: Double, y: Double)] {
        values.enumerated().map { index, value in
            let angle = -Double.pi / 2 + Double(index) * 2 * Double.pi / Double(max(values.count, 1))
            let r = (value ?? 0) / 5 * radius
            return (center + r * cos(angle), center + r * sin(angle))
        }
    }

    /// Dimension copy shown under each bar.
    public static func dimensionNote(_ item: JSONValue) -> String {
        guard item["assessed"]?.bool == true else {
            switch item.text("key") {
            case "job_fit": return "没有岗位要求，不评这一项"
            case "resume_consistency": return "没有关联简历，不评这一项"
            default: return "证据不足，不评这一项"
            }
        }
        let weight = Int(((item["weight"]?.numberValue ?? 0) * 100).rounded())
        return ["权重 \(weight)%", item.text("comment").isEmpty ? nil : item.text("comment")].compactMap { $0 }.joined(separator: " · ")
    }

    public static func basis(_ report: JSONValue) -> String {
        let basis = report["basis"] ?? .null
        let snippets = basis["material_snippets"]?.integer ?? 0
        let downgraded = basis["downgraded_quotes"]?.integer ?? 0
        return [basis.text("transcript_source") == "transcription" ? "录音转写文字稿" : "文字稿",
                basis.text("resume_title").isEmpty ? "未关联简历" : "投递简历 " + basis.text("resume_title"),
                basis["has_job"]?.bool == true ? "岗位要求" : "无岗位要求",
                snippets > 0 ? "资料库片段 \(snippets) 段" : nil,
                basis.text("material_mode") == "local" ? "资料召回已降级为本地匹配" : nil,
                downgraded > 0 ? "\(downgraded) 处判断因原句不符被降级" : nil,
                "评分规则 " + report.text("rubric_version")].compactMap { $0 }.joined(separator: " · ")
    }
}

/// Stage-detail helpers shared with Web `StageDetailPage.tsx`.
public enum CareerTranscript {
    public struct Line: Sendable, Equatable {
        public let speaker: String?
        public let text: String
        public var isMe: Bool { speaker.map { ["我", "me", "候选人"].contains($0.lowercased()) } ?? false }
    }
    private static let speakers = ["面试官", "HR", "我", "候选人", "Interviewer", "Me"]

    /// Transcript lines read as "speaker: words"; anything else stays a plain paragraph.
    public static func lines(_ markdown: String) -> [Line] {
        markdown.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map { line in
            for speaker in speakers {
                guard line.lowercased().hasPrefix(speaker.lowercased()) else { continue }
                var rest = line.dropFirst(speaker.count).drop { $0 == " " || $0 == "\t" }
                guard let colon = rest.first, colon == ":" || colon == "：" else { continue }
                rest = rest.dropFirst().drop { $0 == " " || $0 == "\t" }
                guard !rest.isEmpty else { continue }
                return Line(speaker: String(line.prefix(speaker.count)), text: String(rest))
            }
            return Line(speaker: nil, text: line)
        }
    }

    /// A numbered (`1.` `1)` `1、`) or bulleted (`-` `*`) line, without its marker.
    public static func questionText(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        var rest = Substring(trimmed)
        if let first = rest.first, first == "-" || first == "*" { rest = rest.dropFirst() }
        else {
            let digits = rest.prefix { $0.isASCII && $0.isNumber }
            guard !digits.isEmpty else { return nil }
            rest = rest.dropFirst(digits.count)
            guard let marker = rest.first, [".", ")", "、"].contains(marker) else { return nil }
            rest = rest.dropFirst()
        }
        guard let space = rest.first, space == " " || space == "\t" else { return nil }
        let text = rest.drop { $0 == " " || $0 == "\t" }
        return text.isEmpty ? nil : String(text)
    }

    public static func questions(_ markdown: String) -> [String] { markdown.components(separatedBy: "\n").compactMap(questionText) }

    public static func transcriptionError(_ code: String) -> String {
        [
            "INTERVIEW_TRANSCRIPTION_NOT_CONFIGURED": "语音识别还没有配置，请联系管理员。",
            "INTERVIEW_TRANSCRIPTION_STORAGE_UNAVAILABLE": "录音暂时无法交给语音识别服务，请稍后重试。",
            "INTERVIEW_TRANSCRIPTION_FORMAT_UNSUPPORTED": "录音格式无法识别，请换成 mp3 或 m4a 后重新上传。",
            "INTERVIEW_TRANSCRIPTION_DOWNLOAD_FAILED": "语音识别服务没能读取录音，请稍后重试。",
            "INTERVIEW_TRANSCRIPTION_AUDIO_TOO_LONG": "录音太长，暂不支持转写。",
            "INTERVIEW_TRANSCRIPTION_EMPTY": "录音里没有识别到有效的语音。",
            "INTERVIEW_TRANSCRIPTION_TIMEOUT": "转写超时，请重试。",
        ][code] ?? "转写失败，请重试。"
    }

    public static func importError(_ code: String) -> String? {
        [
            "INTERVIEW_QUESTIONS_NOT_FOUND": "没有识别到题目，请检查内容后重试。",
            "INTERVIEW_IMPORT_MODEL_NOT_CONFIGURED": "识别模型还没有配置，请联系管理员。",
            "INTERVIEW_IMPORT_TEXT_TOO_LONG": "内容超过 20,000 字，请分批导入。",
            "INTERVIEW_IMPORT_IMAGE_TOO_LARGE": "每张截图不能超过 5MB。",
            "INTERVIEW_IMPORT_IMAGE_INVALID": "截图无法识别，请上传 png、jpg 或 webp 图片。",
            "INTERVIEW_IMPORT_IMAGE_COUNT": "一次最多上传 5 张截图。",
            "INTERVIEW_IMPORT_DATASET_NOT_READY": "这份文件还没有解析完成，请稍后再试。",
            "INTERVIEW_IMPORT_TIMEOUT": "识别超时，请稍后重试。",
        ][code]
    }

    /// The status chip of a stage-detail page.
    public static func status(session: JSONValue, application: JSONValue, now: Date = Date()) -> CareerChip {
        let status = CareerSessions.effectiveStatus(session, now: now)
        if status == "cancelled" { return .init("已取消", .gray) }
        if session.text("round_result") == "passed" { return .init("已通过", .green) }
        if session.text("round_result") == "rejected" { return .init("未通过", .red) }
        if status == "scheduled" { return .init("已安排", .blue) }
        return application.text("status") == "active" ? .init("等待结果", .orange) : .init("已结束", .gray)
    }

    /// The recording's transcription task, if any.
    public static func transcription(session: JSONValue, datasetID: String) -> JSONValue? {
        (session["transcriptions"]?.items ?? []).first { $0.text("dataset_id") == datasetID }
    }
}

extension CareerReview {
    /// Review notes keyed by question (`question_key`), and those whose question no longer appears.
    public static func notes(session: JSONValue, report: JSONValue) -> (byKey: [String: JSONValue], unmatched: [JSONValue]) {
        let notes = session["review_question_notes"]?.items ?? []
        let keys = Set((report["questions"]?.items ?? []).map { $0.text("key") })
        var byKey: [String: JSONValue] = [:]
        for note in notes { byKey[note.text("question_key")] = note }
        return (byKey, notes.filter { !keys.contains($0.text("question_key")) })
    }
}

/// Multipart bodies for career endpoints that take files.
public enum CareerUpload {
    public static let maxImages = 5
    public static let maxImageBytes = 5 * 1024 * 1024

    /// `written-questions:extract`: `{source: text|dataset|images, text?, dataset_id?, images?: [{base64, content_type}]}`.
    public static func writtenImport(_ body: JSONValue) throws -> (Data, String) {
        let boundary = "DrawOffer-" + UUID().uuidString
        var data = Data()
        func append(_ text: String) { data.append(Data(text.utf8)) }
        func field(_ name: String, _ value: String) { append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n") }
        let source = body.text("source")
        guard ["text", "dataset", "images"].contains(source) else { throw APIError.invalidResponse }
        field("source", source)
        switch source {
        case "text": field("text", body.text("text"))
        case "dataset":
            guard DatasetRequest.id(body.text("dataset_id")) else { throw APIError.invalidResponse }
            field("dataset_id", body.text("dataset_id"))
        default:
            let images = body["images"]?.items ?? []
            guard !images.isEmpty, images.count <= maxImages else { throw APIError.server(status: 400, code: "INTERVIEW_IMPORT_IMAGE_COUNT") }
            for (index, image) in images.enumerated() {
                let type = image.text("content_type")
                guard let bytes = Data(base64Encoded: image.text("base64")), bytes.count <= maxImageBytes else { throw APIError.server(status: 400, code: "INTERVIEW_IMPORT_IMAGE_TOO_LARGE") }
                guard let ext = ["image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"][type] else { throw APIError.server(status: 400, code: "INTERVIEW_IMPORT_IMAGE_INVALID") }
                append("--\(boundary)\r\nContent-Disposition: form-data; name=\"files\"; filename=\"image-\(index + 1).\(ext)\"\r\nContent-Type: \(type)\r\n\r\n")
                data.append(bytes); append("\r\n")
            }
        }
        append("--\(boundary)--\r\n")
        return (data, "multipart/form-data; boundary=\(boundary)")
    }
}
