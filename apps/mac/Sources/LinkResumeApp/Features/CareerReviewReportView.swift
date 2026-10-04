import AppKit
import LinkResumeCore
import SwiftUI

/// 04.C03.C 面试 AI 分析报告. Report v2 shows the verdict, total score, five-axis radar, per-question
/// scores with notes and improvements; v1 reports keep their three ratings. Mirrors Web `CareerDetailV3.tsx`.
struct CareerReviewReportView: View {
    let sessionID: String
    let api: any APIClient
    let back: () -> Void
    @State private var detail: JSONValue = .null
    @State private var loading = true
    @State private var error: String?
    @State private var notice: String?
    @State private var busy = false
    @State private var selected = 0
    @State private var textOpen = false
    @State private var attempt: (id: String, version: Int)?
    @State private var targets: [JSONValue] = []
    @State private var now = Date()
    @State private var refreshed = UUID()

    private var session: JSONValue { detail["session"] ?? .null }
    private var application: JSONValue { detail["application"] ?? .null }
    private var report: JSONValue? { session["review_report"].flatMap { $0 == .null ? nil : $0 } }
    private var generating: Bool { session.text("review_status") == "generating" }
    private var text: String { session.text("questions_markdown").trimmingCharacters(in: .whitespacesAndNewlines) }
    private var tooLong: Bool { text.count > 50_000 }
    private var archived: Bool { !application.text("archived_at").isEmpty }
    private var canGenerate: Bool { !text.isEmpty && !tooLong && !archived }
    private var interrupted: Bool {
        guard generating, let started = CareerApplication.date(session.text("review_started_at")) else { return false }
        return now.timeIntervalSince(started) >= 20 * 60
    }
    private var audio: JSONValue? { (detail["assets"]?.items ?? []).first { $0.text("asset_type") == "audio" } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if session.text("id").isEmpty {
                    CareerBreadcrumb(back: "← 阶段记录", current: "AI 分析报告", action: back)
                    if loading { ProgressView("正在加载报告…").font(LibraryTypography.sans(12)) }
                    if let error { HStack { Text(error).foregroundStyle(CareerPalette.red); Button("重试") { refreshed = UUID() }.buttonStyle(CareerActionStyle()) } }
                } else {
                    header
                    banners
                    if let notice { Text(notice).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub) }
                    if text.isEmpty { emptyState }
                    if let audio { CareerAudioBar(asset: audio, api: api, notice: { notice = $0 }) }
                    if let report, CareerReview.isV2(report) { reportV2(report) }
                    else if let report { reportV1(report) }
                    else if !text.isEmpty && !session.text("review_summary").isEmpty { banner(session.text("review_summary")) }
                }
            }
            .padding(.top, 35).padding(.bottom, 64).frame(maxWidth: 860).padding(.horizontal, 32)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .foregroundStyle(CareerPalette.text).font(LibraryTypography.sans(13))
        .task(id: refreshed) { await load() }
        .task(id: generating) {
            guard generating else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                guard !Task.isCancelled else { return }
                now = Date()
                await load(quiet: true)
            }
        }
        .sheet(isPresented: $textOpen) {
            CareerSheet(title: "文字记录与素材", subtitle: session.text("stage_label"), width: 720) {
                if text.isEmpty { Text("还没有文字记录。").foregroundStyle(CareerPalette.hint) }
                else { Text(text).font(LibraryTypography.sans(13)).lineSpacing(3).textSelection(.enabled) }
            } footer: { Button("关闭") { textOpen = false }.buttonStyle(CareerActionStyle(kind: .primary, large: true)) }
                .frame(height: 600)
        }
    }

    // MARK: Header and banners

    private var headerMeta: String {
        guard let report else { return CareerFormat.monthDay(session.text("start_at")) + " " + CareerFormat.clock(session.text("start_at")) }
        let resume = CareerReview.isV2(report) ? report["basis"]?.text("resume_title") ?? "" : application.text("resume_title_snapshot")
        var recording = text.isEmpty ? "" : "文字记录"
        if let audio {
            let minutes = max(1, Int(((audio["duration_ms"]?.numberValue ?? 0) / 60_000).rounded()))
            recording = "\(minutes) 分钟录音转写"
        }
        let basis = [resume, recording].filter { !$0.isEmpty }.joined(separator: " + ")
        let generated = CareerFormat.monthDay(report.text("generated_at")) + " " + CareerFormat.clock(report.text("generated_at"))
        return basis.isEmpty ? generated : "基于 \(basis) · \(generated)"
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                CareerBreadcrumb(back: "← \(application.text("company_name_snapshot")) · \(application.text("job_title_snapshot"))", current: session.text("stage_label"), action: back)
                Text("\(session.text("stage_label")) · AI 分析报告").font(LibraryTypography.serif(26)).lineLimit(2)
                HStack(spacing: 8) {
                    if report != nil { CareerChipView(session.text("stage_label"), .gray) }
                    Text(headerMeta)
                        .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
                }
            }
            Spacer(minLength: 16)
            HStack(spacing: 8) {
                Button("文字记录") { textOpen = true }.buttonStyle(CareerActionStyle())
                Button(busy || (generating && !interrupted) ? "正在生成…" : report != nil ? "重新生成" : "生成复盘") { Task { await generate() } }
                    .buttonStyle(CareerActionStyle(kind: .primary)).disabled(!canGenerate || busy || (generating && !interrupted))
            }
        }
    }

    @ViewBuilder private var banners: some View {
        if tooLong { banner("文字复盘最多支持 50,000 字符，请精简记录后生成。", red: true) }
        if session["review_stale"]?.bool == true { banner("文字记录已修改，以下是旧报告，请重新生成。") }
        if session.text("review_status") == "failed" { banner("复盘生成失败，原记录和已有报告已保留。", red: true) }
        if interrupted { banner("上次生成已中断，可以重新生成。") }
        if busy || (generating && !interrupted) { banner("正在后台生成 AI 复盘，通常需要 1–3 分钟，可以离开页面稍后回来查看。") }
        if let report, !CareerReview.isV2(report) { banner("这是旧版报告，重新生成后可查看结果判断、五维雷达和逐题得分。") }
    }

    private func banner(_ message: String, red: Bool = false) -> some View {
        Text(message).font(LibraryTypography.sans(12.5)).foregroundStyle(red ? CareerPalette.red : CareerPalette.sub)
            .padding(.horizontal, 14).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading)
            .background(red ? CareerPalette.redSoft : CareerPalette.soft, in: RoundedRectangle(cornerRadius: 10))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("添加面试文字记录").font(LibraryTypography.sans(15, weight: .medium))
            Text("保存文字记录或上传录音后生成 AI 复盘，录音会自动转写为文字稿。").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint)
            Button("返回阶段记录添加", action: back).buttonStyle(CareerActionStyle(kind: .primary)).padding(.top, 6)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 32).padding(.horizontal, 16)
        .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(CareerPalette.rail, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }

    // MARK: Report v2

    @ViewBuilder private func reportV2(_ report: JSONValue) -> some View {
        let questions = report["questions"]?.items ?? []
        let notes = CareerReview.notes(session: session, report: report)
        verdict(report)
        scores(report, questions: questions)
        if !questions.isEmpty { questionSection(report, questions: questions, notes: notes.byKey) }
        if !notes.unmatched.isEmpty { unmatched(notes.unmatched) }
        improvements(report, questions: questions)
        Text(CareerReview.basis(report)).font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
    }

    private func verdict(_ report: JSONValue) -> some View {
        let verdict = report["verdict"] ?? .null
        let chip = CareerReview.verdict(verdict.text("level"))
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text("结果判断").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.sub)
                Text(chip.label).font(LibraryTypography.serif(20))
                CareerChipView(CareerReview.confidenceLabel(verdict.text("confidence")), .gray)
            }
            Text(report.text("headline")).font(LibraryTypography.sans(13.5)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
            if !verdict.text("confidence_reason").isEmpty { Text(verdict.text("confidence_reason")).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint) }
            ForEach(Array((verdict["signals"]?.items ?? []).enumerated()), id: \.offset) { _, signal in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    CareerChipView(signal.text("polarity") == "positive" ? "正向" : "负向", signal.text("polarity") == "positive" ? .green : .red)
                    Text(signal.text("meaning")).foregroundStyle(CareerPalette.sub)
                    Text("“\(signal.text("quote"))”").foregroundStyle(CareerPalette.faint).lineLimit(2)
                }.font(LibraryTypography.sans(12))
            }
            Text("这是 AI 基于文字稿的判断，不代表最终结果。").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
        }
        .padding(.horizontal, 22).padding(.vertical, 18).frame(maxWidth: .infinity, alignment: .leading)
        .background(.white).overlay(alignment: .leading) { Rectangle().fill(CareerPalette.solid(chip.tone)).frame(width: 4) }
        .clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(CareerPalette.pipelineLine))
    }

    private func scores(_ report: JSONValue, questions: [JSONValue]) -> some View {
        let total = report["total_score"]?.numberValue.map { Int($0.rounded()) }
        let grade = CareerReview.grade(total)
        let good = questions.filter { ($0["score"]?.numberValue ?? -1) >= 75 }.count
        let weak = questions.filter { $0["score"]?.numberValue.map { $0 < 60 } ?? false }.count
        let counts = report["category_counts"] ?? .null
        let mix = ["technical", "project", "behavioral", "hr"].compactMap { key -> String? in
            let count = counts[key]?.integer ?? 0
            return count > 0 ? "\(count) \(CareerReview.categoryLabel(key))" : nil
        }.joined(separator: "、")
        let dimensions = report["dimensions"]?.items ?? []
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 28) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) { Text("总分").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.sub); if let grade { CareerChipView(grade) } }
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(total.map { "\($0)" } ?? "—").font(LibraryTypography.serif(48))
                        Text("/ 100").font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.faint)
                    }
                    if let average = report["question_average"]?.numberValue {
                        Text(report["dimension_score"]?.numberValue.map { "题目 \(format(average)) × 70% + 维度 \(format($0)) × 30%" } ?? "题目 \(format(average))")
                            .font(.system(size: 10.5, design: .monospaced)).foregroundStyle(CareerPalette.faint)
                    }
                }
                .frame(width: 140, alignment: .leading).padding(.trailing, 24)
                .overlay(alignment: .trailing) { Rectangle().fill(CareerPalette.border).frame(width: 1) }
                VStack(alignment: .leading, spacing: 10) {
                    Text(report.text("summary")).font(LibraryTypography.sans(15, weight: .medium)).lineSpacing(4).fixedSize(horizontal: false, vertical: true)
                    Text(["识别问题 \(questions.count) 题", "表现较好 \(good) 题", "待提升 \(weak) 题"].joined(separator: " · ")).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 24).frame(maxWidth: .infinity, alignment: .leading)
            .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(CareerPalette.pipelineLine))
            .padding(.bottom, 28)
            sectionTitle("能力维度", "1–5 分 · 权重按本场 \(mix.isEmpty ? "题目" : mix) 计算")
            HStack(alignment: .top, spacing: 24) {
                CareerRadar(dimensions: dimensions).frame(width: 240, height: 240)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(dimensions.enumerated()), id: \.offset) { index, item in
                        if index > 0 { Rectangle().fill(CareerPalette.line).frame(height: 1) }
                        dimensionRow(item).padding(.top, index == 0 ? 0 : 14).padding(.bottom, 14)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func dimensionRow(_ item: JSONValue) -> some View {
        let assessed = item["assessed"]?.bool == true
        let score = item["score"]?.numberValue ?? 0
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 16) {
                Text(CareerReview.dimensionLabel(item.text("key"))).font(LibraryTypography.sans(13, weight: .medium)).frame(width: 72, alignment: .leading)
                track(fraction: score / 5, low: assessed && score < 3)
                Text(assessed ? "\(Int(score)) / 5" : "未评估").font(.system(size: 11.5, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.sub).frame(width: 48, alignment: .trailing)
            }
            Text(CareerReview.dimensionNote(item)).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub).padding(.leading, 88)
            if !item.text("evidence").isEmpty { quote(item.text("evidence")).padding(.leading, 88) }
        }
    }

    private func track(fraction: Double, low: Bool) -> some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(CareerPalette.border)
                Capsule().fill(low ? CareerPalette.orange : CareerPalette.text).frame(width: proxy.size.width * max(0, min(1, fraction)))
            }
        }.frame(height: 4)
    }

    private func quote(_ value: String) -> some View {
        Text(value).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint).padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(CareerPalette.border).frame(width: 2) }
            .textSelection(.enabled)
    }

    private func sectionTitle(_ title: String, _ sub: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title).font(LibraryTypography.sans(15, weight: .medium))
            Text(sub).font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
        }.padding(.bottom, 14)
    }

    private func questionSection(_ report: JSONValue, questions: [JSONValue], notes: [String: JSONValue]) -> some View {
        let index = min(selected, questions.count - 1)
        let question = questions[index]
        return VStack(alignment: .leading, spacing: 0) {
            sectionTitle("逐题表现", "期望深度 L\(questions.first?["expected_depth"]?.integer ?? 3) · 点击题目查看完整问答与分析")
            ForEach(Array(questions.enumerated()), id: \.offset) { offset, item in
                if offset > 0 { Rectangle().fill(CareerPalette.line).frame(height: 1) }
                Button { selected = offset } label: { questionRow(item, hasNote: notes[item.text("key")] != nil) }
                    .buttonStyle(.plain)
                    .background(offset == index ? CareerPalette.soft : .clear, in: RoundedRectangle(cornerRadius: 8))
            }
            answerPanel(question, note: notes[question.text("key")]).padding(.top, 12)
        }
    }

    private func questionRow(_ item: JSONValue, hasNote: Bool) -> some View {
        let score = item["score"]?.numberValue
        let tone = CareerReview.scoreTone(score)
        let follow = item["follow_ups"]?.integer ?? 0
        let meta = [CareerReview.categoryLabel(item.text("category")), follow > 0 ? "\(follow) 次追问" : "无追问",
                    item["achieved_depth"].map { "深度 L\($0.integer)" }, item.text("resume_conflict").isEmpty ? nil : "与简历不一致", hasNote ? "有笔记" : nil]
            .compactMap { $0 }.joined(separator: " · ")
        return HStack(spacing: 14) {
            Text("Q\(item["index"]?.integer ?? 0)").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.faint).frame(width: 24, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.text("question")).font(LibraryTypography.sans(13, weight: .medium)).multilineTextAlignment(.leading)
                Text(meta).font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Text(score.map { "\(Int($0.rounded()))" } ?? "无法评估").font(.system(size: score == nil ? 10.5 : 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(tone == .gray ? CareerPalette.sub : CareerPalette.solid(tone))
                .frame(minWidth: 36).padding(.horizontal, 6).padding(.vertical, 2).background(CareerPalette.background(tone), in: RoundedRectangle(cornerRadius: 6))
        }.padding(.horizontal, 8).padding(.vertical, 14).contentShape(Rectangle())
    }

    private func answerPanel(_ question: JSONValue, note: JSONValue?) -> some View {
        let number = question["index"]?.integer ?? 0
        return VStack(alignment: .leading, spacing: 10) {
            Text("AI 建议的回答 · Q\(number)").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
            Text(question.text("question")).font(LibraryTypography.sans(15, weight: .medium)).fixedSize(horizontal: false, vertical: true)
            if !question.text("answer").isEmpty { heading("我的回答"); paragraph(question.text("answer")) }
            else { Text(question.text("answer_status") == "declined" ? "这道题没有作答" : "文字稿里没有找到这道题的回答，不计入得分").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint) }
            let signals = question["signals"]?.items ?? []
            if !signals.isEmpty {
                heading("要点命中")
                ForEach(Array(signals.enumerated()), id: \.offset) { _, signal in
                    let verdict = signal.text("verdict")
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        CareerChipView(verdict == "hit" ? "命中" : verdict == "partial" ? "部分" : "未提到", verdict == "hit" ? .green : verdict == "partial" ? .orange : .gray)
                        Text(signal.text("signal")).foregroundStyle(CareerPalette.sub)
                        if !signal.text("quote").isEmpty { Text("“\(signal.text("quote"))”").foregroundStyle(CareerPalette.faint) }
                    }.font(LibraryTypography.sans(12.5))
                }
            }
            if !question.text("resume_conflict").isEmpty { banner(question.text("resume_conflict"), red: true) }
            let errors = question["factual_errors"]?.items ?? []
            if !errors.isEmpty { heading("事实错误"); ForEach(Array(errors.enumerated()), id: \.offset) { _, item in Text("· " + (item.stringValue ?? "")).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub) } }
            if !question.text("strength").isEmpty { heading("做得好的地方"); paragraph(question.text("strength")) }
            if !question.text("improvement").isEmpty { heading("可以更好"); paragraph(question.text("improvement")) }
            if !question.text("suggested_answer").isEmpty { heading("下次怎么答"); paragraph(question.text("suggested_answer")) }
            let snippets = question["evidence_snippets"]?.items ?? []
            if !snippets.isEmpty {
                heading("来自资料库的佐证")
                ForEach(Array(snippets.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.text("title")).font(LibraryTypography.sans(12, weight: .medium))
                        Text(item.text("text")).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
                    }.padding(.horizontal, 12).padding(.vertical, 10).frame(maxWidth: .infinity, alignment: .leading).background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            CareerQuestionNote(session: session, questionText: question.text("question"), note: note, disabled: archived, api: api) { replaceNote($0, key: question.text("key")) }
                .id(question.text("key") + (note?.text("id") ?? "") + "\(note?["lock_version"]?.integer ?? 0)")
            prepActions(question)
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(CareerPalette.border))
    }

    private func heading(_ value: String) -> some View { Text(value).font(LibraryTypography.sans(12.5, weight: .medium)).padding(.top, 4) }
    private func paragraph(_ value: String) -> some View { Text(value).font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.sub).lineSpacing(3).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }

    /// 加入下一轮准备清单: copy this question into a later scheduled session's checklist.
    private func prepActions(_ question: JSONValue) -> some View {
        HStack(spacing: 8) {
            if targets.isEmpty {
                Button("加入下一轮准备清单 →") { Task { await loadTargets() } }.buttonStyle(CareerActionStyle())
                    .disabled(busy || session["review_stale"]?.bool == true || archived)
            } else {
                Menu("选择下一轮面试") {
                    ForEach(targets, id: \.self) { target in
                        Button(target.text("stage_label") + " · " + CareerFormat.monthDay(target.text("start_at"))) { Task { await addToPrep(question, targetID: target.text("id")) } }
                    }
                }.fixedSize()
                Button("取消") { targets = [] }.buttonStyle(CareerActionStyle(kind: .text))
            }
        }
        .padding(.top, 14).frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(CareerPalette.line).frame(height: 1) }
        .padding(.top, 6)
    }

    private func unmatched(_ notes: [JSONValue]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionTitle("未匹配的笔记", "重新生成报告后，这些笔记对应的题目没有再出现").padding(.bottom, -4)
            ForEach(notes, id: \.self) { note in
                VStack(alignment: .leading, spacing: 8) {
                    Text(note.text("question_text")).font(LibraryTypography.sans(13.5, weight: .medium))
                    if !note.text("note").isEmpty { Text(note.text("note")).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub) }
                    if !archived { Button("删除笔记") { Task { await deleteNote(note) } }.buttonStyle(CareerActionStyle()) }
                }.padding(.horizontal, 18).padding(.vertical, 16).frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(CareerPalette.border))
            }
        }
    }

    @ViewBuilder private func improvements(_ report: JSONValue, questions: [JSONValue]) -> some View {
        let items = report["improvements"]?.items ?? []
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                sectionTitle("改进建议", "按影响排序 · \(items.count) 条").padding(.bottom, -4)
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 10) {
                            CareerChipView(item.text("priority") == "key" ? "重要" : "建议", item.text("priority") == "key" ? .red : .orange)
                            Text(item.text("title")).font(LibraryTypography.sans(13.5, weight: .medium))
                        }
                        Text(item.text("detail")).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 8) {
                            let sources = item["question_indexes"]?.items.map(\.integer) ?? []
                            if !sources.isEmpty {
                                Text("来源")
                                ForEach(sources, id: \.self) { number in
                                    Button { selected = max(0, questions.firstIndex(where: { $0["index"]?.integer == number }) ?? 0) } label: { CareerChipView("Q\(number)", .blue) }.buttonStyle(.plain)
                                }
                            }
                            if !item.text("dimension").isEmpty { Text("维度"); CareerChipView(CareerReview.dimensionLabel(item.text("dimension")), .gray) }
                        }.font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
                    }.padding(.horizontal, 18).padding(.vertical, 16).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(CareerPalette.border))
                }
            }
        }
    }

    // MARK: Report v1

    @ViewBuilder private func reportV1(_ report: JSONValue) -> some View {
        let questions = report["questions"]?.items ?? []
        let overall = CareerReview.score100(report)
        let improvements = questions.filter { !$0.text("improvement").isEmpty }
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 28) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) { Text("总分").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.sub); if let grade = CareerReview.grade(overall) { CareerChipView(grade) } }
                    HStack(alignment: .firstTextBaseline, spacing: 4) { Text(overall.map { "\($0)" } ?? "—").font(LibraryTypography.serif(48)); Text("/ 100").font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.faint) }
                }.frame(width: 140, alignment: .leading)
                VStack(alignment: .leading, spacing: 10) {
                    Text(report.text("summary")).font(LibraryTypography.sans(15, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                    Text("识别问题 \(questions.count) 题 · 表现较好 \(questions.filter { !$0.text("strength").isEmpty }.count) 题 · 待提升 \(improvements.count) 题").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
                }
            }
            .padding(.horizontal, 28).padding(.vertical, 24).frame(maxWidth: .infinity, alignment: .leading)
            .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 14)).padding(.bottom, 28)
            sectionTitle("能力维度", "0–10 分 · 依据本轮文字记录")
            ForEach([("项目表达", "project_expression"), ("系统设计", "system_design"), ("沟通表达", "communication")], id: \.1) { entry in
                let label = entry.0
                let rating = report[entry.1] ?? .null
                let score = rating["score"]?.numberValue
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 16) {
                        Text(label).font(LibraryTypography.sans(13, weight: .medium)).frame(width: 72, alignment: .leading)
                        track(fraction: (score ?? 0) / 10, low: (score ?? 10) < 6)
                        Text(score.map { "\(format($0)) / 10" } ?? "— / 10").font(.system(size: 11.5, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.sub).frame(width: 56, alignment: .trailing)
                    }
                    Text(rating.text("reason")).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub).padding(.leading, 88)
                    if !rating.text("evidence").isEmpty { quote(rating.text("evidence")).padding(.leading, 88) }
                }.padding(.vertical, 12)
            }
            if !questions.isEmpty {
                let index = min(selected, questions.count - 1)
                sectionTitle("逐题表现", "点击题目查看完整回答与分析").padding(.top, 16)
                ForEach(Array(questions.enumerated()), id: \.offset) { offset, item in
                    Button { selected = offset } label: {
                        HStack(spacing: 14) {
                            Text("Q\(offset + 1)").font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.faint).frame(width: 24, alignment: .leading)
                            Text(item.text("question")).font(LibraryTypography.sans(13, weight: .medium)).frame(maxWidth: .infinity, alignment: .leading)
                            if !item.text("improvement").isEmpty { CareerChipView("待提升", .orange) } else if !item.text("strength").isEmpty { CareerChipView("表现较好", .green) }
                        }.padding(.horizontal, 8).padding(.vertical, 14).contentShape(Rectangle())
                    }.buttonStyle(.plain).background(offset == index ? CareerPalette.soft : .clear, in: RoundedRectangle(cornerRadius: 8))
                }
                let question = questions[index]
                VStack(alignment: .leading, spacing: 10) {
                    Text("AI 建议的回答 · Q\(index + 1)").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
                    Text(question.text("question")).font(LibraryTypography.sans(15, weight: .medium))
                    if !question.text("answer").isEmpty { heading("我的回答"); paragraph(question.text("answer")) }
                    if !question.text("evidence").isEmpty { quote(question.text("evidence")) }
                    if !question.text("strength").isEmpty { heading("做得好的地方"); paragraph(question.text("strength")) }
                    if !question.text("improvement").isEmpty { heading("可以更好"); paragraph(question.text("improvement")) }
                    if !question.text("suggested_answer").isEmpty { heading("下次怎么答"); paragraph(question.text("suggested_answer")) }
                    prepActions(question)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading).overlay(RoundedRectangle(cornerRadius: 14).stroke(CareerPalette.border)).padding(.top, 12)
            }
        }
    }

    private func format(_ value: Double) -> String { value == value.rounded() ? "\(Int(value))" : String(format: "%.1f", value) }

    // MARK: Requests

    private func load(quiet: Bool = false) async {
        if !quiet { loading = true; error = nil }
        do {
            let result = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)", method: "GET", query: [:], body: nil)
            try Task.checkCancellation()
            guard let loaded = result["session"], !loaded.text("id").isEmpty else { throw APIError.invalidResponse }
            let wasGenerating = generating
            detail = result; now = Date()
            if loaded.text("review_status") != "generating" && attempt?.id == loaded.text("review_request_id") { attempt = nil }
            if quiet && wasGenerating && loaded.text("review_status") == "failed" { notice = "复盘生成失败，原记录和已有报告已保留。" }
        } catch is CancellationError { return }
        catch { if !quiet { self.error = "暂时无法读取这份报告。" } }
        if !quiet { loading = false }
    }

    private func generate() async {
        guard !busy, canGenerate, !generating || interrupted else { return }
        // Unknown transport results keep the original request so a retry cannot start a second generation.
        let request = attempt ?? (UUID().uuidString.lowercased(), session["lock_version"]?.integer ?? 1)
        attempt = request
        busy = true; defer { busy = false }
        do {
            let result = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)/review:generate", method: "POST", query: [:],
                                                     body: .object(["request_id": .string(request.id), "base_lock_version": .number(Double(request.version))]))
            if let updated = result["session"], case .object(var fields) = detail { fields["session"] = updated; detail = .object(fields) }
            if session.text("review_status") != "generating" { attempt = nil }
        } catch {
            if case APIError.server(let status, _) = error, [400, 404, 409].contains(status) { attempt = nil }
            if case APIError.unauthorized = error { attempt = nil }
            if case APIError.server(_, let code) = error, code == "LLM_MODEL_NOT_CONFIGURED" { notice = CareerErrors.message(error) }
            else { notice = "复盘生成失败，原记录和已有报告已保留。" }
            await load(quiet: true)
        }
    }

    private func replaceNote(_ note: JSONValue?, key: String) {
        guard case .object(var detailFields) = detail, case .object(var sessionFields) = session else { return }
        var notes = (session["review_question_notes"]?.items ?? []).filter { $0.text("question_key") != key }
        if let note { notes.append(note) }
        sessionFields["review_question_notes"] = .array(notes)
        detailFields["session"] = .object(sessionFields)
        detail = .object(detailFields)
    }

    private func deleteNote(_ note: JSONValue) async {
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(sessionID)/review-notes/\(note.text("id"))", method: "DELETE", query: [:], body: nil)
            replaceNote(nil, key: note.text("question_key"))
        } catch { notice = CareerErrors.message(error) }
    }

    private func loadTargets() async {
        busy = true; defer { busy = false }
        do {
            let result = try await api.careerRequest(path: "/api/interview-sessions", method: "GET", query: ["application_id": application.text("id"), "status": "scheduled"], body: nil)
            targets = (result["items"]?.items ?? []).filter { $0.text("id") != sessionID }
            if targets.isEmpty { notice = "请先为这个岗位安排下一轮面试。" }
        } catch { notice = "准备清单加载失败，请稍后重试。" }
    }

    private func addToPrep(_ question: JSONValue, targetID: String) async {
        busy = true; defer { busy = false }
        do {
            let target = try await api.careerRequest(path: "/api/interview-sessions/\(targetID)", method: "GET", query: [:], body: nil)["session"] ?? .null
            guard target.text("status") == "scheduled" else { throw APIError.invalidResponse }
            let title = String(question.text("question").prefix(80))
            var items = target["prep_items"]?.items ?? []
            if items.contains(where: { $0.text("title") == title }) { notice = "这个问题已在准备清单中。"; return }
            if items.count >= 12 { notice = "准备清单已满，请先整理已有事项。"; return }
            let advice = question.text("suggested_answer").nonEmptyOr(question.text("improvement"))
            let section = "## \(session.text("stage_label")) · Q\(selected + 1)\n\(question.text("question"))\n\n\(advice)"
            let note = [target.text("preparation_note"), section].filter { !$0.isEmpty }.joined(separator: "\n\n")
            guard note.count <= 100_000 else { throw APIError.invalidResponse }
            let reason = question.text("improvement").nonEmptyOr(question.text("suggested_answer")).nonEmptyOr(question.text("evidence")).nonEmptyOr(question.text("question"))
            items.append(.object(["id": .string(UUID().uuidString.lowercased()), "title": .string(title), "category": .string("technical"), "reason": .string(String(reason.prefix(200))), "done": .bool(false)]))
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(targetID)", method: "PUT", query: [:],
                                            body: .object(["preparation_note": .string(note), "prep_items": .array(items), "base_lock_version": target["lock_version"] ?? .number(1)]))
            notice = "已保存到下一轮准备清单。"; targets = []
        } catch { notice = "准备清单保存失败，请刷新后重试。" }
    }
}

/// Five-axis radar, 1–5 per axis; unassessed axes draw at the centre.
struct CareerRadar: View {
    let dimensions: [JSONValue]
    var body: some View {
        let size: Double = 220, center = size / 2, radius: Double = 78
        let values: [Double?] = dimensions.map { $0["assessed"]?.bool == true ? $0["score"]?.numberValue : nil }
        Canvas { context, canvas in
            let scale = min(canvas.width, canvas.height) / size
            context.scaleBy(x: scale, y: scale)
            func polygon(_ points: [(x: Double, y: Double)]) -> Path {
                var path = Path()
                for (index, point) in points.enumerated() {
                    if index == 0 { path.move(to: CGPoint(x: point.x, y: point.y)) } else { path.addLine(to: CGPoint(x: point.x, y: point.y)) }
                }
                path.closeSubpath(); return path
            }
            for level in 1...5 { context.stroke(polygon(CareerReview.radarPoints(values.map { _ in Double(level) }, radius: radius, center: center)), with: .color(CareerPalette.border), lineWidth: 1) }
            for point in CareerReview.radarPoints(values.map { _ in 5 }, radius: radius, center: center) {
                var axis = Path(); axis.move(to: CGPoint(x: center, y: center)); axis.addLine(to: CGPoint(x: point.x, y: point.y))
                context.stroke(axis, with: .color(CareerPalette.border), lineWidth: 1)
            }
            let shape = polygon(CareerReview.radarPoints(values, radius: radius, center: center))
            context.fill(shape, with: .color(Color(red: 43 / 255, green: 43 / 255, blue: 39 / 255).opacity(0.12)))
            context.stroke(shape, with: .color(CareerPalette.text), lineWidth: 1.5)
            for (index, item) in dimensions.enumerated() {
                let angle = -Double.pi / 2 + Double(index) * 2 * Double.pi / Double(max(dimensions.count, 1))
                let x = center + (radius + 20) * cos(angle), y = center + (radius + 14) * sin(angle)
                let assessed = item["assessed"]?.bool == true
                let label = Text("\(CareerReview.dimensionLabel(item.text("key"))) \(assessed ? "\(item["score"]?.integer ?? 0)" : "—")")
                    .font(LibraryTypography.sans(10, weight: .medium)).foregroundColor(assessed ? CareerPalette.sub : CareerPalette.faint)
                let anchor: UnitPoint = abs(x - center) < 4 ? .center : x > center ? .leading : .trailing
                context.draw(label, at: CGPoint(x: x, y: y), anchor: anchor)
            }
        }
        .accessibilityLabel("能力雷达")
    }
}

/// 我的复盘笔记 under a report question: verdict toggle plus free text, saved per question.
struct CareerQuestionNote: View {
    let session: JSONValue
    let questionText: String
    let note: JSONValue?
    let disabled: Bool
    let api: any APIClient
    let saved: (JSONValue?) -> Void
    @State private var draft = ""
    @State private var verdict: String?
    @State private var state = ""
    private var dirty: Bool { draft.trimmingCharacters(in: .whitespacesAndNewlines) != (note?.text("note") ?? "") || verdict != note.flatMap { $0.text("verdict").isEmpty ? nil : $0.text("verdict") } }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("我的复盘笔记").font(LibraryTypography.sans(12.5, weight: .medium))
                Spacer()
                HStack(spacing: 6) {
                    ForEach(["good", "improve"], id: \.self) { value in
                        Button(value == "good" ? "答得好" : "待改进") {
                            let next = verdict == value ? nil : value
                            verdict = next; Task { await save(next) }
                        }
                        .buttonStyle(.plain).font(LibraryTypography.sans(11.5))
                        .foregroundStyle(verdict == value ? .white : CareerPalette.sub)
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(verdict == value ? CareerPalette.text : .white, in: Capsule())
                        .overlay(Capsule().stroke(verdict == value ? CareerPalette.text : CareerPalette.border))
                        .disabled(disabled || state == "saving")
                    }
                }.accessibilityLabel("这道题答得怎么样")
            }
            CareerTextArea(title: "", text: $draft, placeholder: "记下这道题哪里卡住了、下次怎么答", minHeight: 84).disabled(disabled)
                .onChange(of: draft) { _, _ in if state != "saving" { state = "" } }
            HStack {
                Text(["saving": "正在保存…", "saved": "已保存", "conflict": "笔记已在其他页面更新，请刷新后再试。", "error": "保存失败，请稍后重试。"][state] ?? "")
                    .font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
                Spacer()
                Button("保存笔记") { Task { await save(verdict) } }.buttonStyle(CareerActionStyle()).disabled(disabled || !dirty || state == "saving")
            }
        }
        .padding(14).background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 12))
        .task { draft = note?.text("note") ?? ""; verdict = note.flatMap { $0.text("verdict").isEmpty ? nil : $0.text("verdict") } }
    }
    private func save(_ nextVerdict: String?) async {
        state = "saving"
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let result = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/review-notes", method: "PUT", query: [:], body: .object([
                "question_text": .string(questionText), "verdict": nextVerdict.map(JSONValue.string) ?? .null,
                "note": text.isEmpty ? .null : .string(text), "lock_version": note?["lock_version"] ?? .null,
            ]))
            saved(result["note"].flatMap { $0 == .null ? nil : $0 })
            state = "saved"
        } catch {
            if case APIError.server(409, _) = error { state = "conflict" } else { state = "error" }
        }
    }
}
