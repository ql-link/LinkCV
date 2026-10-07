import AVFoundation
import AppKit
import Combine
import LinkResumeCore
import SwiftUI

/// 04.C03 阶段详情: one interview, HR conversation or written test — its transcript or questions,
/// preparation, AI analysis and review notes. Mirrors Web `StageDetailPage.tsx`.
struct CareerStageDetailView: View {
    let sessionID: String
    let api: any APIClient
    let back: () -> Void
    let openReport: () -> Void
    enum Sheet: String, Identifiable { case upload, library, text, edit, notes, analysis, importQuestions, reschedule, plan; var id: String { rawValue } }
    @State private var detail: JSONValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var notice: String?
    @State private var sheet: Sheet?
    @State private var deleteText = false
    @State private var expanded = false
    @State private var busy = false
    @State private var refreshed = UUID()
    @State private var now = Date()

    private var session: JSONValue { detail["session"] ?? .null }
    private var application: JSONValue { detail["application"] ?? .null }
    private var assets: [JSONValue] { detail["assets"]?.items ?? [] }
    private var isWritten: Bool { session.text("stage_type") == "other" }
    private var archived: Bool { !application.text("archived_at").isEmpty }
    private var scheduled: Bool { session.text("status") == "scheduled" }
    private var text: String { session.text("questions_markdown").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var audio: JSONValue? { assets.first { $0.text("asset_type") == "audio" } }
    private var report: JSONValue? { session["review_report"].flatMap { $0 == .null ? nil : $0 } }
    private var generating: Bool { session.text("review_status") == "generating" }
    private var transcription: JSONValue? { audio.flatMap { CareerTranscript.transcription(session: session, datasetID: $0.text("id")) } }
    private var transcribing: Bool { ["queued", "running"].contains(transcription?.text("status") ?? "") }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if session.text("id").isEmpty {
                    CareerBreadcrumb(back: "← 求职进度", current: "阶段记录", action: back)
                    if loading { ProgressView("正在加载记录…").font(LibraryTypography.sans(12)) }
                    if let error { HStack { Text(error).foregroundStyle(CareerPalette.red); Button("重试") { refreshed = UUID() }.buttonStyle(CareerActionStyle()) } }
                } else {
                    header
                    if let notice { Text(notice).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub).textSelection(.enabled) }
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 16) {
                            recordCard
                            if isWritten && session.text("schedule_kind") == "open_window" { planCard }
                            if !isWritten && (scheduled || !(session["prep_items"]?.items ?? []).isEmpty || !session.text("preparation_note").isEmpty) {
                                CareerPrepChecklist(session: session, api: api, readOnly: archived || !scheduled, changed: { refreshed = UUID() }, notice: { notice = $0 })
                                if !session.text("preparation_note").isEmpty {
                                    VStack(alignment: .leading, spacing: 14) { Text("准备提醒").font(LibraryTypography.sans(15, weight: .medium)); noteBlock(session.text("preparation_note")) }.careerCard(padding: 20)
                                }
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        VStack(spacing: 14) { reportCard; notesCard; infoCard }.frame(width: 276)
                    }
                }
            }
            .padding(.top, 35).padding(.bottom, 64).frame(maxWidth: 860).padding(.horizontal, 32)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .foregroundStyle(CareerPalette.text).font(LibraryTypography.sans(13))
        .task(id: refreshed) { await load() }
        // Transcription and review generation finish in the background; refresh while they run.
        .task(id: transcribing || generating) {
            guard transcribing || generating else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled else { return }
                await load(quiet: true)
            }
        }
        .sheet(item: $sheet) { kind in sheetView(kind) }
        .confirmationDialog("删除这场\(isWritten ? "笔试" : "面试")的文字记录？", isPresented: $deleteText, titleVisibility: .visible) {
            Button("删除", role: .destructive) { Task { await update(["questions_markdown": .null]) } }
            Button("取消", role: .cancel) {}
        } message: { Text("录音与已生成的报告会保留，删除后可以重新添加。") }
    }

    // MARK: Header

    private var meta: String {
        let range = CareerFormat.range(session.text("start_at"), session.text("end_at"))
        let parts: [String?] = isWritten
            ? [session.text("schedule_kind") == "open_window" ? "截止 \(CareerFormat.monthDay(session.text("end_at"))) \(CareerFormat.clock(session.text("end_at")))" : range, CareerSessions.modeText(session)]
            : [range, CareerSessions.modeText(session), session.text("interviewer_name").isEmpty ? nil : "面试官 " + session.text("interviewer_name")]
        return parts.compactMap { $0 }.joined(separator: " · ")
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                CareerBreadcrumb(back: "← \(application.text("job_title_snapshot")) · \(application.text("company_name_snapshot"))", current: "阶段记录", action: back)
                HStack(spacing: 10) {
                    Text(session.text("stage_label")).font(LibraryTypography.serif(26)).lineLimit(1)
                    CareerChipView(CareerTranscript.status(session: session, application: application, now: now))
                }
                Text(meta).font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.sub)
            }
            Spacer(minLength: 16)
            if !archived {
                HStack(spacing: 8) {
                    if isWritten { Button("导入题目") { sheet = .importQuestions }.buttonStyle(CareerActionStyle()) }
                    else if scheduled { Button("编辑本轮") { sheet = .reschedule }.buttonStyle(CareerActionStyle()) }
                    Menu {
                        if isWritten && scheduled { Button("修改安排") { sheet = .reschedule } }
                        if !text.isEmpty {
                            Button("编辑文字记录") { sheet = .edit }
                            Button("删除文字记录", role: .destructive) { deleteText = true }
                        }
                        Button("从资料库添加") { sheet = .library }
                    } label: { Text("···").font(LibraryTypography.sans(12, weight: .medium)).kerning(2) }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                        .frame(minWidth: 58, minHeight: 30).overlay(RoundedRectangle(cornerRadius: 8).stroke(CareerPalette.border)).accessibilityLabel("更多操作")
                }
            }
        }
    }

    // MARK: Record

    private var recordCard: some View {
        let questions = isWritten ? CareerTranscript.questions(text) : []
        let lines = CareerTranscript.lines(text)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(isWritten ? "笔试题目" : "面试文字稿").font(LibraryTypography.sans(15, weight: .medium))
                if isWritten && !questions.isEmpty { CareerChipView("\(questions.count) 题", .gray) }
                Spacer(minLength: 0)
                if !isWritten, let audio {
                    Text(session.text("transcript_source") == "transcription" ? audio.text("original_file_name") + " · 自动转写" : audio.text("original_file_name"))
                        .font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint).lineLimit(1).truncationMode(.middle)
                }
                if !isWritten && (audio != nil || !text.isEmpty) && !archived { Button("替换") { sheet = .upload }.buttonStyle(CareerActionStyle()) }
            }
            if text.isEmpty && audio == nil {
                VStack(spacing: 10) {
                    Image(systemName: "plus").font(.system(size: 14)).foregroundStyle(CareerPalette.sub).frame(width: 40, height: 40)
                        .background(.white, in: Circle()).overlay(Circle().stroke(CareerPalette.border))
                    Text(isWritten ? "导入笔试题目，按题记录作答情况" : "上传录音或文字稿，统一整理为文字稿").font(LibraryTypography.sans(14, weight: .medium))
                    Text(isWritten ? "可以粘贴题目文本、上传截图，或从资料库选择 PDF / Word 文档" : "支持 mp3 / m4a 录音或 txt / docx 文本，录音会自动转写")
                        .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint)
                    if !archived {
                        HStack(spacing: 8) {
                            if isWritten { Button("导入题目") { sheet = .importQuestions }.buttonStyle(CareerActionStyle(kind: .primary)) }
                            else {
                                Button("上传录音") { sheet = .upload }.buttonStyle(CareerActionStyle(kind: .primary))
                                Button("粘贴文本") { sheet = .text }.buttonStyle(CareerActionStyle())
                                Button("导入文件") { sheet = .library }.buttonStyle(CareerActionStyle())
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 28).padding(.horizontal, 16)
                .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(CareerPalette.rail, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            } else {
                if let audio { CareerAudioBar(asset: audio, api: api, notice: { notice = $0 }) }
                if !isWritten { transcriptionStatus }
                if isWritten && !questions.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                            if index > 0 { Rectangle().fill(CareerPalette.line).frame(height: 1) }
                            HStack(alignment: .top, spacing: 12) {
                                Text(String(format: "%02d", index + 1)).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.faint)
                                Text(question).font(LibraryTypography.sans(13)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }.padding(.top, index == 0 ? 0 : 14).padding(.bottom, 14)
                        }
                    }
                } else if !text.isEmpty {
                    let visible = expanded ? lines : Array(lines.prefix(8))
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(visible.enumerated()), id: \.offset) { _, line in
                            if let speaker = line.speaker {
                                HStack(alignment: .top, spacing: 12) {
                                    Text(speaker).font(LibraryTypography.sans(11, weight: .medium)).foregroundStyle(line.isMe ? CareerPalette.blue : CareerPalette.sub)
                                        .padding(.horizontal, 6).padding(.vertical, 2).background(line.isMe ? CareerPalette.blueSoft : CareerPalette.chipGray, in: RoundedRectangle(cornerRadius: 4))
                                        .frame(width: 48, alignment: .leading)
                                    Text(line.text).font(LibraryTypography.sans(13)).lineSpacing(3).textSelection(.enabled)
                                        .padding(.horizontal, line.isMe ? 10 : 0).padding(.vertical, line.isMe ? 8 : 0)
                                        .background(line.isMe ? CareerPalette.blueSoft : .clear, in: RoundedRectangle(cornerRadius: 8))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                            } else {
                                Text(line.text).font(LibraryTypography.sans(13)).lineSpacing(3).textSelection(.enabled)
                            }
                        }
                    }
                    if lines.count > 8 {
                        Button(expanded ? "收起" : "展开全部（共 \(lines.count) 段）↓") { expanded.toggle() }.buttonStyle(CareerActionStyle(kind: .muted))
                    }
                } else {
                    Text("录音已上传，转写完成后显示在这里。").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint)
                }
            }
        }.careerCard(padding: 20)
    }

    @ViewBuilder private var transcriptionStatus: some View {
        if transcribing {
            statusBanner("正在转写录音，完成后会自动显示文字稿…", red: false, action: nil, title: "")
        } else if let transcription, transcription.text("status") == "failed" {
            statusBanner(CareerTranscript.transcriptionError(transcription.text("error_code")), red: true, action: archived ? nil : { Task { await transcriptionCommand("retry") } }, title: "重新转写")
        } else if let transcription, transcription.text("status") == "succeeded", transcription["pending_replace"]?.bool == true {
            statusBanner("录音转写已完成，当前保留的是你之前的文字稿。", red: false, action: archived ? nil : { Task { await transcriptionCommand("apply") } }, title: "用转写结果替换")
        } else if audio != nil && transcription == nil && text.isEmpty && !archived {
            statusBanner("这段录音还没有转写。", red: false, action: { Task { await transcriptionCommand("retry") } }, title: "开始转写")
        }
    }

    private func statusBanner(_ message: String, red: Bool, action: (() -> Void)?, title: String) -> some View {
        HStack(spacing: 10) {
            Text(message)
            if let action { Button(title, action: action).buttonStyle(.plain).font(LibraryTypography.sans(12, weight: .medium)).underline().foregroundStyle(CareerPalette.text).disabled(busy) }
        }
        .font(LibraryTypography.sans(12)).foregroundStyle(red ? CareerPalette.red : CareerPalette.sub)
        .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
        .background(red ? CareerPalette.redSoft : CareerPalette.chipGray, in: RoundedRectangle(cornerRadius: 10))
    }

    private var planCard: some View {
        let start = session.text("answer_plan_start_at"), end = session.text("answer_plan_end_at")
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("作答计划").font(LibraryTypography.sans(15, weight: .medium))
                Spacer()
                if !archived && scheduled {
                    if !start.isEmpty { Button("清除") { Task { await clearPlan() } }.buttonStyle(CareerActionStyle(kind: .text)).disabled(busy) }
                    Button(start.isEmpty ? "设置计划" : "修改计划") { sheet = .plan }.buttonStyle(CareerActionStyle())
                }
            }
            Text("开放窗口 " + CareerFormat.range(session.text("start_at"), session.text("end_at"))).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
            Text(start.isEmpty ? "还没有设置作答计划。计划只提醒自己，不影响官方截止时间。" : "我的作答计划 " + CareerFormat.range(start, end))
                .font(LibraryTypography.sans(13)).foregroundStyle(start.isEmpty ? CareerPalette.hint : CareerPalette.text)
        }.careerCard(padding: 20)
    }

    private func noteBlock(_ value: String, clamped: Bool = false) -> some View {
        Text(value).font(LibraryTypography.sans(13)).lineSpacing(3).lineLimit(clamped ? 4 : nil).textSelection(.enabled)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Side

    private var reportCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("AI 分析报告").font(LibraryTypography.sans(13, weight: .medium))
                Spacer()
                if let report { Text(CareerFormat.monthDay(report.text("generated_at")) + " " + CareerFormat.clock(report.text("generated_at"))).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.faint) }
            }
            if let report, CareerReview.isV2(report) {
                HStack {
                    CareerChipView(CareerReview.verdict(report["verdict"]?.text("level") ?? ""))
                    Spacer()
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(CareerReview.score100(report).map { "\($0)" } ?? "—").font(LibraryTypography.serif(22))
                        Text(" / 100").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.hint)
                    }
                }
                Text(report.text("headline")).font(LibraryTypography.sans(13, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                bars((report["dimensions"]?.items ?? []).map { item -> (String, Int?, String) in
                    (CareerReview.dimensionLabel(item.text("key")), item["assessed"]?.bool == true ? item["score"]?.integer : nil, item["assessed"]?.bool == true ? "\(item["score"]?.integer ?? 0) / 5" : "未评估")
                })
                reportFooter
            } else if let report {
                Text(report.text("summary")).font(LibraryTypography.sans(13, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                bars([("项目表达", "project_expression"), ("系统设计", "system_design"), ("沟通表达", "communication")].map { (label: String, key: String) -> (String, Int?, String) in
                    let score = report[key]?["score"]?.numberValue.map { Int(($0 / 2).rounded()) }
                    return (label, score, score.map { "\($0) / 5" } ?? "—")
                })
                reportFooter
            } else {
                CareerChipView(generating ? "正在生成" : session.text("review_status") == "failed" ? "生成失败" : "待生成", session.text("review_status") == "failed" ? .red : .gray)
                Text(text.isEmpty ? "添加文字稿后，AI 会按问题拆分回答并给出改进建议" : "结合文字稿、投递简历、岗位要求和资料库内容，逐题打分并给出改进建议")
                    .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint)
                Button(generating ? "正在生成…" : "AI 复盘") { sheet = .analysis }.buttonStyle(CareerActionStyle(kind: .primary)).disabled(text.isEmpty || generating || archived)
            }
        }.careerCard()
    }

    @ViewBuilder private var reportFooter: some View {
        if session["review_stale"]?.bool == true { Text("文字记录已修改，可以重新生成报告").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
        if generating { Text("正在后台重新生成…").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
        Button("查看完整报告 →", action: openReport).buttonStyle(CareerActionStyle())
    }

    private func bars(_ rows: [(String, Int?, String)]) -> some View {
        let tones: [CareerTone] = [.green, .blue, .orange, .green, .blue]
        return VStack(spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack(spacing: 10) {
                    Text(row.0).foregroundStyle(CareerPalette.sub)
                    Spacer(minLength: 0)
                    HStack(spacing: 3) {
                        ForEach(0..<5, id: \.self) { dot in
                            Capsule().fill((row.1 ?? 0) > dot ? CareerPalette.solid(tones[index % tones.count]) : CareerPalette.border).frame(width: 16, height: 4)
                        }
                    }
                    Text(row.2).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.sub).frame(minWidth: 38, alignment: .trailing)
                }.font(LibraryTypography.sans(12))
            }
        }
    }

    private var notesCard: some View {
        let summary = session.text("review_summary").trimmingCharacters(in: .whitespacesAndNewlines)
        let improvement = session.text("improvement_markdown").trimmingCharacters(in: .whitespacesAndNewlines)
        let noteCount = session["review_question_notes"]?.items.count ?? 0
        return VStack(alignment: .leading, spacing: 12) {
            Text("复盘笔记").font(LibraryTypography.sans(13, weight: .medium))
            if noteCount > 0 { Text("逐题笔记 \(noteCount) 条，在完整报告的题目里查看").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
            if summary.isEmpty && improvement.isEmpty { Text("按题记下回答与改进点，下一轮前回看").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
            else { noteBlock(summary.isEmpty ? improvement : summary, clamped: true) }
            if !archived { Button(summary.isEmpty && improvement.isEmpty ? "写复盘" : "继续写复盘 →") { sheet = .notes }.buttonStyle(CareerActionStyle()) }
        }.careerCard()
    }

    private var infoCard: some View {
        let status = CareerTranscript.status(session: session, application: application, now: now)
        var rows: [CareerInfoRow] = [.init(label: "时间", value: CareerFormat.range(session.text("start_at"), session.text("end_at"))), .init(label: "方式", value: CareerSessions.modeText(session))]
        if !isWritten { rows.append(.init(label: "面试官", value: [session.text("interviewer_name"), session.text("interviewer_title")].filter { !$0.isEmpty }.joined(separator: " · ").nonEmptyOr("—"))) }
        let count = CareerTranscript.questions(text).count
        if isWritten && count > 0 { rows.append(.init(label: "题量", value: "\(count) 题")) }
        rows.append(.init(label: "结果", value: status.label, tone: status.tone == .gray ? nil : status.tone))
        return VStack(alignment: .leading, spacing: 12) {
            Text(isWritten ? "本场信息" : "本轮信息").font(LibraryTypography.sans(13, weight: .medium))
            CareerInfoRows(rows: rows)
        }.careerCard()
    }

    // MARK: Sheets

    @ViewBuilder private func sheetView(_ kind: Sheet) -> some View {
        let done: () -> Void = { sheet = nil; refreshed = UUID() }
        let close: () -> Void = { sheet = nil }
        switch kind {
        case .upload, .library, .text:
            CareerAddContentSheet(session: session, recordKind: isWritten ? "笔试" : "面试", initialMode: kind == .upload ? .upload : kind == .library ? .library : .text, api: api, close: close, saved: done)
        case .edit:
            CareerTextSheet(title: "编辑\(isWritten ? "笔试" : "面试")文字记录", subtitle: "修改已保存的\(isWritten ? "笔试" : "面试")文字记录。", initial: text, session: session, api: api, close: close, saved: done)
        case .notes:
            CareerNotesSheet(session: session, api: api, close: close, saved: done)
        case .analysis:
            CareerAnalysisSheet(detail: detail, audioName: audio?.text("original_file_name"), api: api, close: close, started: { sheet = nil; refreshed = UUID(); openReport() })
        case .importQuestions:
            CareerWrittenImportSheet(detail: detail, api: api, close: close, saved: { count in sheet = nil; notice = "已导入 \(count) 道题。"; refreshed = UUID() })
        case .reschedule:
            CareerRescheduleSheet(session: session, api: api, close: close, saved: done)
        case .plan:
            CareerPlanSheet(session: session, api: api, close: close, saved: done)
        }
    }

    // MARK: Requests

    private func load(quiet: Bool = false) async {
        if !quiet { loading = true; error = nil }
        do {
            let result = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)", method: "GET", query: [:], body: nil)
            try Task.checkCancellation()
            guard !(result["session"]?.text("id") ?? "").isEmpty else { throw APIError.invalidResponse }
            detail = result; now = Date()
        } catch is CancellationError { return }
        catch { if !quiet { self.error = "暂时无法读取这条记录。" } }
        if !quiet { loading = false }
    }

    private func update(_ fields: [String: JSONValue]) async {
        busy = true; defer { busy = false }
        var body = fields; body["base_lock_version"] = session["lock_version"] ?? .number(1)
        do { _ = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)", method: "PUT", query: [:], body: .object(body)); refreshed = UUID() }
        catch { notice = CareerErrors.message(error) }
    }

    private func clearPlan() async {
        busy = true; defer { busy = false }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)/answer-plan", method: "PUT", query: [:],
                                            body: .object(["base_lock_version": session["lock_version"] ?? .number(1), "answer_plan_start_at": .null, "answer_plan_end_at": .null]))
            refreshed = UUID()
        } catch { notice = CareerErrors.message(error) }
    }

    private func transcriptionCommand(_ command: String) async {
        guard let audio else { return }
        busy = true; defer { busy = false }
        let body: JSONValue? = command == "apply" ? .object(["base_lock_version": session["lock_version"] ?? .number(1)]) : nil
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)/transcriptions/\(audio.text("id")):\(command)", method: "POST", query: [:], body: body)
            if command == "apply" { notice = "已用转写结果替换文字稿。" }
            refreshed = UUID()
        } catch { notice = CareerErrors.message(error) }
    }
}

/// Recording player. The recording is downloaded through the owner's dataset source and played locally.
struct CareerAudioBar: View {
    let asset: JSONValue
    let api: any APIClient
    let notice: (String) -> Void
    @State private var player: AVPlayer?
    @State private var file: DatasetFile?
    @State private var playing = false
    @State private var loading = false
    @State private var playhead: Double = 0
    private var total: Double { (asset["duration_ms"]?.numberValue ?? 0) / 1000 }
    private let ticker = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 10) {
            Button { Task { await toggle() } } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 11)).foregroundStyle(.white)
                    .frame(width: 28, height: 28).background(CareerPalette.text, in: Circle())
            }.buttonStyle(.plain).disabled(loading).accessibilityLabel(playing ? "暂停录音" : "播放录音")
            Text(stamp(playhead)).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.sub)
            HStack(spacing: 2) {
                ForEach(0..<48, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 1).fill(total > 0 && Double(index) / 48 < playhead / total ? CareerPalette.text : Color(hex: 0xC9C9C3))
                        .frame(width: 2.5, height: CGFloat(6 + (index * 7) % 13))
                }
            }.frame(maxWidth: .infinity, maxHeight: 22).clipped().accessibilityHidden(true)
            Text(total > 0 ? stamp(total) : "—").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.sub)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(CareerPalette.border))
        .accessibilityElement(children: .contain).accessibilityLabel("面试录音播放器")
        .onReceive(ticker) { _ in
            guard let player else { return }
            playhead = player.currentTime().seconds.isFinite ? player.currentTime().seconds : 0
            playing = player.timeControlStatus == .playing
        }
        .onDisappear { player?.pause(); player = nil; file?.discard(); file = nil }
    }

    private func stamp(_ seconds: Double) -> String {
        let value = Int(max(0, seconds))
        return String(format: "%02d:%02d", value / 60, value % 60)
    }

    private func toggle() async {
        if let player {
            if player.timeControlStatus == .playing { player.pause() } else { player.play() }
            return
        }
        loading = true; defer { loading = false }
        do {
            let downloaded = try await api.downloadDataset(id: asset.text("id"), limit: 512 * 1024 * 1024)
            let ext = (asset.text("original_file_name") as NSString).pathExtension.lowercased()
            let playable = downloaded.url.deletingLastPathComponent().appendingPathComponent("recording." + (ext.isEmpty ? "m4a" : ext))
            try FileManager.default.moveItem(at: downloaded.url, to: playable)
            file = downloaded
            let player = AVPlayer(url: playable)
            self.player = player
            player.play()
        } catch { notice("录音加载失败，请稍后重试。") }
    }
}

/// Preparation checklist of an upcoming interview (Web `PrepChecklistCard.tsx`): AI generation once per
/// scheduled session, tick off, add and remove items. Saves carry the latest lock version.
struct CareerPrepChecklist: View {
    let session: JSONValue
    let api: any APIClient
    let readOnly: Bool
    let changed: () -> Void
    let notice: (String) -> Void
    @State private var busy: String?
    @State private var draft = ""
    @State private var local: [JSONValue]?
    private static let maxItems = 12, maxTitle = 80
    private static let categories = ["intro": "自我介绍", "project": "项目深挖", "technical": "技术知识", "system_design": "系统设计",
                                     "behavior": "行为与动机", "company": "公司调研", "other": "其他"]
    private var items: [JSONValue] { local ?? session["prep_items"]?.items ?? [] }
    private var generated: Bool { session["prep_generated_at"].map { $0 != .null } ?? false }
    private var canGenerate: Bool { !readOnly && session.text("status") == "scheduled" && !generated }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("面试准备清单").font(LibraryTypography.sans(15, weight: .medium))
                if !items.isEmpty { CareerChipView("\(items.filter { $0["done"]?.bool == true }.count) / \(items.count) 已完成", .gray) }
                Spacer()
            }
            if busy == "generate" {
                Text("AI 正在根据岗位、简历和历史复盘生成清单…").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
            } else if items.isEmpty {
                Text(readOnly ? "暂无准备事项。" : canGenerate ? "还没有准备清单。让 AI 按这场面试的岗位和简历生成一份，每场面试只能生成一次。"
                     : generated ? "清单已清空。" : "这场面试已经结束，不再生成准备清单。")
                    .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint)
            }
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .top, spacing: 10) {
                    Button { Task { await toggle(index) } } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: item["done"]?.bool == true ? "checkmark.circle.fill" : "circle").font(.system(size: 14))
                                .foregroundStyle(item["done"]?.bool == true ? CareerPalette.green : CareerPalette.faint)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.text("title")).font(LibraryTypography.sans(13, weight: .medium)).strikethrough(item["done"]?.bool == true, color: CareerPalette.faint)
                                Text([Self.categories[item.text("category")] ?? "其他", item.text("reason")].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
                            }
                            Spacer(minLength: 0)
                        }.contentShape(Rectangle())
                    }.buttonStyle(.plain).disabled(readOnly || busy != nil)
                        .accessibilityLabel(item.text("title")).accessibilityValue(item["done"]?.bool == true ? "已完成" : "未完成")
                    if !readOnly {
                        Button { Task { await save(items.enumerated().filter { $0.offset != index }.map(\.element)) } } label: {
                            Image(systemName: "trash").font(.system(size: 11))
                        }.buttonStyle(.plain).foregroundStyle(CareerPalette.faint).disabled(busy != nil).accessibilityLabel("删除 \(item.text("title"))")
                    }
                }
            }
            if canGenerate {
                Button { Task { await generate() } } label: { Label(busy == "generate" ? "生成中…" : "AI 生成准备清单", systemImage: "wand.and.stars") }
                    .buttonStyle(CareerActionStyle(kind: .outline)).disabled(busy != nil)
            }
            if !readOnly {
                HStack(spacing: 8) {
                    TextField("添加一项准备事项", text: $draft).textFieldStyle(.roundedBorder).onSubmit { add() }
                    Button("添加", action: add).buttonStyle(CareerActionStyle(kind: .outline))
                        .disabled(busy != nil || draft.trimmingCharacters(in: .whitespaces).isEmpty || items.count >= Self.maxItems)
                }
            }
        }.careerCard(padding: 20)
            .onChange(of: session["lock_version"]) { _, _ in local = nil }
    }
    private func toggle(_ index: Int) async {
        guard case .object(var fields) = items[index] else { return }
        fields["done"] = .bool(fields["done"]?.bool != true)
        var next = items; next[index] = .object(fields)
        await save(next)
    }
    private func add() {
        let title = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxTitle))
        guard !title.isEmpty, items.count < Self.maxItems, busy == nil else { return }
        draft = ""
        Task { await save(items + [.object(["title": .string(title), "category": .string("other"), "reason": .null, "done": .bool(false)])]) }
    }
    private func save(_ next: [JSONValue]) async {
        let previous = local
        local = next; busy = "save"; defer { busy = nil }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "PUT", query: [:],
                                            body: .object(["prep_items": .array(next), "base_lock_version": session["lock_version"] ?? .number(1)]))
            changed()
        } catch { local = previous; notice(CareerErrors.message(error)); changed() }
    }
    private func generate() async {
        busy = "generate"; defer { busy = nil }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/prep-items:generate", method: "POST", query: [:], body: nil)
            local = nil; changed()
        } catch {
            let messages = ["INTERVIEW_PREP_ALREADY_GENERATED": "这场面试已经生成过准备清单。", "LLM_MODEL_NOT_CONFIGURED": "AI 生成暂不可用，请稍后再试。",
                            "LLM_RESPONSE_INVALID": "AI 这次没有生成有效的清单，可以再试一次。", "INTERVIEW_INVALID_TRANSITION": "只有待进行的面试可以生成准备清单。"]
            if case APIError.server(let status, let code) = error, let message = messages[code] ?? (status >= 500 ? "AI 暂时没能生成清单，请稍后重试。" : nil) {
                notice(message); if code == "INTERVIEW_PREP_ALREADY_GENERATED" { changed() }
            } else { notice(CareerErrors.message(error)) }
        }
    }
}
