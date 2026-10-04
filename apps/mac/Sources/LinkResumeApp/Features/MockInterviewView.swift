import Foundation
import LinkResumeCore
import SwiftUI

struct MockInterviewView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    let showSchedule: () -> Void
    @State private var screen = "home"
    @State private var pending = false
    @State private var records: [MockInterview] = []
    @State private var radarDimensions: [JSONValue] = []
    @State private var recordsLoaded = false
    @State private var applications: [CareerApplication] = []
    @State private var arrangements: [ScheduledInterview] = []
    @State private var resumes: [JSONValue] = []
    @State private var materials: [JSONValue] = []
    @State private var detail: MockInterview?
    @State private var selectedID = ""
    @State private var refresh = UUID()
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var careerError: String?
    @State private var resume = ""
    @State private var job = "__none"
    @State private var jd = ""
    @State private var type = "comprehensive"
    @State private var difficulty = "intermediate"
    @State private var count = 5
    @State private var follow = true
    @State private var language = "zh"
    @State private var chosenMaterials = Set<String>()
    @State private var materialsInQuestions = false
    @State private var draft = ""
    @State private var uncertain: (command: String, body: JSONValue)?
    @State private var createUnknown = false
    @State private var repeatUnknown = false
    @State private var confirmation: String?
    @State private var query = ""
    @State private var filter = "all"
    @State private var moreOpen = false
    @State private var typeTouched = false
    @State private var recordStatus = "all"
    @State private var recordJob = "all"
    @State private var recordType = "all"
    @State private var recordSort = "latest"
    @State private var openQuestion: Int?
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var completed: [MockInterview] { records.filter { $0.status == "completed" } }
    private func request(_ path: String, _ method: String = "GET", _ body: JSONValue? = nil, query: [String:String] = [:]) async throws -> JSONValue {
        let owner = account
        let result = try await session.api.careerRequest(path: path, method: method, query: query, body: body)
        try Task.checkCancellation()
        guard owner == account, !owner.isEmpty else { throw CancellationError() }
        return result
    }
    private func date(_ value: String) -> String {
        guard let date = CareerApplication.date(value) else { return "—" }
        let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = "M月d日 HH:mm"; return f.string(from: date)
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if screen == "home" { home }
                else if screen == "records" { recordList }
                else if screen == "new" { configuration }
                else if let detail { interview(detail) }
                if let error {
                    HStack(spacing: 10) {
                        Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red)
                        if !busy { Button("重新加载") { refresh = UUID() }.buttonStyle(CareerActionStyle(kind: .link)) }
                    }.padding(.top, 16)
                }
            }
            .padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 64)
            .frame(maxWidth: screen == "new" ? 624 : .infinity, alignment: .topLeading).frame(maxWidth: .infinity, alignment: .top)
        }
        .task(id: account + screen + selectedID + refresh.uuidString) { await load() }
        .onChange(of: account) { _, id in
            records = []; recordsLoaded = false; radarDimensions = []; busy = false; error = nil; careerError = nil; applications = []; arrangements = []; resumes = []; materials = []; detail = nil
            chosenMaterials = []; job = "__none"; draft = ""; uncertain = nil; repeatUnknown = false; createUnknown = false; resume = ""; jd = ""; query = ""; confirmation = nil; selectedID = ""; screen = "home"
            if id.isEmpty { pending = false; job = "__none" }
            else if pending { pending = false; screen = "new" }
        }
        .onChange(of: job) { _, value in
            if let app = applications.first(where: { $0.id == value }) {
                if resumes.contains(where: { $0.text("id") == app.raw.text("resume_id") }) { resume = app.raw.text("resume_id") }
                if !typeTouched { type = app.stageLabel.uppercased().hasPrefix("HR") ? "hr" : "comprehensive" }
            }
        }
        .sheet(isPresented: $moreOpen) { moreSettings.frame(width: 520) }
        .alert(confirmTitle, isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })) {
            Button("取消", role: .cancel) { confirmation = nil }
            Button(confirmLabel, role: ["delete", "abandon"].contains(confirmation ?? "") ? .destructive : nil) {
                let command = confirmation!; confirmation = nil; Task { await commandAction(command) }
            }
        } message: { Text(confirmMessage) }
    }
    private var confirmTitle: String { ["delete": "删除练习记录？", "abandon": "放弃这场模拟面试？", "finish": "结束并生成评估？"][confirmation ?? ""] ?? "确认操作" }
    private var confirmLabel: String { ["delete": "确认删除", "abandon": "放弃本场", "finish": "结束并评估"][confirmation ?? ""] ?? "确认" }
    private var confirmMessage: String {
        switch confirmation {
        case "delete": return "永久删除本场练习及报告，无法恢复。"
        case "abandon": return detail?.status == "preparing" ? "面试官还在准备题目，取消后本场记为已放弃，可以随时重新开始。" : "已作答的内容不会生成评估报告，放弃后可以重新开始一场。"
        default: return (detail?.raw["answered_main_questions"]?.integer ?? 0) == 0 ? "你还没有回答任何主问题，结束后本场记为已放弃，不生成报告。" : "已作答的题目会进入评估，未作答的题目不计分。评估约需 1 分钟。"
        }
    }
    private func eyebrow(_ segments: [String], back: Bool = true) -> some View {
        HStack(spacing: 6) {
            if back { Button("MOCK INTERVIEW") { goHome() }.buttonStyle(.plain).foregroundStyle(V3.sub).accessibilityLabel("返回模拟面试").disabled(busy) }
            else { Text("MOCK INTERVIEW").foregroundStyle(V3.fnt) }
            ForEach(segments, id: \.self) { segment in Text("·").foregroundStyle(V3.fnt); Text(segment).foregroundStyle(V3.fnt).lineLimit(1) }
        }.font(V3.sans(12, weight: .medium)).frame(height: 13)
    }
    private func goHome() { screen = "home"; detail = nil; uncertain = nil; draft = ""; selectedID = "" }
    private func start(_ application: String? = nil, type preferred: String? = nil) {
        job = application ?? "__none"; createUnknown = false; error = nil; typeTouched = preferred != nil
        if let preferred { type = preferred }
        if account.isEmpty { pending = true; requireAccount() } else { screen = "new" }
    }
    private func open(_ item: MockInterview) { selectedID = item.id; detail = item; repeatUnknown = false; draft = ""; uncertain = nil; screen = "detail"; error = nil }

    // MARK: 07.1 Home

    private var upcoming: ScheduledInterview? { arrangements.filter { $0.editable && $0.start >= Date() }.sorted { $0.start < $1.start }.first }
    private var home: some View {
        let next = upcoming
        let newUser = next == nil && records.isEmpty
        let active = records.first { $0.active }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    eyebrow([records.isEmpty ? "AI 练习" : "\(records.count) 场练习"], back: false)
                    Text("模拟面试").font(V3.serif(28)).foregroundStyle(V3.txt).frame(height: 36).padding(.top, 9)
                    Text(newUser ? "从一个在投岗位开始，AI 会按岗位 JD 和你的简历出题。" : "按你在投的岗位组织练习，离面试越近越靠前。").font(V3.sans(13)).foregroundStyle(V3.sub).padding(.top, 6)
                }
                Spacer()
                HStack(spacing: 10) {
                    Button { screen = "records" } label: {
                        CareerIcon(name: "clock", size: 14, template: true).foregroundStyle(V3.sub)
                        Text("练习记录")
                        Text("\(records.count)").font(V3.number(11, weight: .medium)).foregroundStyle(V3.sub).padding(.horizontal, 6).frame(minWidth: 19).background(V3.field, in: Capsule())
                    }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 31)).disabled(records.isEmpty)
                    Button("开始新面试") { start() }.buttonStyle(V3ButtonStyle(kind: next == nil ? .dark : .ghost, height: 31))
                }.padding(.top, 23)
            }.frame(minHeight: 84, alignment: .top)
            if let next { upcomingCard(next, active: active) }
            else if newUser && (account.isEmpty || recordsLoaded) { startCard }
            else if let active { resumeStrip(active).padding(.top, 20) }
            if completed.isEmpty { statsEmpty } else { stats }
            otherJobs(title: newUser ? "从在投岗位开始" : "其他在投岗位", excluding: next?.applicationID)
        }
    }
    private func coverageTypes(_ stage: String) -> [String] { stage.trimmingCharacters(in: .whitespaces).uppercased().hasPrefix("HR") ? ["hr", "comprehensive", "project_deep_dive"] : ["technical", "project_deep_dive", "comprehensive"] }
    private func estimate(_ count: Int = 5) -> Int { count * 4 + 5 }
    private func dayBand(_ date: Date) -> String {
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: Date()), to: calendar.startOfDay(for: date)).day ?? 0
        return days == 0 ? "今天" : days == 1 ? "明天" : format(date, "MM-dd")
    }
    private func countdown(_ date: Date) -> String {
        let minutes = max(0, Int((date.timeIntervalSinceNow / 60).rounded()))
        if minutes < 60 { return "\(max(1, minutes)) 分钟后" }
        if minutes < 1440 { return "\(Int((Double(minutes) / 60).rounded())) 小时后" }
        return "\(Int((Double(minutes) / 1440).rounded())) 天后"
    }
    private func format(_ date: Date, _ pattern: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = pattern; return f.string(from: date) }
    private func upcomingCard(_ session: ScheduledInterview, active: MockInterview?) -> some View {
        let types = coverageTypes(session.label)
        let mine = completed.filter { $0.raw.text("job_application_id") == session.applicationID }
        let coverage = types.map { kind -> (String, Int, Int?) in
            let done = mine.filter { $0.raw.text("interview_type") == kind }
            return (kind, done.count, done.isEmpty ? nil : Int((done.compactMap { $0.raw["total_score"]?.numberValue }.max() ?? 0).rounded()))
        }
        let practiced = coverage.filter { $0.1 > 0 }.count
        let nextType = coverage.first { $0.1 == 0 }?.0
        let recommended = nextType ?? types[0]
        let today = dayBand(session.start) == "今天"
        let button = practiced == 0 ? "针对这场练一次" : nextType.map { "练" + (MockInterview.types[$0] ?? "") } ?? "再练一场"
        let note = practiced == 0 ? "先练\(MockInterview.types[recommended] ?? "") · 约 \(estimate()) 分钟" : "\(session.label)常考 · 约 \(estimate()) 分钟"
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                VStack(spacing: 0) {
                    HStack(spacing: 4) { Text(dayBand(session.start)).fontWeight(.medium); Text(format(session.start, "EEE")).opacity(0.8) }
                        .font(V3.sans(11)).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 21).background(today ? V3.red : V3.txt)
                    Text(format(session.start, "HH:mm")).font(V3.number(22, weight: .bold)).foregroundStyle(V3.txt).padding(.top, 11)
                    HStack(spacing: 4) { Circle().fill(today ? V3.red : V3.fnt).frame(width: 5, height: 5); Text(countdown(session.start)) }.font(V3.sans(11)).foregroundStyle(V3.sub).padding(.top, 4)
                    Spacer(minLength: 0)
                }
                .frame(width: 88, height: 88).background(.white).clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl)).shadow(color: .black.opacity(0.06), radius: 3, y: 2)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Text(session.company + " · " + session.title).font(V3.sans(15, weight: .semibold)).foregroundStyle(V3.txt).lineLimit(1)
                        V3Chip(label: session.label + " · " + (MockInterview.types[recommended] ?? ""), size: 11)
                    }.frame(height: 20)
                    HStack(spacing: 4) {
                        Text("准备度").font(V3.sans(12)).foregroundStyle(V3.fnt)
                        Text("\(practiced) / \(types.count)").font(V3.number(13, weight: .medium)).foregroundStyle(V3.txt)
                        Text("题型已练").font(V3.sans(12)).foregroundStyle(V3.fnt)
                        HStack(spacing: 3) {
                            ForEach(coverage.indices, id: \.self) { index in
                                RoundedRectangle(cornerRadius: 3).fill(coverage[index].1 > 0 ? Color(hex: 0x2E8C57) : practiced > 0 && coverage[index].0 == nextType ? V3.orange.opacity(0.25) : V3.line).frame(height: 6)
                            }
                        }.frame(width: 174).padding(.leading, 6)
                    }.frame(height: 16).padding(.top, 12)
                    HStack(spacing: 8) {
                        ForEach(coverage.indices, id: \.self) { index in
                            let item = coverage[index]
                            let isNext = practiced > 0 && item.0 == nextType
                            HStack(spacing: 6) {
                                if item.1 > 0 { Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(Color(hex: 0x2E8C57)) }
                                else { Circle().stroke(isNext ? V3.orange : V3.fnt2, style: StrokeStyle(lineWidth: 1, dash: [2, 2])).frame(width: 11, height: 11) }
                                Text(MockInterview.types[item.0] ?? "").font(V3.sans(12, weight: .medium))
                                Text(item.1 > 0 ? "\(item.1) 场 · " + (item.1 > 1 ? "最高 " : "") + "\(item.2 ?? 0)" : "还没练").font(V3.sans(11.5)).foregroundStyle(isNext ? V3.orange : V3.fnt)
                            }
                            .foregroundStyle(item.1 > 0 ? V3.txt : isNext ? V3.orange : V3.sub)
                            .padding(.leading, 8).padding(.trailing, 10).frame(height: 24)
                            .background(item.1 > 0 ? Color(hex: 0x2E8C57).opacity(0.08) : isNext ? V3.orange.opacity(0.10) : V3.field, in: RoundedRectangle(cornerRadius: 8))
                        }
                    }.padding(.top, 12)
                }.padding(.leading, 20).padding(.top, 2).frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .trailing, spacing: 8) {
                    Button(button) { start(session.applicationID, type: recommended) }.buttonStyle(V3ButtonStyle(kind: .dark, height: 34))
                    Text(note).font(V3.sans(11)).foregroundStyle(V3.fnt).lineLimit(1)
                }.frame(width: 160, alignment: .trailing).padding(.top, 6)
            }.frame(height: 88)
            if let active { resumeStrip(active).padding(.top, 16) }
        }
        .padding(.horizontal, 24).padding(.top, 21).padding(.bottom, 16)
        .background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
        .padding(.top, 20)
    }
    private func resumeStrip(_ active: MockInterview) -> some View {
        let count = max(1, active.raw["question_count"]?.integer ?? 5)
        let answered = active.raw["answered_main_questions"]?.integer ?? 0
        let current = min(count, answered + (active.status == "in_progress" ? 1 : 0))
        let evaluating = active.status == "evaluating"
        let detailText = active.status == "in_progress" ? "\(active.type) · 第 \(current) / \(count) 题" : "\(active.type) · \(active.label)"
        return HStack(spacing: 6) {
            Circle().fill(V3.blue).frame(width: 7, height: 7).padding(.trailing, 6)
            Text(evaluating ? "有一场正在评估" : "有一场未完成").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.txt)
            Text(detailText).font(V3.sans(12)).foregroundStyle(V3.fnt).lineLimit(1)
            Spacer(minLength: 8)
            ZStack(alignment: .leading) {
                Capsule().fill(V3.cl).frame(width: 96, height: 4)
                Capsule().fill(V3.blue).frame(width: 96 * (evaluating ? 1 : Double(answered) / Double(count)), height: 4)
            }.padding(.trailing, 6)
            if !evaluating { Button("放弃") { selectedID = active.id; detail = active; confirmation = "abandon" }.buttonStyle(.plain).font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.horizontal, 10) }
            Button(evaluating ? "查看进度" : "继续上次") { open(active) }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 26))
        }
        .padding(.leading, 14).padding(.trailing, 10).frame(height: 44)
        .background(V3.field, in: RoundedRectangle(cornerRadius: 10))
    }
    private var startCard: some View {
        HStack(spacing: 20) {
            Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 26)).foregroundStyle(V3.blue)
                .frame(width: 64, height: 64).background(V3.blue.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 6) {
                Text("还没有面试安排，也还没练过").font(V3.sans(16, weight: .medium)).foregroundStyle(V3.txt)
                Text("选一个下面的在投岗位做第一场练习；在求职记录里添加面试时间后，最近的一场会出现在这里。").font(V3.sans(12.5)).foregroundStyle(V3.sub).lineLimit(1)
                HStack(spacing: 16) {
                    ForEach(Array(["选岗位", "答 5 道题 · 约 \(estimate()) 分钟", "拿到评估报告"].enumerated()), id: \.offset) { index, text in
                        HStack(spacing: 6) {
                            Text("\(index + 1)").font(V3.number(10.5, weight: .medium)).foregroundStyle(.white).frame(width: 16, height: 13).background(V3.blue, in: Capsule())
                            Text(text).font(V3.sans(12)).foregroundStyle(V3.sub)
                        }
                    }
                }
            }
            Spacer(minLength: 8)
            Button("添加面试时间", action: showSchedule).buttonStyle(V3ButtonStyle(kind: .ghost, height: 33))
        }
        .padding(.horizontal, 25).frame(height: 110)
        .background(V3.blue.opacity(0.05), in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xD1DBF2)))
        .padding(.top, 20)
    }
    private var averageScore: Double { completed.isEmpty ? 0 : completed.reduce(0.0) { $0 + ($1.raw["total_score"]?.numberValue ?? 0) } / Double(completed.count) }
    private var practiceHours: Double {
        completed.reduce(0.0) { sum, item in
            let start = CareerApplication.date(item.raw.text("started_at")), end = CareerApplication.date(item.raw.text("finished_at"))
            let real = start.flatMap { s in end.map { $0.timeIntervalSince(s) } } ?? 0
            return sum + (real > 0 ? real : Double(estimate(item.raw["question_count"]?.integer ?? 5) * 60))
        } / 3600
    }
    private var stats: some View {
        let trend = completed.sorted { ($0.raw.text("finished_at").isEmpty ? $0.raw.text("created_at") : $0.raw.text("finished_at")) < ($1.raw.text("finished_at").isEmpty ? $1.raw.text("created_at") : $1.raw.text("finished_at")) }.suffix(4)
        let scores = trend.map { $0.raw["total_score"]?.numberValue ?? 0 }
        let dims = radarDimensions.filter { ($0["score"]?.numberValue ?? 0) > 0 }
        let weak = dims.min { ($0["score"]?.numberValue ?? 0) < ($1["score"]?.numberValue ?? 0) }
        return HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 0) {
                Text("综合表现").font(V3.sans(13.5, weight: .medium)).frame(maxWidth: .infinity, alignment: .leading).frame(height: 17)
                ZStack {
                    Circle().stroke(V3.field, lineWidth: 9)
                    Circle().trim(from: 0, to: min(1, max(0, averageScore / 100))).stroke(V3.blue, style: StrokeStyle(lineWidth: 9, lineCap: .round)).rotationEffect(.degrees(-90))
                    VStack(spacing: 4) { Text(String(format: "%.1f", averageScore)).font(V3.number(28, weight: .bold)); Text("平均分").font(V3.sans(11)).foregroundStyle(V3.fnt) }
                }.frame(width: 100, height: 100).padding(12).padding(.top, 11)
                HStack(spacing: 0) {
                    statNumber("\(completed.count)", "已完成"); statNumber("\(records.filter { $0.status == "abandoned" }.count)", "已放弃"); statNumber(String(format: "%.1fh", practiceHours), "累计练习")
                }.padding(.top, 12)
            }.frame(width: 180)
            Rectangle().fill(V3.line).frame(width: 1, height: 197).padding(.horizontal, 24)
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("得分趋势").font(V3.sans(13.5, weight: .medium))
                    Spacer()
                    if scores.count >= 2 {
                        let delta = Int((scores[scores.count - 1] - scores[scores.count - 2]).rounded())
                        HStack(spacing: 4) {
                            Text("最近 \(Int(scores.last!.rounded()))").font(V3.sans(12)).foregroundStyle(V3.fnt)
                            if delta != 0 { Text(delta > 0 ? "↑\(delta)" : "↓\(-delta)").font(V3.number(11, weight: .medium)).foregroundStyle(delta > 0 ? Color(hex: 0x2E8C57) : V3.red) }
                        }
                    }
                }.frame(height: 17)
                if scores.count >= 2 { trendChart(Array(trend), scores: scores).frame(height: 150).padding(.top, 16) }
                else { Text("完成 2 场后显示变化").font(V3.sans(11.5)).foregroundStyle(V3.fnt).frame(maxWidth: .infinity).padding(.top, 64) }
            }.frame(maxWidth: .infinity)
            Rectangle().fill(V3.line).frame(width: 1, height: 197).padding(.horizontal, 24)
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("能力雷达").font(V3.sans(13.5, weight: .medium))
                    Spacer()
                    if let weak { Text("待加强 · " + (MockInterview.dimensions[weak.text("key")] ?? "")).font(V3.sans(11.5)).foregroundStyle(V3.orange) }
                }.frame(height: 17)
                if dims.count >= 3 { radar(dims, labels: true, weak: weak?.text("key")).frame(width: 240, height: 168).padding(.top, 12) }
                else { Text("完成报告后显示").font(V3.sans(11.5)).foregroundStyle(V3.fnt).frame(maxWidth: .infinity).padding(.top, 64) }
            }.frame(width: 240)
        }
        .padding(.horizontal, 24).padding(.vertical, 21).frame(height: 239, alignment: .top)
        .background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
        .padding(.top, 20)
    }
    private func statNumber(_ value: String, _ label: String) -> some View {
        VStack(spacing: 1) { Text(value).font(V3.number(15, weight: .bold)).foregroundStyle(V3.txt); Text(label).font(V3.sans(10.5)).foregroundStyle(V3.fnt) }.frame(maxWidth: .infinity)
    }
    private func trendChart(_ items: [MockInterview], scores: [Double]) -> some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            let low = (scores + [averageScore]).min()! - 8, high = (scores + [averageScore]).max()! + 8
            let y = { (score: Double) in 112 - (score - low) / max(1, high - low) * 96 }
            let x = { (index: Int) in 18 + Double(index) * (width - 34) / Double(max(1, scores.count - 1)) }
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    for gy in [16.0, 48, 80, 112] { var line = Path(); line.move(to: CGPoint(x: 0, y: gy)); line.addLine(to: CGPoint(x: width, y: gy)); context.stroke(line, with: .color(V3.line)) }
                    var area = Path(); area.move(to: CGPoint(x: 18, y: 112))
                    var line = Path()
                    for (index, score) in scores.enumerated() {
                        let point = CGPoint(x: x(index), y: y(score))
                        area.addLine(to: point)
                        if index == 0 { line.move(to: point) } else { line.addLine(to: point) }
                    }
                    area.addLine(to: CGPoint(x: x(scores.count - 1), y: 112)); area.closeSubpath()
                    context.fill(area, with: .color(V3.blue.opacity(0.08)))
                    var average = Path(); average.move(to: CGPoint(x: 0, y: y(averageScore))); average.addLine(to: CGPoint(x: width, y: y(averageScore)))
                    context.stroke(average, with: .color(V3.fnt), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    context.stroke(line, with: .color(V3.blue), lineWidth: 1.6)
                    for (index, score) in scores.enumerated() {
                        let last = index == scores.count - 1, r: Double = last ? 5 : 3.5
                        let dot = Path(ellipseIn: CGRect(x: x(index) - r, y: y(score) - r, width: r * 2, height: r * 2))
                        context.fill(dot, with: .color(last ? V3.blue : .white)); context.stroke(dot, with: .color(last ? .white : V3.blue), lineWidth: 1.4)
                    }
                }.frame(width: width, height: 120).offset(y: 24)
                ForEach(scores.indices, id: \.self) { index in
                    Text("\(Int(scores[index].rounded()))").font(V3.number(11, weight: .semibold)).foregroundStyle(index == scores.count - 1 ? V3.blue : V3.sub)
                        .position(x: x(index), y: 24 + y(scores[index]) - 12)
                    let finished = items[index].raw.text("finished_at").isEmpty ? items[index].raw.text("created_at") : items[index].raw.text("finished_at")
                    Text(CareerApplication.date(finished).map { format($0, "MM-dd") } ?? "").font(V3.number(10, weight: .regular)).foregroundStyle(V3.fnt).position(x: x(index), y: 150)
                }
            }
        }
    }
    private var statsEmpty: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("练习数据").font(V3.sans(13, weight: .medium))
                Text(!account.isEmpty && !recordsLoaded ? "数据暂不可用" : "完成第 1 场面试后生成").font(V3.sans(12)).foregroundStyle(V3.fnt)
            }
            HStack(alignment: .top, spacing: 0) {
                ghost("综合表现", "平均分、完成场次与累计时长") { Text("—").font(V3.number(26, weight: .bold)).foregroundStyle(V3.fnt2).frame(width: 96, height: 96).overlay(Circle().stroke(V3.field, lineWidth: 9)) }
                ghost("得分趋势", "完成 2 场后显示变化") {
                    Canvas { context, _ in
                        let points = [CGPoint(x: 10, y: 70), CGPoint(x: 75, y: 58), CGPoint(x: 140, y: 64), CGPoint(x: 210, y: 36)]
                        var path = Path(); path.addLines(points)
                        context.stroke(path, with: .color(Color(hex: 0xCFCFCA)), style: StrokeStyle(lineWidth: 1.4, dash: [4, 3]))
                        for point in points { context.fill(Path(ellipseIn: CGRect(x: point.x - 3.5, y: point.y - 3.5, width: 7, height: 7)), with: .color(Color(hex: 0xD8D8D3))) }
                    }.frame(width: 220, height: 96)
                }
                ghost("能力雷达", "按五个维度找出薄弱项") { radar([], labels: false, weak: nil).frame(width: 104, height: 96) }
            }.padding(.top, 20)
        }
        .padding(.horizontal, 24).padding(.vertical, 21).frame(height: 251, alignment: .top)
        .background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
        .padding(.top, 20)
    }
    private func ghost<Art: View>(_ title: String, _ subtitle: String, @ViewBuilder art: () -> Art) -> some View {
        VStack(spacing: 8) {
            art().frame(height: 110)
            Text(title).font(V3.sans(13, weight: .medium)).foregroundStyle(V3.txt)
            Text(subtitle).font(V3.sans(11.5)).foregroundStyle(V3.fnt)
        }.frame(maxWidth: .infinity)
    }
    private func otherJobs(title: String, excluding: String?) -> some View {
        let list = applications.filter { $0.id != excluding }
        let sorted = list.sorted { ($0.raw.text("next_session_start_at").isEmpty ? "9999" : $0.raw.text("next_session_start_at")) < ($1.raw.text("next_session_start_at").isEmpty ? "9999" : $1.raw.text("next_session_start_at")) }.prefix(3)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(title).font(V3.sans(15, weight: .semibold)).foregroundStyle(V3.txt)
                Rectangle().fill(.clear).frame(height: 1)
                Text(careerError != nil ? "岗位看板暂时没有加载出来" : "来自岗位看板 · \(list.count) 个").font(V3.sans(12)).foregroundStyle(V3.fnt)
            }.frame(height: 18)
            if !sorted.isEmpty {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(sorted)) { app in
                        let next = CareerApplication.date(app.raw.text("next_session_start_at"))
                        let soon = next.map { $0.timeIntervalSinceNow < 14 * 86400 } ?? false
                        VStack(alignment: .leading, spacing: 0) {
                            Text(app.company + " · " + app.title).font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
                            HStack(spacing: 6) {
                                Circle().fill(soon ? V3.orange : V3.fnt).frame(width: 6, height: 6)
                                Text(next.map { format($0, "MM-dd") + " " + app.raw.text("current_stage_label") } ?? app.raw.text("current_stage_label") + " · " + (["awaiting_schedule": "待约面", "scheduled": "已约面", "awaiting_result": "等结果", "negotiating": "谈薪中"][app.raw.text("stage_state")] ?? "进行中"))
                                    .font(V3.sans(11.5)).foregroundStyle(V3.sub).lineLimit(1)
                            }.padding(.top, 10)
                            Text(practice(app.id)).font(V3.sans(11.5)).foregroundStyle(V3.fnt).padding(.top, 10)
                            Button("针对这个岗位练习") { start(app.id) }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 33)).padding(.top, 10)
                        }
                        .padding(.horizontal, 17).padding(.vertical, 15).frame(maxWidth: .infinity, alignment: .leading).frame(height: 137, alignment: .top)
                        .background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
                    }
                    ForEach(0..<max(0, 3 - sorted.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                }
            }
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("没有具体岗位？做一场通用练习").font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt)
                    Text("只根据你的简历出题，适合日常保持手感").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
                }
                Spacer()
                Button("开始通用练习") { start() }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 33))
            }.padding(.horizontal, 20).frame(height: 61).background(V3.field, in: RoundedRectangle(cornerRadius: 14))
        }.padding(.top, 20)
    }
    /// `RadarChart`: five-axis polygon, 1–5 scale; labels sit outside the outer ring.
    private func radar(_ dimensions: [JSONValue], labels: Bool, weak: String?) -> some View {
        GeometryReader { geometry in
            let count = dimensions.isEmpty ? 5 : max(3, dimensions.count)
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2 + (labels ? 2 : 0))
            let radius = labels ? 48.0 : min(geometry.size.width, geometry.size.height) * 0.46
            let point = { (index: Int, scale: Double) -> CGPoint in
                let angle = Double(index) * 2 * .pi / Double(count) - .pi / 2
                return CGPoint(x: center.x + cos(angle) * radius * scale, y: center.y + sin(angle) * radius * scale)
            }
            ZStack {
                Canvas { context, _ in
                    for scale in [0.4, 0.7, 1.0] {
                        var outline = Path(); for i in 0..<count { if i == 0 { outline.move(to: point(i, scale)) } else { outline.addLine(to: point(i, scale)) } }; outline.closeSubpath()
                        if scale == 1 { context.fill(outline, with: .color(.white)) }
                        context.stroke(outline, with: .color(V3.cl), lineWidth: 1)
                    }
                    if !dimensions.isEmpty {
                        var values = Path()
                        for i in 0..<dimensions.count { let p = point(i, min(5, max(0, dimensions[i]["score"]?.numberValue ?? 0)) / 5); if i == 0 { values.move(to: p) } else { values.addLine(to: p) } }
                        values.closeSubpath()
                        context.fill(values, with: .color(V3.blue.opacity(0.14))); context.stroke(values, with: .color(V3.blue), lineWidth: 1.5)
                    }
                }
                if labels {
                    ForEach(dimensions.indices, id: \.self) { index in
                        let angle = Double(index) * 2 * .pi / Double(count) - .pi / 2
                        let key = dimensions[index].text("key")
                        HStack(spacing: 3) {
                            Text(MockInterview.dimensions[key] ?? key)
                            Text(String(format: "%.1f", dimensions[index]["score"]?.numberValue ?? 0)).font(V3.number(10.5, weight: .semibold))
                        }
                        .font(V3.sans(10.5)).foregroundStyle(key == weak ? V3.orange : V3.sub).fixedSize()
                        .position(x: center.x + cos(angle) * 80, y: center.y + sin(angle) * 70)
                    }
                }
            }
        }
    }
    private func practice(_ id: String) -> String {
        let mine = records.filter { $0.raw.text("job_application_id") == id }
        let done = mine.filter { $0.status == "completed" }
        if !done.isEmpty { return "\(done.count) 场 · \(Int((done.compactMap { $0.raw["total_score"]?.numberValue }.max() ?? 0).rounded())) 分" }
        let abandoned = mine.filter { $0.status == "abandoned" }.count
        return abandoned > 0 ? "\(abandoned) 场已放弃" : "未练习"
    }

    // MARK: 07.1 Records

    private func interviewTitle(_ item: MockInterview) -> String {
        let company = item.raw.text("company_name"), title = item.raw.text("job_title")
        if !company.isEmpty { return company + (title.isEmpty ? "" : " · " + title) }
        if !item.raw.text("target_role").isEmpty { return item.raw.text("target_role") }
        return "通用练习 · " + item.type
    }
    private func typeDifficulty(_ item: MockInterview) -> String { item.type + " · " + (["junior": "初级", "intermediate": "中级", "senior": "高级"][item.raw.text("difficulty")] ?? "中级") }
    private var recordList: some View {
        let done = records.filter { $0.status == "completed" }
        let abandoned = records.filter { $0.status == "abandoned" }
        let titles = Array(Set(records.map(interviewTitle))).sorted()
        let shown = records
            .filter { recordStatus == "all" || $0.status == recordStatus }
            .filter { recordJob == "all" || interviewTitle($0) == recordJob }
            .filter { recordType == "all" || $0.raw.text("interview_type") == recordType }
            .sorted { left, right in
                if recordSort == "score" { return (left.raw["total_score"]?.numberValue ?? -1) > (right.raw["total_score"]?.numberValue ?? -1) }
                return recordSort == "oldest" ? left.raw.text("created_at") < right.raw.text("created_at") : left.raw.text("created_at") > right.raw.text("created_at")
            }
        return VStack(alignment: .leading, spacing: 0) {
            eyebrow(["练习记录"])
            HStack {
                Text("练习记录").font(V3.serif(28)).foregroundStyle(V3.txt)
                Spacer()
                Button("开始新面试") { start() }.buttonStyle(V3ButtonStyle(kind: .dark, height: 31))
            }.frame(minHeight: 40).padding(.top, 9)
            Text("共 \(records.count) 场 · 已完成 \(done.count) · 已放弃 \(abandoned.count) · 累计 " + String(format: "%.1f", practiceHours) + " 小时").font(V3.sans(12.5)).foregroundStyle(V3.fnt).padding(.top, 6)
            HStack(spacing: 8) {
                V3Segmented(options: [("all", "全部 \(records.count)"), ("completed", "已完成 \(done.count)"), ("abandoned", "已放弃 \(abandoned.count)")], selection: $recordStatus, height: 28)
                Picker("按岗位筛选", selection: $recordJob) { Text("岗位：全部").tag("all"); ForEach(titles, id: \.self) { Text($0).tag($0) } }.labelsHidden().frame(width: 150)
                Picker("按类型筛选", selection: $recordType) { Text("类型：全部").tag("all"); ForEach(["technical", "project_deep_dive", "comprehensive", "hr"], id: \.self) { Text(MockInterview.types[$0]!).tag($0) } }.labelsHidden().frame(width: 110)
                Spacer()
                Picker("排序", selection: $recordSort) { Text("按时间 · 最新").tag("latest"); Text("按时间 · 最早").tag("oldest"); Text("按得分 · 最高").tag("score") }.labelsHidden().frame(width: 130)
            }.controlSize(.small).padding(.top, 20)
            VStack(spacing: 0) {
                recordRow(header: true, cells: ["场次", "类型 · 难度", "题数", "得分", "状态", "时间"].map { AnyView(Text($0)) })
                    .frame(height: 34).background(V3.field)
                if records.isEmpty {
                    Text(account.isEmpty ? "登录后查看你的练习记录。" : recordsLoaded ? "还没有练习记录。" : "练习记录暂不可用，请重新加载。").font(V3.sans(12.5)).foregroundStyle(V3.fnt).frame(maxWidth: .infinity).padding(.vertical, 28)
                }
                ForEach(Array(shown.enumerated()), id: \.element.id) { index, item in
                    Rectangle().fill(V3.line).frame(height: 1)
                    Button { open(item) } label: { recordLine(item, latest: index == 0 && recordSort == "latest" && recordStatus == "all") }
                        .buttonStyle(CareerRowStyle()).accessibilityLabel("\(interviewTitle(item))，\(item.label)")
                }
                Rectangle().fill(V3.line).frame(height: 1)
                Text(shown.isEmpty ? "没有符合条件的练习记录" : "已显示全部 \(shown.count) 场 · 点击任意一行查看评估报告").font(V3.sans(11.5)).foregroundStyle(V3.fnt).frame(maxWidth: .infinity).frame(height: 39)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl)).padding(.top, 20)
        }
    }
    private func recordRow(header: Bool, cells: [AnyView]) -> some View {
        HStack(spacing: 0) {
            cells[0].frame(minWidth: 268, maxWidth: .infinity, alignment: .leading).layoutPriority(2)
            cells[1].frame(minWidth: 136, maxWidth: .infinity, alignment: .leading)
            cells[2].frame(width: 76, alignment: .leading)
            cells[3].frame(minWidth: 166, maxWidth: .infinity, alignment: .leading)
            cells[4].frame(width: 86, alignment: .leading)
            cells[5].frame(minWidth: 90, maxWidth: .infinity, alignment: .trailing)
        }.font(V3.sans(header ? 11.5 : 12.5)).foregroundStyle(header ? V3.fnt : V3.sub).padding(.horizontal, 20)
    }
    private func recordLine(_ item: MockInterview, latest: Bool) -> some View {
        let score = item.raw["total_score"]?.numberValue
        let previous = completed.filter { interviewTitle($0) == interviewTitle(item) && $0.raw.text("created_at") < item.raw.text("created_at") }.max { $0.raw.text("created_at") < $1.raw.text("created_at") }
        let delta = item.status == "completed" ? score.flatMap { s in previous?.raw["total_score"]?.numberValue.map { Int((s - $0).rounded()) } } : nil
        let source = !item.raw.text("repeat_of_id").isEmpty ? "再练一次" : item.raw.text("source_type") == "job_application" ? "来自求职记录" + (item.raw.text("stage_label").isEmpty ? "" : " · " + item.raw.text("stage_label")) : "来自简历「\(item.raw.text("resume_title"))」"
        let statusTone: (Color, Color) = item.status == "completed" ? (Color(hex: 0x2E8C57), Color(hex: 0x2E8C57).opacity(0.10))
            : ["in_progress", "preparing", "evaluating"].contains(item.status) ? (V3.blue, V3.blue.opacity(0.10))
            : item.status.hasSuffix("failed") ? (Color(hex: 0xB3402E), Color(hex: 0xF7E7E3)) : (V3.fnt, V3.field)
        return recordRow(header: false, cells: [
            AnyView(VStack(alignment: .leading, spacing: 3) {
                Text(interviewTitle(item)).font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
                Text(source).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
            }.padding(.trailing, 12)),
            AnyView(Text(typeDifficulty(item))),
            AnyView(Text("\(item.raw["question_count"]?.integer ?? 0) 题")),
            AnyView(Group {
                if let score, item.status == "completed" {
                    HStack(spacing: 8) {
                        Text("\(Int(score.rounded()))").font(V3.number(16, weight: .bold)).foregroundStyle(V3.txt).frame(width: 22, alignment: .leading)
                        ZStack(alignment: .leading) {
                            Capsule().fill(V3.line).frame(width: 60, height: 4)
                            Capsule().fill(score >= 80 ? Color(hex: 0x2E8C57) : score >= 70 ? V3.blue : V3.orange).frame(width: 60 * min(1, score / 100), height: 4)
                        }
                        if let delta, delta != 0 { Text(delta > 0 ? "+\(delta)" : "−\(-delta)").font(V3.number(11, weight: .medium)).foregroundStyle(delta > 0 ? Color(hex: 0x2E8C57) : V3.red) }
                    }
                } else { Text("—").foregroundStyle(V3.fnt) }
            }),
            AnyView(Text(item.label).font(V3.sans(11, weight: .medium)).foregroundStyle(statusTone.0).padding(.horizontal, 8).frame(height: 17).background(statusTone.1, in: Capsule())),
            AnyView(Text(CareerApplication.date(item.raw.text("created_at")).map { format($0, "MM-dd HH:mm") } ?? "").font(V3.number(12, weight: .regular)).foregroundStyle(V3.fnt)),
        ])
        .frame(height: 58).background(latest ? V3.blue.opacity(0.04) : .clear).contentShape(Rectangle())
    }

    // MARK: 07.1 New

    private let typeHints = ["technical": "考察技术原理、编码与系统设计", "project_deep_dive": "围绕简历里的项目层层追问：背景、方案、取舍与结果", "comprehensive": "技术、项目与软素质各问一些，适合还不确定考察重点时", "hr": "动机、职业规划、协作与薪资期望"]
    private let difficultyHints = ["junior": "从事实与原理问起，追问到方案权衡为止", "intermediate": "从原理与权衡问起，追问会触及边界情况", "senior": "从方案权衡问起，追问会深入到边界情况与迁移能力"]
    private var configuration: some View {
        let summary = "\(count) 道题 · \(language == "zh" ? "中文" : "英文") · \(follow ? "允许追问" : "不追问") · " + (chosenMaterials.isEmpty ? "未选参考资料" : "\(chosenMaterials.count) 份参考资料")
        return VStack(alignment: .leading, spacing: 0) {
            eyebrow(["新建"])
            Text("开始一场模拟面试").font(V3.serif(28)).foregroundStyle(V3.txt).padding(.top, 9)
            Text("选一份简历，再告诉面试官你要面哪个岗位。").font(V3.sans(13)).foregroundStyle(V3.sub).padding(.top, 6)
            newField("简历", top: 42) {
                Picker("简历", selection: $resume) {
                    Text(resumes.isEmpty ? (loading ? "正在加载简历…" : "还没有简历，先去创建一份") : "选择一份简历").tag("")
                    ForEach(resumes, id: \.self) { Text($0.text("title")).tag($0.text("id")) }
                }.labelsHidden().controlSize(.large).disabled(resumes.isEmpty)
                if resumes.isEmpty && !loading { hint("模拟面试需要一份简历，请先在 Web 创建或导入简历后刷新。") }
            }
            newField("目标岗位", optional: true) {
                Picker("目标岗位", selection: $job) {
                    Text("不指定岗位").tag("__none"); Text("粘贴一段 JD").tag("__jd")
                    ForEach(applications) { Text($0.company + " · " + $0.title).tag($0.id) }
                }.labelsHidden().controlSize(.large)
                if job == "__jd" {
                    TextEditor(text: $jd).font(V3.sans(13)).scrollContentBackground(.hidden).padding(8).frame(height: 140)
                        .background(.white, in: RoundedRectangle(cornerRadius: 9)).overlay(RoundedRectangle(cornerRadius: 9).stroke(V3.cl)).padding(.top, 10)
                        .overlay(alignment: .topLeading) { if jd.isEmpty { Text("粘贴岗位描述，面试官会按 JD 要求出题").font(V3.sans(13)).foregroundStyle(V3.fnt2).padding(.leading, 13).padding(.top, 18).allowsHitTesting(false) } }
                } else {
                    HStack(spacing: 8) {
                        Text(job == "__none" ? "只根据你的简历出题，适合日常保持手感。" : "将带入该求职记录的 JD 和当前阶段。")
                        Button("没有求职记录？粘贴 JD") { job = "__jd" }.buttonStyle(.plain).foregroundStyle(V3.blue)
                    }.font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top, 10)
                }
                if let careerError { hint(careerError) }
            }
            newField("面试类型") {
                V3Segmented(options: ["technical", "project_deep_dive", "comprehensive", "hr"].map { ($0, MockInterview.types[$0]!) }, selection: Binding(get: { type }, set: { type = $0; typeTouched = true }), height: 36)
                hint((typeHints[type] ?? "") + ((!typeTouched && applications.contains { $0.id == job }) ? " · 已按「\(applications.first { $0.id == job }!.stageLabel)」推荐" : ""))
            }
            newField("难度") {
                V3Segmented(options: [("junior", "初级"), ("intermediate", "中级"), ("senior", "高级")], selection: $difficulty, height: 36)
                hint(difficultyHints[difficulty] ?? "")
            }
            newField("作答方式") {
                HStack(spacing: 10) {
                    Image(systemName: "keyboard").font(.system(size: 14)).foregroundStyle(V3.txt)
                    VStack(alignment: .leading, spacing: 3) { Text("文字作答").font(V3.sans(13, weight: .medium)); Text("在输入框里回答，可随时修改").font(V3.sans(11)).foregroundStyle(V3.fnt) }
                    Spacer()
                    Text("语音面试请在 Web 进行").font(V3.sans(11)).foregroundStyle(V3.fnt)
                }.padding(.horizontal, 14).frame(height: 56).background(.white, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(V3.txt, lineWidth: 1.5))
            }
            Button { moreOpen = true } label: {
                HStack(spacing: 10) {
                    Text("更多设置").font(V3.sans(12.5, weight: .medium)).foregroundStyle(V3.txt).frame(maxWidth: .infinity, alignment: .leading)
                    Text(summary).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                    Image(systemName: "chevron.right").font(.system(size: 10)).foregroundStyle(V3.fnt)
                }.padding(.horizontal, 16).frame(height: 48).background(V3.stage, in: RoundedRectangle(cornerRadius: 10)).contentShape(Rectangle())
            }.buttonStyle(.plain).padding(.top, 39).disabled(busy || createUnknown)
            Button(busy ? "正在创建…" : "开始面试") { Task { await create() } }
                .buttonStyle(V3PrimaryBlockStyle()).padding(.top, 40)
                .disabled(loading || busy || createUnknown || resume.isEmpty || (job == "__jd" && jd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            Text("准备约 30 秒 · 同一时间只能进行一场模拟面试").font(V3.sans(11)).foregroundStyle(V3.fnt).frame(maxWidth: .infinity).padding(.top, 14)
            if createUnknown { Text("创建结果尚未确认。返回首页并刷新，确认是否已有进行中的场次，避免重复创建。").font(V3.sans(12)).foregroundStyle(V3.orange).padding(.top, 12) }
        }.disabled(busy && !createUnknown)
    }
    private func newField<Content: View>(_ title: String, optional: Bool = false, top: CGFloat = 39, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(V3.sans(12.5, weight: .medium)).foregroundStyle(V3.txt)
                if optional { Text("可选").font(V3.sans(11)).foregroundStyle(V3.fnt) }
            }.padding(.bottom, 11)
            content()
        }.padding(.top, top)
    }
    private func hint(_ text: String) -> some View { Text(text).font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top, 10) }
    private var moreSettings: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("更多设置").font(V3.serif(20)).foregroundStyle(V3.txt)
            Text("主问题数量、追问与语言；参考资料用于出题和事实核验。").font(V3.sans(12.5)).foregroundStyle(V3.sub).padding(.top, 5).padding(.bottom, 12)
            moreRow("主问题数", "3–10 道，不含追问") {
                Picker("主问题数", selection: $count) { ForEach(3...10, id: \.self) { Text("\($0) 道题 · 约 \(estimate($0)) 分钟").tag($0) } }.labelsHidden().frame(width: 180)
            }
            moreRow("允许追问", "每道主问题最多追问 2 次") { Toggle("允许追问", isOn: $follow).labelsHidden().toggleStyle(.switch) }
            moreRow("面试语言", "面试官提问与报告使用的语言") { V3Segmented(options: [("zh", "中文"), ("en", "英文")], selection: $language) }
            HStack(alignment: .firstTextBaseline) {
                Text("参考资料").font(V3.sans(13, weight: .medium))
                Spacer()
                Text("\(chosenMaterials.count) / 10 · 只能选解析成功的文档").font(V3.sans(11)).foregroundStyle(V3.fnt)
            }.padding(.top, 16)
            if materials.isEmpty {
                Text("资料库里还没有可用的文档，可以先去资料库上传。").font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.top, 10)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(Array(materials.enumerated()), id: \.offset) { index, item in
                            if index > 0 { Rectangle().fill(V3.line).frame(height: 1) }
                            let checked = chosenMaterials.contains(item.text("id"))
                            let full = !checked && chosenMaterials.count >= 10
                            Toggle(isOn: Binding(get: { checked }, set: { on in if on { if chosenMaterials.count < 10 { chosenMaterials.insert(item.text("id")) } } else { chosenMaterials.remove(item.text("id")) } })) {
                                HStack(spacing: 10) {
                                    Image(systemName: "doc.text").font(.system(size: 12)).foregroundStyle(V3.sub)
                                    Text(item.text("file_name")).font(V3.sans(12.5)).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                                    Text(item.text("file_format").uppercased()).font(V3.number(10.5, weight: .regular)).foregroundStyle(V3.fnt)
                                }
                            }.toggleStyle(.checkbox).padding(.horizontal, 12).frame(height: 40).disabled(full).opacity(full ? 0.45 : 1)
                        }
                    }
                }.frame(maxHeight: 220).overlay(RoundedRectangle(cornerRadius: 10).stroke(V3.cl)).padding(.top, 10)
                Toggle("出题参考所选资料（关闭时仅用于报告事实核验）", isOn: $materialsInQuestions).font(V3.sans(12)).disabled(chosenMaterials.isEmpty).padding(.top, 10)
            }
            HStack(spacing: 10) {
                Spacer()
                Button("完成") { moreOpen = false }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).keyboardShortcut(.defaultAction)
            }.padding(.top, 24)
        }.padding(28)
    }
    private func moreRow<Control: View>(_ title: String, _ subtitle: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 3) { Text(title).font(V3.sans(13, weight: .medium)); Text(subtitle).font(V3.sans(11)).foregroundStyle(V3.fnt) }
            Spacer()
            control()
        }.frame(minHeight: 56).overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
    }

    // MARK: 07.2 Session

    private func sessionEyebrow(_ item: MockInterview) -> [String] {
        [item.raw.text("company_name").isEmpty ? nil : interviewTitle(item), item.type, ["junior": "初级", "intermediate": "中级", "senior": "高级"][item.raw.text("difficulty")]].compactMap { $0 }
    }
    private func sessionHead<Actions: View>(_ item: MockInterview, @ViewBuilder actions: () -> Actions) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 0) {
                eyebrow(sessionEyebrow(item))
                Text(item.raw.text("stage_label").isEmpty ? "模拟面试 · 通用练习" : "模拟面试 · \(item.raw.text("stage_label"))准备").font(V3.serif(28)).foregroundStyle(V3.txt).padding(.top, 9)
            }
            Spacer()
            HStack(spacing: 8) { actions() }.padding(.top, 28)
        }.frame(height: 108, alignment: .top).overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
    }
    private func statusPanel<Actions: View>(failed: Bool, title: String, message: String, steps: Bool = false, item: MockInterview? = nil, @ViewBuilder actions: () -> Actions) -> some View {
        VStack(spacing: 0) {
            if failed {
                Image(systemName: "exclamationmark.triangle").font(.system(size: 16)).foregroundStyle(Color(hex: 0xB3402E)).frame(width: 36, height: 36).background(Color(hex: 0xFBF3F1), in: Circle())
            } else if !title.contains("已放弃") { ProgressView().controlSize(.regular) }
            Text(title).font(V3.serif(17)).foregroundStyle(V3.txt).padding(.top, 20)
            Text(message).font(V3.sans(12)).foregroundStyle(V3.fnt).multilineTextAlignment(.center).padding(.horizontal, 24).padding(.top, 6)
            if steps, let item {
                let step = failed ? 1 : min(2, Int(Date().timeIntervalSince(CareerApplication.date(item.raw.text("created_at")) ?? Date()) / 0.9))
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(["分析简历与岗位背景", "制定考察计划", "生成第一道问题"].enumerated()), id: \.offset) { index, name in
                        let state = index < step ? "done" : index == step ? (failed ? "failed" : "active") : "todo"
                        HStack(alignment: .top, spacing: 12) {
                            ZStack {
                                Circle().fill(state == "done" ? V3.txt : .clear).overlay(Circle().stroke(state == "todo" ? Color(hex: 0xC4C4BE) : state == "failed" ? V3.red : V3.txt))
                                if state == "done" { Image(systemName: "checkmark").font(.system(size: 7, weight: .bold)).foregroundStyle(.white) }
                            }.frame(width: 16, height: 16)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(name).font(V3.sans(13, weight: .medium)).foregroundStyle(state == "todo" ? V3.fnt : V3.txt)
                                if state == "done" && index < 2 { Text(["识别简历中可追问的主张与岗位要求", "筛选考察点并按难度设定深度"][index]).font(V3.sans(11)).foregroundStyle(V3.fnt) }
                            }
                        }.frame(minHeight: index == 2 ? 16 : 52, alignment: .top)
                    }
                }.frame(width: 320, alignment: .leading).padding(.top, 36)
            }
            HStack(spacing: 10) { actions() }.padding(.top, 24)
        }
        .padding(.top, 36).padding(.bottom, 40).frame(width: 520)
        .background(.white, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
        .frame(maxWidth: .infinity).padding(.top, 99)
    }
    @ViewBuilder private func interview(_ item: MockInterview) -> some View {
        if item.status == "completed" { report(item) }
        else if ["preparing", "preparation_failed"].contains(item.status) {
            VStack(alignment: .leading, spacing: 0) {
                sessionHead(item) { Button("取消本场") { confirmation = "abandon" }.buttonStyle(.plain).font(V3.sans(11.5)).foregroundStyle(V3.sub).disabled(busy) }
                statusPanel(failed: item.status == "preparation_failed", title: item.status == "preparation_failed" ? "面试官没能准备好题目" : "面试官正在准备题目",
                            message: item.status == "preparation_failed" ? explainCode(item.raw.text("error_code")) : "通常需要 20–40 秒，可以离开此页，准备完成后回到这里继续。", steps: true, item: item) {
                    if item.status == "preparation_failed" {
                        Button("返回") { goHome() }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 36))
                        Button("重试") { Task { await commandAction("retry") } }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy)
                    }
                }
            }
        } else if ["evaluating", "evaluation_failed"].contains(item.status) {
            VStack(alignment: .leading, spacing: 0) {
                sessionHead(item) { EmptyView() }
                statusPanel(failed: item.status == "evaluation_failed", title: item.status == "evaluation_failed" ? "评估报告没能生成" : "正在生成评估报告",
                            message: item.status == "evaluation_failed" ? "你的作答都已保存，重试即可重新评估。" : "面试官正在逐题评估你的回答，约需 1 分钟，可以离开此页。") {
                    if item.status == "evaluation_failed" {
                        Button("返回") { goHome() }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 36))
                        Button("重试评估") { Task { await commandAction("retry") } }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy)
                    }
                }
            }
        } else if item.status == "abandoned" {
            VStack(alignment: .leading, spacing: 0) {
                sessionHead(item) { Button("删除记录") { confirmation = "delete" }.buttonStyle(.plain).font(V3.sans(11.5)).foregroundStyle(V3.red).disabled(busy) }
                statusPanel(failed: false, title: "这场模拟面试已放弃", message: "放弃的场次不生成评估报告，可以用相同配置再练一次。") {
                    Button("返回") { goHome() }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 36))
                    Button("重新开始") { Task { await commandAction("repeat") } }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy || repeatUnknown || item.raw.text("answer_mode") == "voice")
                }
            }
        } else { live(item) }
    }
    private func groups(_ item: MockInterview) -> [(root: JSONValue, follows: [JSONValue])] {
        var result: [(root: JSONValue, follows: [JSONValue])] = []
        for question in item.questions.sorted(by: { ($0["sequence_no"]?.integer ?? 0) < ($1["sequence_no"]?.integer ?? 0) }) {
            if question.text("kind") == "main" || question.text("parent_id").isEmpty { result.append((question, [])) }
            else if let index = result.lastIndex(where: { $0.root.text("id") == question.text("parent_id") }) { result[index].follows.append(question) }
        }
        return result
    }
    private func live(_ item: MockInterview) -> some View {
        let all = groups(item)
        let current = item.current
        let currentRoot = current.map { $0.text("parent_id").isEmpty ? $0.text("id") : $0.text("parent_id") }
        let group = all.first { $0.root.text("id") == currentRoot } ?? all.last
        let mainIndex = (group?.root["plan_index"]?.integer ?? 0) + 1
        let followNo = current?.text("kind") == "follow_up" ? (group?.follows.firstIndex { $0.text("id") == current?.text("id") } ?? 0) + 1 : 0
        let total = max(1, item.raw["question_count"]?.integer ?? 5)
        let needsReply = item.raw["needs_reply"] == .bool(true)
        let locked = busy || current == nil || needsReply || uncertain != nil
        return VStack(alignment: .leading, spacing: 0) {
            sessionHead(item) {
                if let started = CareerApplication.date(item.raw.text("started_at")) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let seconds = max(0, Int(context.date.timeIntervalSince(started)))
                        Text(seconds >= 3600 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds % 3600 / 60, seconds % 60) : String(format: "%02d:%02d", seconds / 60, seconds % 60))
                            .font(V3.number(12, weight: .regular)).foregroundStyle(V3.fnt).padding(.trailing, 8)
                    }
                }
                Button("放弃") { confirmation = "abandon" }.buttonStyle(.plain).font(V3.sans(11.5)).foregroundStyle(V3.sub).padding(.horizontal, 10).disabled(busy)
                Button("结束并评估") { confirmation = "finish" }.buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy || uncertain != nil)
            }
            HStack {
                HStack(spacing: 6) {
                    ForEach(0..<total, id: \.self) { index in
                        RoundedRectangle(cornerRadius: 2).fill(index < mainIndex - 1 ? V3.txt : index == mainIndex - 1 ? V3.orange : V3.line).frame(height: 4)
                    }
                }.frame(maxWidth: 680)
                Spacer()
                Text("第 \(mainIndex) / \(total) 题" + (followNo > 0 ? " · 追问 \(followNo)" : "")).font(V3.sans(11.5, weight: .medium)).foregroundStyle(V3.txt)
            }.frame(height: 24).padding(.bottom, 12).overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(all.enumerated()), id: \.offset) { index, entry in
                    let turns = [entry.root] + entry.follows
                    let done = turns.allSatisfy { $0.text("answer_status") != "pending" } && !turns.contains { $0.text("id") == current?.text("id") }
                    VStack(alignment: .leading, spacing: 0) {
                        ZStack {
                            Rectangle().fill(V3.line).frame(height: 1)
                            Text("Q\((entry.root["plan_index"]?.integer ?? index) + 1) · \(done ? "已完成" : "进行中")").font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.horizontal, 8).background(.white)
                        }.frame(height: 16).padding(.bottom, 22)
                        ForEach(turns, id: \.self) { question in turn(question, isCurrent: question.text("id") == current?.text("id")) }
                    }.padding(.top, index == 0 ? 0 : 30)
                }
            }.padding(.top, 24).padding(.bottom, 16)
            if item.raw.text("answer_mode") == "voice" {
                Text("本场是语音面试，请在 Web 继续作答。原生文字流程不会把纯文字冒充语音回答。").font(V3.sans(12.5)).foregroundStyle(V3.orange)
            } else {
                if needsReply {
                    HStack(spacing: 12) {
                        Text("面试官的回复没有生成出来，你的回答已经保存。").font(V3.sans(13)).foregroundStyle(Color(hex: 0x6B5A2E))
                        Spacer()
                        Button("重新生成回复") { Task { await commandAction("reply:retry") } }.buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy)
                    }.padding(.horizontal, 14).padding(.vertical, 10).background(Color(hex: 0xFBF6EA), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xE8D9B8))).padding(.bottom, 10)
                }
                HStack(alignment: .bottom, spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        TextEditor(text: $draft).font(V3.sans(14)).scrollContentBackground(.hidden).frame(minHeight: 22, maxHeight: 180).fixedSize(horizontal: false, vertical: true)
                            .disabled(locked).accessibilityLabel("你的回答")
                            .onKeyPress(.return, phases: .down) { press in
                                if press.modifiers.contains(.shift) { return .ignored }
                                if let current, !locked, !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, draft.count <= 8000 { Task { await submit(current, skip: false) } }
                                return .handled
                            }
                        if draft.isEmpty {
                            Text(busy ? "面试官提问中，稍后可以作答…" : needsReply ? "面试官的回复没有生成，请先重新生成" : current != nil ? "输入你的回答…" : "面试已结束")
                                .font(V3.sans(14)).foregroundStyle(Color(hex: 0xA3A39C)).padding(.leading, 5).allowsHitTesting(false)
                        }
                    }
                    Button { if let current { Task { await submit(current, skip: false) } } } label: {
                        Image(systemName: "arrow.up").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 32, height: 32).background(locked || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color(hex: 0xC9C9C3) : V3.txt, in: Circle())
                    }.buttonStyle(.plain).accessibilityLabel("发送").disabled(locked || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 8000)
                }
                .padding(.leading, 18).padding(.trailing, 13).padding(.vertical, 13).frame(minHeight: 58)
                .background(Color(hex: 0xFAFAF8), in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).stroke(Color(hex: 0xD6D6D0)))
                .opacity(locked && current != nil ? 0.8 : 1)
                HStack {
                    Button("跳过此题") { if let current { Task { await submit(current, skip: true) } } }.buttonStyle(.plain).font(V3.sans(12.5)).foregroundStyle(V3.sub).disabled(locked)
                    Spacer()
                    Text(busy ? "面试官正在思考…" : "Enter 发送 · Shift + Enter 换行 · \(draft.count) / 8000 字").font(V3.sans(12.5)).foregroundStyle(V3.fnt)
                }.frame(height: 22).padding(.top, 8)
                if let uncertain {
                    HStack(spacing: 10) {
                        Text("上一次提交的结果尚未确认。").font(V3.sans(12)).foregroundStyle(V3.orange)
                        Button("重试原提交") { Task { await sendAnswer(uncertain.command, uncertain.body) } }.buttonStyle(CareerActionStyle(kind: .link)).disabled(busy)
                    }.padding(.top, 8)
                }
            }
        }
    }
    private func turn(_ question: JSONValue, isCurrent: Bool) -> some View {
        let follow = question.text("kind") == "follow_up"
        let answered = question.text("answer_status") == "answered" ? question.text("answer_text") : nil
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(follow ? "追问 · L\(question["depth_level"]?.integer ?? 2)" : "主问题").font(V3.sans(11)).foregroundStyle(follow ? Color(hex: 0xB8691C) : Color(hex: 0x76766F))
                        .padding(.horizontal, 8).frame(height: 19).background(follow ? Color(hex: 0xFDF1E4) : V3.stage, in: RoundedRectangle(cornerRadius: 5))
                    Spacer()
                    if isCurrent && answered == nil && !busy { Text("等待你作答").font(V3.sans(11)).foregroundStyle(V3.fnt2) }
                }
                Text(question.text("content")).font(V3.sans(15)).foregroundStyle(V3.txt).lineSpacing(6).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: 620, alignment: .leading).padding(.bottom, 16)
            if let answered {
                VStack(alignment: .trailing, spacing: 6) {
                    Text(answered).font(V3.sans(14)).foregroundStyle(Color(hex: 0x33332F)).lineSpacing(4).textSelection(.enabled).padding(.horizontal, 16).padding(.vertical, 12)
                        .frame(maxWidth: 520, alignment: .leading).background(V3.stage, in: RoundedRectangle(cornerRadius: 11)).fixedSize(horizontal: false, vertical: true)
                    let at = CareerApplication.date(question.text("answered_at")).map { format($0, "HH:mm") } ?? ""
                    Text(at + " · \(answered.filter { !$0.isWhitespace }.count) 字").font(V3.number(10.5, weight: .regular)).foregroundStyle(V3.fnt)
                }.frame(maxWidth: .infinity, alignment: .trailing).padding(.top, -2).padding(.bottom, 16)
            } else if question.text("answer_status") == "skipped" {
                Text("已跳过此题").font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.horizontal, 16).padding(.vertical, 10).background(V3.stage, in: RoundedRectangle(cornerRadius: 11))
                    .frame(maxWidth: .infinity, alignment: .trailing).padding(.bottom, 16)
            }
        }
    }

    // MARK: 07.3 Report

    private func scoreGrade(_ score: Double) -> (String, Color, Color) {
        score >= 85 ? ("优秀", Color(hex: 0x2F7D4A), Color(hex: 0xE8F3EC)) : score >= 70 ? ("良好", Color(hex: 0x2F7D4A), Color(hex: 0xE8F3EC)) : score >= 60 ? ("合格", Color(hex: 0xB8691C), Color(hex: 0xFBF0E3)) : ("待提升", Color(hex: 0xB3402E), Color(hex: 0xF7E7E3))
    }
    private func reportSection<Content: View>(_ title: String, _ note: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Text(title).font(V3.sans(15, weight: .semibold)).foregroundStyle(V3.txt)
                Text(note).font(V3.sans(12)).foregroundStyle(V3.fnt)
                Rectangle().fill(V3.line).frame(height: 1)
            }.frame(height: 18)
            content()
        }.padding(.top, 40)
    }
    private func report(_ item: MockInterview) -> some View {
        let report = item.raw["report"] ?? .null
        let questions = report["questions"]?.items ?? []
        let answered = questions.filter { $0["skipped"] != .bool(true) }.count
        let follows = item.questions.filter { $0.text("kind") == "follow_up" }.count
        let good = questions.filter { ($0["score"]?.numberValue ?? 0) >= 75 }
        let weak = questions.filter { ($0["score"]?.numberValue ?? 0) < 60 }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    eyebrow([interviewTitle(item)])
                    Text("评估报告").font(V3.serif(28)).foregroundStyle(V3.txt).padding(.top, 8)
                    Text([typeDifficulty(item), "\(item.raw["question_count"]?.integer ?? 0) 题", CareerApplication.date(item.raw.text("finished_at")).map { format($0, "MM-dd HH:mm") } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.top, 8)
                }
                Spacer()
                HStack(spacing: 8) {
                    Button("删除记录") { confirmation = "delete" }.buttonStyle(.plain).font(V3.sans(12)).foregroundStyle(V3.red).padding(.trailing, 4).disabled(busy)
                    Button("返回列表") { screen = "records"; detail = nil; selectedID = "" }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    Button(busy ? "正在创建…" : "再练一次") { Task { await commandAction("repeat") } }.buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy || repeatUnknown || item.raw.text("answer_mode") == "voice")
                }.padding(.top, -8)
            }
            if report == .null {
                Text("这场模拟面试还没有评估报告。").font(V3.sans(13)).foregroundStyle(V3.fnt).padding(.top, 24)
            } else {
                let total = report["total_score"]?.numberValue ?? 0
                let grade = scoreGrade(total)
                HStack(alignment: .top, spacing: 0) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text("总分").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.sub)
                            Text(grade.0).font(V3.sans(11)).foregroundStyle(grade.1).padding(.horizontal, 7).frame(height: 17).background(grade.2, in: RoundedRectangle(cornerRadius: 5))
                        }
                        HStack(alignment: .firstTextBaseline, spacing: 6) { Text(String(format: "%.0f", total)).font(V3.number(56)).foregroundStyle(V3.txt); Text("/ 100").font(V3.number(14, weight: .regular)).foregroundStyle(V3.fnt) }
                        Text("题目 " + String(format: "%.1f", report["question_average"]?.numberValue ?? 0) + " × 70% + 维度 " + String(format: "%.1f", report["dimension_score"]?.numberValue ?? 0) + " × 30%").font(V3.sans(11)).foregroundStyle(V3.fnt)
                        if report["low_confidence"] == .bool(true) { Text("作答样本较少，报告置信度较低").font(V3.sans(11)).foregroundStyle(V3.orange) }
                    }.frame(width: 180, alignment: .leading).padding(.top, 7)
                    Rectangle().fill(V3.cl).frame(width: 1).padding(.horizontal, 28)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(report.text("headline")).font(V3.sans(16, weight: .medium)).foregroundStyle(V3.txt)
                        Text(report.text("summary")).font(V3.sans(13)).foregroundStyle(V3.sub).lineSpacing(6).fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 16) {
                            summaryStat("作答", "\(answered) / \(questions.count) 题"); summaryStat("追问", "\(follows) 次"); summaryStat("表现较好", "\(good.count) 题"); summaryStat("待提升", "\(weak.count) 题")
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 28).padding(.vertical, 24).frame(minHeight: 167, alignment: .top)
                .background(V3.stage, in: RoundedRectangle(cornerRadius: 12)).padding(.top, 40)
                let dims = report["dimensions"]?.items ?? []
                let weakDim = dims.min { ($0["score"]?.numberValue ?? 0) < ($1["score"]?.numberValue ?? 0) }?.text("key")
                reportSection("能力维度", "1–5 分 · 权重随面试类型变化") {
                    HStack(alignment: .top, spacing: 28) {
                        radar(dims, labels: true, weak: weakDim).frame(width: 240, height: 230)
                        VStack(spacing: 0) {
                            ForEach(Array(dims.enumerated()), id: \.offset) { index, dimension in
                                if index > 0 { Rectangle().fill(V3.line).frame(height: 1) }
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 10) {
                                        Text(MockInterview.dimensions[dimension.text("key")] ?? dimension.text("key")).font(V3.sans(13, weight: .medium)).frame(width: 86, alignment: .leading)
                                        ZStack(alignment: .leading) {
                                            Capsule().fill(V3.line).frame(height: 6)
                                            GeometryReader { bar in Capsule().fill(V3.txt).frame(width: bar.size.width * min(1, (dimension["score"]?.numberValue ?? 0) / 5), height: 6) }.frame(height: 6)
                                        }
                                        Text(String(format: "%.1f", dimension["score"]?.numberValue ?? 0)).font(V3.number(13, weight: .semibold)).frame(width: 46, alignment: .trailing)
                                        Text("权重 \(Int(((dimension["weight"]?.numberValue ?? 0) * 100).rounded()))%").font(V3.sans(11)).foregroundStyle(V3.fnt).frame(width: 56, alignment: .trailing)
                                    }
                                    if !dimension.text("comment").isEmpty { Text(dimension.text("comment")).font(V3.sans(12)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true) }
                                }.padding(.vertical, 11)
                            }
                        }.frame(maxWidth: .infinity)
                    }
                }
                reportSection("逐题表现", "点击题目查看完整问答与分析") {
                    VStack(spacing: 8) {
                        ForEach(Array(questions.enumerated()), id: \.offset) { index, evaluation in questionCard(item, evaluation, index: index) }
                    }
                }
                let improvements = report["improvements"]?.items ?? []
                if !improvements.isEmpty {
                    reportSection("改进建议", "按重要程度排序 · \(improvements.count) 条") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(improvements.enumerated()), id: \.offset) { _, entry in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 8) {
                                        let important = entry["important"] == .bool(true) || entry.text("priority") == "high"
                                        Text(important ? "重要" : "建议").font(V3.sans(11)).foregroundStyle(important ? Color(hex: 0xB8691C) : V3.sub).padding(.horizontal, 7).frame(height: 17).background(important ? Color(hex: 0xFBF0E3) : V3.stage, in: RoundedRectangle(cornerRadius: 5))
                                        Text(entry.stringValue ?? entry.text("title").nonEmptyOr(entry.text("suggestion"))).font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt)
                                    }
                                    let body = [entry.text("description"), entry.text("action")].filter { !$0.isEmpty }.joined(separator: " ")
                                    if !body.isEmpty { Text(body).font(V3.sans(12.5)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true) }
                                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
                            }
                        }
                    }
                }
                let risks = report["resume_risks"]?.items ?? []
                if !risks.isEmpty {
                    reportSection("简历风险", "被追问时可能站不住的内容 · \(risks.count) 条") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(risks.enumerated()), id: \.offset) { _, entry in
                                VStack(alignment: .leading, spacing: 8) {
                                    if !entry.text("quote").isEmpty { HStack(spacing: 6) { Text("简历原文").font(V3.sans(11)).foregroundStyle(V3.fnt); Text("「\(entry.text("quote"))」").font(V3.sans(13, weight: .medium)) } }
                                    Text(entry.stringValue ?? entry.text("risk").nonEmptyOr(entry.text("description"))).font(V3.sans(12.5)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true)
                                    if !entry.text("suggestion").isEmpty { HStack(alignment: .top, spacing: 6) { Text("修改建议").font(V3.sans(12, weight: .medium)); Text(entry.text("suggestion")).font(V3.sans(12)).foregroundStyle(V3.sub) } }
                                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
                            }
                        }
                    }
                }
                let facts = report["fact_check"]?["items"]?.items ?? []
                let factStatus = report["fact_check"]?.text("status") ?? ""
                if !factStatus.isEmpty && factStatus != "not_requested" {
                    reportSection("事实核验", factStatus == "failed" ? "资料读取失败，本次未核验" : "对照所选资料 · \(facts.count) 条") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 8) {
                                        let verdict = ["consistent": "一致", "conflict": "冲突", "not_found": "未找到依据", "stronger_in_material": "资料更强", "material_stronger": "资料更强"][fact.text("verdict")] ?? fact.text("verdict")
                                        Text(verdict).font(V3.sans(11)).foregroundStyle(fact.text("verdict") == "conflict" ? Color(hex: 0xB8691C) : V3.sub).padding(.horizontal, 7).frame(height: 17).background(fact.text("verdict") == "conflict" ? Color(hex: 0xFBF0E3) : V3.stage, in: RoundedRectangle(cornerRadius: 5))
                                        Text(fact.text("claim")).font(V3.sans(13, weight: .medium)).lineLimit(2)
                                    }
                                    if !fact.text("note").isEmpty { Text(fact.text("note")).font(V3.sans(12)).foregroundStyle(V3.sub) }
                                    if !fact.text("quote").isEmpty { Text((fact["source"]?.text("title") ?? fact.text("file_name")).nonEmptyOr("资料") + "：" + fact.text("quote")).font(V3.sans(12)).foregroundStyle(V3.fnt).textSelection(.enabled) }
                                }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
                            }
                        }
                    }
                }
                Text("评分规则 \(report.text("rubric_version").nonEmptyOr("v1")) · 分数由固定规则计算，模型只判断单条标准并给出原文依据").font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top, 40)
            }
        }
    }
    private func summaryStat(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) { Text(label).foregroundStyle(V3.fnt); Text(value).fontWeight(.medium).foregroundStyle(V3.txt) }.font(V3.sans(12))
    }
    private func questionCard(_ item: MockInterview, _ evaluation: JSONValue, index: Int) -> some View {
        let score = evaluation["score"]?.numberValue ?? 0
        let tone: Color = score >= 75 ? Color(hex: 0x2F7D4A) : score >= 60 ? Color(hex: 0xB8691C) : Color(hex: 0xB3402E)
        let root = item.questions.first { $0["sequence_no"] == evaluation["sequence_no"] && $0.text("kind") == "main" }
        let turns = item.questions.filter { root != nil && ($0.text("id") == root?.text("id") || $0.text("parent_id") == root?.text("id")) }
            .sorted { ($0["sequence_no"]?.integer ?? 0) < ($1["sequence_no"]?.integer ?? 0) }
        let followCount = max(0, turns.count - 1)
        let open = openQuestion == index
        return VStack(alignment: .leading, spacing: 0) {
            Button { openQuestion = open ? nil : index } label: {
                HStack(spacing: 12) {
                    Text("Q\(index + 1)").font(V3.number(12, weight: .semibold)).foregroundStyle(V3.fnt).frame(width: 28, alignment: .leading)
                    Text(evaluation.text("topic").nonEmptyOr(root?.text("content") ?? "")).font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    Text(evaluation["skipped"] == .bool(true) ? "已跳过" : followCount > 0 ? "\(followCount) 次追问" : "无追问").font(V3.sans(11)).foregroundStyle(V3.fnt)
                    Text("深度 L\(evaluation["achieved_depth"]?.integer ?? 0)").font(V3.sans(11)).foregroundStyle(V3.sub).padding(.horizontal, 7).frame(height: 17).background(V3.stage, in: RoundedRectangle(cornerRadius: 5))
                    Text(String(format: "%.0f", score)).font(V3.number(15, weight: .bold)).foregroundStyle(tone).frame(width: 32, alignment: .trailing)
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 10)).foregroundStyle(V3.fnt)
                }.padding(.horizontal, 16).frame(height: 52).contentShape(Rectangle())
            }.buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 14) {
                    Rectangle().fill(V3.line).frame(height: 1)
                    Text("问答记录").font(V3.sans(13, weight: .medium))
                    ForEach(turns, id: \.self) { question in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(question.text("kind") == "main" ? "主问题" : "追问").font(V3.sans(11, weight: .medium)).foregroundStyle(V3.fnt)
                            Text(question.text("content")).font(V3.sans(13)).foregroundStyle(V3.txt).fixedSize(horizontal: false, vertical: true)
                            Text(question.text("answer_status") == "skipped" ? "这道题跳过了，记 0 分。" : question.text("answer_text")).font(V3.sans(12.5)).foregroundStyle(V3.sub)
                                .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(V3.stage, in: RoundedRectangle(cornerRadius: 10)).textSelection(.enabled)
                        }
                    }
                    Text("详细分析").font(V3.sans(13, weight: .medium)).padding(.top, 4)
                    ForEach(evaluation["signals"]?.items ?? [], id: \.self) { signal in
                        HStack(alignment: .top, spacing: 8) {
                            let verdict = signal.text("verdict")
                            Text(["hit": "命中", "partial": "部分", "miss": "未命中"][verdict] ?? verdict).font(V3.sans(11)).foregroundStyle(verdict == "hit" ? Color(hex: 0x2F7D4A) : verdict == "partial" ? Color(hex: 0xB8691C) : Color(hex: 0xB3402E))
                                .padding(.horizontal, 7).frame(height: 17).background(V3.stage, in: RoundedRectangle(cornerRadius: 5))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(signal.text("signal")).font(V3.sans(12.5, weight: .medium))
                                Text(signal.text("evidence").isEmpty ? "回答中未涉及" : "“\(signal.text("evidence"))”").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
                            }
                        }
                    }
                    HStack(alignment: .top, spacing: 16) {
                        bulletList("亮点", evaluation["highlights"], tone: Color(hex: 0x2F7D4A))
                        bulletList("待改进", evaluation["weaknesses"], tone: V3.orange)
                    }
                    if let errors = evaluation["factual_errors"]?.items, !errors.isEmpty { bulletList("事实错误", evaluation["factual_errors"], tone: V3.red) }
                    if !evaluation.text("reference_answer").isEmpty {
                        VStack(alignment: .leading, spacing: 6) { Text("参考思路").font(V3.sans(12.5, weight: .medium)); Text(evaluation.text("reference_answer")).font(V3.sans(12.5)).foregroundStyle(V3.sub).textSelection(.enabled) }
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(V3.blue.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                    }
                }.padding(.horizontal, 16).padding(.bottom, 16)
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
    }
    private func bulletList(_ title: String, _ value: JSONValue?, tone: Color) -> some View {
        let values = (value?.items ?? []).compactMap { $0.stringValue }
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(V3.sans(12.5, weight: .medium))
            if values.isEmpty { Text("暂无").font(V3.sans(12)).foregroundStyle(V3.fnt) }
            ForEach(values, id: \.self) { text in
                HStack(alignment: .top, spacing: 6) { Circle().fill(tone).frame(width: 5, height: 5).padding(.top, 6); Text(text).font(V3.sans(12)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true) }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func load() async {
        guard !account.isEmpty else { loading = false; error = nil; return }
        loading = true; error = nil
        do {
            if screen == "detail" {
                repeat {
                    let data = try await request("/api/mock-interviews/" + selectedID); try Task.checkCancellation()
                    detail = MockInterview(data["mock_interview"] ?? .null)
                    if !["preparing", "evaluating"].contains(detail?.status ?? "") { break }
                    loading = false; try await Task.sleep(for: .seconds(2))
                } while !Task.isCancelled
            } else {
                var items: [MockInterview] = []; var cursor = ""; var seen = Set<String>()
                repeat { var query = ["limit":"100"]; if !cursor.isEmpty { query["cursor"] = cursor }; let data = try await request("/api/mock-interviews", query: query); try Task.checkCancellation(); items += (data["items"]?.items ?? []).map(MockInterview.init); cursor = data.text("next_cursor"); if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse } } while !cursor.isEmpty
                records = items; recordsLoaded = true
                var scores: [String: [Double]] = [:]
                for item in completed.prefix(4) {
                    do {
                        let result = try await request("/api/mock-interviews/" + item.id)
                        for dimension in result["mock_interview"]?["report"]?["dimensions"]?.items ?? [] {
                            if let value = dimension["score"]?.numberValue { scores[dimension.text("key"), default: []].append(value) }
                        }
                    } catch { if Task.isCancelled { return } }
                }
                radarDimensions = scores.keys.sorted().map { key in .object(["key": .string(key), "score": .number(scores[key]!.reduce(0, +) / Double(scores[key]!.count))]) }
                do {
                    var apps: [CareerApplication] = []; cursor = ""; seen = []
                    repeat { var query = ["scope":"active", "limit":"200"]; if !cursor.isEmpty { query["cursor"] = cursor }; let data = try await request("/api/job-applications", query: query); try Task.checkCancellation(); apps += (data["items"]?.items ?? []).map { CareerApplication($0) }; cursor = data.text("next_cursor"); if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse } } while !cursor.isEmpty
                    applications = apps.filter { !$0.ended }; careerError = nil
                    var dates: [ScheduledInterview] = []; cursor = ""; seen = []
                    repeat { var query = ["limit":"500"]; if !cursor.isEmpty { query["cursor"] = cursor }; let result = try await request("/api/interview-sessions", query: query); dates += (result["items"]?.items ?? []).map(ScheduledInterview.init); cursor = result.text("next_cursor"); if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse } } while !cursor.isEmpty
                    arrangements = dates
                } catch { if Task.isCancelled { return }; careerError = "岗位或排期暂不可用，可以从简历开始练习。" }
                if screen == "new" {
                    let data = try await request("/api/resumes"); try Task.checkCancellation(); resumes = data["resumes"]?.items ?? []
                    if !resumes.contains(where: { $0.text("id") == resume }) { resume = resumes.first?.text("id") ?? "" }
                    do { let data = try await request("/api/datasets"); try Task.checkCancellation(); materials = (data["datasets"]?.items ?? []).filter { $0.text("asset_kind") == "document" && $0.text("upload_status") == "succeeded" && $0.text("parse_status") == "succeeded" } } catch { if Task.isCancelled { return }; materials = []; careerError = "参考资料加载失败，可不关联资料继续。" }
                }
            }
        } catch { if !Task.isCancelled { self.error = explain(error) } }
        if !Task.isCancelled { loading = false }
    }
    private func create() async {
        guard !busy, !resume.isEmpty, !createUnknown else { return }
        if jd.count > 20000 { error = "JD 最多 20000 字。"; return }
        busy = true; error = nil
        do {
            var body: [String:JSONValue] = ["resume_id": .string(resume), "interview_type": .string(type), "difficulty": .string(difficulty), "question_count": .number(Double(count)), "follow_up_enabled": .bool(follow), "language": .string(language), "answer_mode": .string("text"), "material_ids": .array(chosenMaterials.sorted().map(JSONValue.string)), "materials_in_questions": .bool(materialsInQuestions && !chosenMaterials.isEmpty)]
            if job == "__jd" { body["job_description_text"] = .string(jd.trimmingCharacters(in: .whitespacesAndNewlines)) } else if job != "__none" { body["job_application_id"] = .string(job) }
            let data = try await request("/api/mock-interviews", "POST", .object(body)); try Task.checkCancellation(); open(MockInterview(data["mock_interview"] ?? .null))
        } catch {
            if error is CancellationError { busy = false; return }
            if case APIError.server(let status, let code) = error { createUnknown = !(400..<500).contains(status) && code != "LLM_MODEL_NOT_CONFIGURED" && code != "AUTH_SERVICE_UNAVAILABLE" } else if case APIError.unauthorized = error { createUnknown = false } else { createUnknown = true }
            self.error = explain(error)
        }
        busy = false
    }
    private func submit(_ question: JSONValue, skip: Bool) async {
        var body: [String:JSONValue] = ["question_id": .string(question.text("id")), "__idempotency_key": .string(UUID().uuidString.lowercased())]
        if !skip { body["answer"] = .string(draft.trimmingCharacters(in: .whitespacesAndNewlines)) }
        await sendAnswer(skip ? "skip" : "answers", .object(body))
    }
    private func sendAnswer(_ command: String, _ body: JSONValue) async {
        guard !busy else { return }; busy = true; error = nil; uncertain = (command, body)
        do { _ = try await request("/api/mock-interviews/" + selectedID + "/" + command, "POST", body) } catch { if error is CancellationError { busy = false; return }; self.error = explain(error); if case APIError.server(let status, _) = error, [400, 422].contains(status) { uncertain = nil } }
        do {
            let data = try await request("/api/mock-interviews/" + selectedID); try Task.checkCancellation(); detail = MockInterview(data["mock_interview"] ?? .null)
            if detail?.questions.contains(where: { $0.text("id") == body.text("question_id") && $0.text("answer_status") != "pending" }) == true { uncertain = nil; draft = "" }
            if ["preparing", "evaluating"].contains(detail?.status ?? "") { refresh = UUID() }
        } catch { self.error = explain(error) }
        busy = false
    }
    private func commandAction(_ command: String) async {
        guard !busy, !selectedID.isEmpty else { return }; busy = true; error = nil
        do {
            let data = try await request("/api/mock-interviews/" + selectedID + (command == "delete" ? "" : "/" + command), command == "delete" ? "DELETE" : "POST")
            try Task.checkCancellation()
            if command == "delete" { screen = "records"; detail = nil; selectedID = "" }
            else if command == "reply:retry" { refresh = UUID() }
            else { let item = MockInterview(data["mock_interview"] ?? .null); if command == "repeat" { open(item) } else { detail = item }; refresh = UUID() }
        } catch { if error is CancellationError { busy = false; return }; self.error = explain(error); if command == "repeat" { if case APIError.server(let status, _) = error { repeatUnknown = status >= 500 } else { repeatUnknown = true }; self.error = (self.error ?? "") + " 请返回首页刷新并确认是否已创建新场次。" } }
        busy = false
    }
    private func explainCode(_ code: String) -> String {
        ["LLM_MODEL_NOT_CONFIGURED":"模拟面试模型尚未配置，请联系管理员配置后重试。", "MOCK_INTERVIEW_IN_PROGRESS":"已有一场进行中的面试，请回到首页继续该场。", "MOCK_INTERVIEW_RESUME_REQUIRED":"请选择一份本人简历。", "MOCK_INTERVIEW_SOURCE_NOT_FOUND":"来源不存在或已不可访问，请重新选择。", "MOCK_INTERVIEW_TASK_INTERRUPTED":"任务已中断，可以重试。", "MOCK_INTERVIEW_STATE_INVALID":"记录状态已变化，请刷新后再操作。", "MOCK_INTERVIEW_QUESTION_MISMATCH":"当前问题已变化，请刷新。", "MOCK_INTERVIEW_MATERIAL_INVALID":"所选资料尚未就绪或不可访问，请重新选择。"][code] ?? "操作未完成（\(code)），请刷新确认状态后重试。"
    }
    private func explain(_ value: Error) -> String {
        if case APIError.unauthorized = value { return "登录已失效，请重新登录。" }
        if case APIError.server(_, let code) = value { return explainCode(code) }
        return "连接失败，结果尚未确认。输入已保留，请刷新确认后再试。"
    }
}
