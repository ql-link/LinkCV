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
            VStack(alignment: .leading, spacing: 24) {
                if screen == "home" { home }
                else if screen == "records" { recordList }
                else if screen == "new" { configuration }
                else if let detail { interview(detail) }
                if loading { ProgressView().controlSize(.small) }
                if let error { HStack { Text(error).foregroundStyle(.red); if !busy { Button("重新加载") { refresh = UUID() } } }.font(.system(size: 13)) }
            }.frame(maxWidth: 1200).padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 40).frame(maxWidth: .infinity, alignment: .top)
        }.task(id: account + screen + selectedID + refresh.uuidString) { await load() }
            .onChange(of: account) { _, id in
                records = []; recordsLoaded = false; radarDimensions = []; busy = false; error = nil; careerError = nil; applications = []; arrangements = []; resumes = []; materials = []; detail = nil
                chosenMaterials = []; job = "__none"; draft = ""; uncertain = nil; repeatUnknown = false; createUnknown = false; resume = ""; jd = ""; query = ""; confirmation = nil; selectedID = ""; screen = "home"
                if id.isEmpty { pending = false; job = "__none" }
                else if pending { pending = false; screen = "new" }
            }
            .onChange(of: job) { _, value in
                if let app = applications.first(where: { $0.id == value }) {
                    if resumes.contains(where: { $0.text("id") == app.raw.text("resume_id") }) { resume = app.raw.text("resume_id") }
                    type = app.stageLabel.uppercased().hasPrefix("HR") ? "hr" : "comprehensive"
                }
            }
            .alert(confirmTitle, isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } })) {
                Button("取消", role: .cancel) { confirmation = nil }
                Button(confirmation == "delete" ? "确认删除" : "确认", role: confirmation == "delete" ? .destructive : nil) {
                    let command = confirmation!; confirmation = nil; Task { await commandAction(command) }
                }
            } message: { Text(confirmation == "delete" ? "永久删除本场练习及报告，无法恢复。" : confirmation == "abandon" ? "放弃后不生成评估报告，已作答内容仍保留在本场记录。" : "提前结束后评估已作答题目；一题未答则放弃本场。") }
    }
    private var confirmTitle: String { ["delete": "删除练习记录？", "abandon": "放弃本场面试？", "finish": "结束并生成报告？"][confirmation ?? ""] ?? "确认操作" }
    private func heading(_ title: String, _ subtitle: String, back: Bool = true) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if back { Button("‹ 模拟面试") { screen = "home"; detail = nil; uncertain = nil; draft = "" }.buttonStyle(.plain).disabled(busy) }
            else { Text("MOCK INTERVIEW · AI 练习").font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted) }
            Text(title).font(.custom("Songti SC", size: 28).weight(.semibold)); Text(subtitle).font(.system(size: 13)).foregroundStyle(Tokens.Color.textMuted)
        }
    }
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content().frame(maxWidth: .infinity, alignment: .leading).padding(24).background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xE4E4E0)))
    }
    private func start(_ application: String? = nil) {
        job = application ?? "__none"; createUnknown = false; error = nil
        if account.isEmpty { pending = true; requireAccount() } else { screen = "new" }
    }
    private func open(_ item: MockInterview) { selectedID = item.id; detail = item; repeatUnknown = false; draft = ""; uncertain = nil; screen = "detail"; error = nil }
    private var home: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                heading("模拟面试", "从一个在投岗位开始，AI 会按岗位 JD 和你的简历出题。", back: false)
                Spacer()
                Button("练习记录  \(account.isEmpty || recordsLoaded ? String(records.count) : "—")") { screen = "records" }.buttonStyle(.plain)
                Button("开始新面试") { start() }.buttonStyle(WebActionStyle())
            }
            if let next = arrangements.filter({ $0.editable && $0.start >= Date() }).sorted(by: { $0.start < $1.start }).first {
                card {
                    HStack(spacing: 20) {
                        VStack(spacing: 8) { Text(date(next.raw.text("start_at"))).font(.system(size: 17, weight: .bold)); Text(next.label).font(.system(size: 12)).foregroundStyle(.secondary) }.frame(width: 130, height: 88).background(Color(hex: 0xF7F7F5), in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 12) { Text(next.company + " · " + next.title).font(.system(size: 18, weight: .medium)); Text("准备覆盖：技术面 · 项目深挖 · 综合面").font(.system(size: 12)); Text("按真实练习记录查看你的进展").font(.system(size: 11)).foregroundStyle(.secondary) }
                        Spacer(); Button("针对这场练一次") { start(next.applicationID) }.buttonStyle(WebActionStyle())
                    }
                }
            } else if records.isEmpty && (account.isEmpty || recordsLoaded) {
                HStack(spacing: 20) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 28)).frame(width: 64, height: 64).background(Color(hex: 0xF7F7F5), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 12) {
                        Text("还没有面试安排，也还没练过").font(.system(size: 18, weight: .semibold))
                        Text("选一个在投岗位做第一场练习；添加面试时间后，最近的一场会出现在这里。").font(.system(size: 13)).foregroundStyle(.secondary)
                        Text("① 选岗位        ② 答 5 道题 · 约 25 分钟        ③ 拿到评估报告").font(.system(size: 12))
                    }
                    Spacer(); Button("添加面试时间", action: showSchedule)
                }.padding(24).background(Color(hex: 0xF8F8F5), in: RoundedRectangle(cornerRadius: 14))
            }
            if let active = records.first(where: { $0.active }) {
                card { HStack { Text(active.title + " · " + active.label); Spacer(); Button("继续本场") { open(active) }.buttonStyle(WebActionStyle()) } }
            }
            card {
                VStack(alignment: .leading, spacing: 20) {
                    HStack { Text("练习数据").font(.system(size: 16, weight: .semibold)); Spacer(); Text(!account.isEmpty && !recordsLoaded ? "数据暂不可用" : completed.isEmpty ? "完成第 1 场面试后生成" : "\(completed.count) 场已完成").font(.system(size: 12)).foregroundStyle(.secondary) }
                    HStack(spacing: 30) {
                        VStack(spacing: 10) {
                            Text(completed.isEmpty ? "—" : String(format: "%.1f", completed.reduce(0.0) { $0 + ($1.raw["total_score"]?.numberValue ?? 0) } / Double(completed.count))).font(.system(size: 38, weight: .medium))
                            Text("综合表现").font(.system(size: 13)); Text("平均分与完成场次").font(.system(size: 11)).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity)
                        Divider()
                        VStack(spacing: 10) { trend.frame(height: 96); Text("得分趋势").font(.system(size: 13)); Text(completed.count < 2 ? "完成 2 场后显示变化" : "最近四场真实得分").font(.system(size: 11)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity)
                        Divider()
                        VStack(spacing: 10) { radar(radarDimensions).frame(height: 96); Text("能力雷达").font(.system(size: 13)); Text(radarDimensions.isEmpty ? "完成练习后查看薄弱项" : "最近四场可用报告的维度均分").font(.system(size: 11)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity)
                    }.frame(height: 165)
                }
            }
            VStack(alignment: .leading, spacing: 16) {
                HStack { Text("从在投岗位开始").font(.system(size: 16, weight: .semibold)); Spacer(); Text("\(applications.count) 个岗位").font(.system(size: 12)).foregroundStyle(.secondary) }
                if let careerError { Text(careerError).font(.system(size: 12)).foregroundStyle(.orange) }
                if applications.isEmpty { Text(account.isEmpty ? "登录后查看在投岗位；也可以从简历开始练习。" : "暂无在投岗位，也可以直接从简历开始。").font(.system(size: 13)).foregroundStyle(.secondary) }
                ForEach(applications) { app in
                    card { HStack { VStack(alignment: .leading, spacing: 8) { Text(app.company + " · " + app.title); Text(app.stageLabel + " · " + practice(app.id)).font(.system(size: 12)).foregroundStyle(.secondary) }; Spacer(); Button("开始练习") { start(app.id) } } }
                }
            }
        }
    }
    private var trend: some View {
        Canvas { context, size in
            let values = completed.reversed().suffix(4).map { $0.raw["total_score"]?.numberValue ?? 0 }
            var path = Path()
            for (index, value) in values.enumerated() {
                let point = CGPoint(x: 10 + Double(index) * (size.width - 20) / Double(max(1, values.count - 1)), y: size.height - 8 - value / 100 * (size.height - 16))
                if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                context.fill(Path(ellipseIn: CGRect(x: point.x - 3, y: point.y - 3, width: 6, height: 6)), with: .color(Color(hex: 0x3976CF)))
            }
            if values.isEmpty { path.move(to: CGPoint(x: 10, y: size.height * 0.8)); path.addLine(to: CGPoint(x: size.width - 10, y: size.height * 0.4)) }
            context.stroke(path, with: .color(values.isEmpty ? Color(hex: 0xCFCFCA) : Color(hex: 0x3976CF)), style: StrokeStyle(lineWidth: 1.5, dash: values.isEmpty ? [4, 3] : []))
        }
    }
    private func radar(_ dimensions: [JSONValue]) -> some View {
        Canvas { context, size in
            let count = dimensions.isEmpty ? 5 : max(3, dimensions.count), radius = min(size.width, size.height) * 0.42
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            func point(_ index: Int, _ scale: Double) -> CGPoint { let angle = Double(index) * 2 * .pi / Double(count) - .pi / 2; return CGPoint(x: center.x + cos(angle) * radius * scale, y: center.y + sin(angle) * radius * scale) }
            for scale in [0.4, 0.7, 1.0] { var outline = Path(); for i in 0..<count { if i == 0 { outline.move(to: point(i, scale)) } else { outline.addLine(to: point(i, scale)) } }; outline.closeSubpath(); context.stroke(outline, with: .color(Color(hex: 0xDEDED8)), lineWidth: 1) }
            if !dimensions.isEmpty { var values = Path(); for i in 0..<dimensions.count { let p = point(i, min(5, max(0, dimensions[i]["score"]?.numberValue ?? 0)) / 5); if i == 0 { values.move(to: p) } else { values.addLine(to: p) } }; values.closeSubpath(); context.fill(values, with: .color(Color(hex: 0x3976CF).opacity(0.15))); context.stroke(values, with: .color(Color(hex: 0x3976CF)), lineWidth: 1.5) }
        }
    }
    private func practice(_ id: String) -> String {
        let done = completed.filter { $0.raw.text("job_application_id") == id }
        return done.isEmpty ? "未练习" : "\(done.count) 场 · 最高 \(Int(done.compactMap { $0.raw["total_score"]?.numberValue }.max() ?? 0)) 分"
    }
    private var recordList: some View {
        VStack(alignment: .leading, spacing: 20) {
            heading("练习记录", "每场练习的状态、作答与评估报告")
            HStack { TextField("搜索公司、岗位或简历", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 280); Picker("状态", selection: $filter) { Text("全部").tag("all"); ForEach(MockInterview.statusLabels.keys.sorted(), id: \.self) { Text(MockInterview.statusLabels[$0]!).tag($0) } }.frame(width: 180); Spacer(); Button("开始新面试") { start() }.buttonStyle(WebActionStyle()) }
            Text("公司 / 岗位                  面试类型                  状态                  得分").font(.system(size: 11)).foregroundStyle(.secondary)
            if records.isEmpty { Text(account.isEmpty ? "登录后查看你的练习记录。" : recordsLoaded ? "还没有练习记录。" : "练习记录暂不可用，请重新加载。").foregroundStyle(.secondary) }
            ForEach(records.filter { (filter == "all" || $0.status == filter) && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)) }) { item in
                Button { open(item) } label: { HStack { VStack(alignment: .leading, spacing: 6) { Text(item.title); Text(date(item.raw.text("created_at"))).font(.system(size: 11)).foregroundStyle(.secondary) }.frame(maxWidth: .infinity, alignment: .leading); Text(item.type).frame(width: 90); Text(item.label).frame(width: 80); Text(item.raw["total_score"]?.numberValue.map { String(format: "%.1f", $0) } ?? "—").frame(width: 50) }.padding(.vertical, 14) }.buttonStyle(.plain)
                Divider()
            }
        }
    }
    private var configuration: some View {
        VStack(alignment: .leading, spacing: 24) {
            heading("开始新面试", "选择简历和目标岗位，AI 会结合你的经历制定考察计划。")
            card {
                VStack(alignment: .leading, spacing: 20) {
                    Text("面试背景").font(.headline)
                    if let careerError { Text(careerError).font(.system(size: 12)).foregroundStyle(.orange) }
                    Picker("简历", selection: $resume) { Text("请选择本人简历").tag(""); ForEach(resumes, id: \.self) { Text($0.text("title")).tag($0.text("id")) } }
                    if resumes.isEmpty && !loading { Text("账号中还没有可用简历，请先在 Web 创建或导入简历后刷新。").font(.system(size: 12)).foregroundStyle(.orange) }
                    Picker("目标岗位", selection: $job) { Text("不指定岗位").tag("__none"); Text("粘贴一段 JD").tag("__jd"); ForEach(applications) { Text($0.company + " · " + $0.title).tag($0.id) } }
                    if job == "__jd" { TextEditor(text: $jd).frame(height: 140).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xE4E4E0))); Text("JD 最多 20000 字").font(.system(size: 11)).foregroundStyle(.secondary) }
                    Divider(); Text("练习设置").font(.headline)
                    Picker("面试类型", selection: $type) { ForEach(["technical", "project_deep_dive", "comprehensive", "hr"], id: \.self) { Text(MockInterview.types[$0]!).tag($0) } }.pickerStyle(.segmented)
                    Picker("难度", selection: $difficulty) { Text("初级").tag("junior"); Text("中级").tag("intermediate"); Text("高级").tag("senior") }.pickerStyle(.segmented)
                    Stepper("主问题数：\(count) 道", value: $count, in: 3...10); Toggle("允许追问", isOn: $follow)
                    Picker("语言", selection: $language) { Text("中文").tag("zh"); Text("英文").tag("en") }
                    Text("文字面试 · 本次通过输入框作答").font(.system(size: 12)).foregroundStyle(.secondary)
                    Divider(); Text("参考资料（可选，最多 10 份）").font(.headline)
                    if materials.isEmpty { Text("没有已解析成功的文档类资料，仍可开始面试。").font(.system(size: 12)).foregroundStyle(.secondary) }
                    ForEach(materials, id: \.self) { item in
                        Toggle(item.text("file_name"), isOn: Binding(get: { chosenMaterials.contains(item.text("id")) }, set: { on in if on { if chosenMaterials.count < 10 { chosenMaterials.insert(item.text("id")) } } else { chosenMaterials.remove(item.text("id")) } })).disabled(chosenMaterials.count >= 10 && !chosenMaterials.contains(item.text("id")))
                    }
                    Toggle("出题参考所选资料", isOn: $materialsInQuestions).disabled(chosenMaterials.isEmpty)
                    Text("关闭时仅用于报告事实核验；只有你选择的资料会被使用。").font(.system(size: 12)).foregroundStyle(.secondary)
                }.disabled(busy || createUnknown)
            }.frame(maxWidth: 860)
            HStack { Text("\(count) 道题 · \(language == "zh" ? "中文" : "英文") · \(follow ? "允许追问" : "不追问")").font(.system(size: 12)).foregroundStyle(.secondary); Spacer(); Button(busy ? "正在准备…" : "开始面试") { Task { await create() } }.buttonStyle(WebActionStyle()).disabled(loading || busy || createUnknown || resume.isEmpty || (job == "__jd" && jd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)) }.frame(maxWidth: 860)
            if createUnknown { Text("创建结果尚未确认。返回首页并刷新，确认是否已有进行中的场次，避免重复创建。").foregroundStyle(.orange) }
        }.frame(maxWidth: .infinity, alignment: .center)
    }
    private func interview(_ item: MockInterview) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack { heading(item.status == "completed" ? "评估报告" : "模拟面试", item.title + " · " + item.type + " · " + item.label); Spacer(); Button("刷新") { refresh = UUID() }.disabled(busy) }
            if item.status == "completed" { report(item) }
            else if item.status == "preparing" || item.status == "evaluating" {
                card { HStack(spacing: 20) { ProgressView(); VStack(alignment: .leading, spacing: 10) { Text(item.status == "preparing" ? "AI 正在分析背景并准备问题" : "正在生成评估报告").font(.headline); Text("可以离开页面，稍后从练习记录继续查看。").foregroundStyle(.secondary) } } }
            } else if ["preparation_failed", "evaluation_failed"].contains(item.status) {
                card { VStack(alignment: .leading, spacing: 16) { Text(item.label).font(.headline); Text(explainCode(item.raw.text("error_code"))); Button("重试") { Task { await commandAction("retry") } }.buttonStyle(WebActionStyle()).disabled(busy); if item.status == "preparation_failed" { Button("放弃本场") { confirmation = "abandon" }.disabled(busy) } } }
            } else if item.status == "abandoned" { card { Text("本场已放弃，未生成评估报告。") } }
            else {
                HStack { Text("主问题 \(item.raw["answered_main_questions"]?.integer ?? 0) / \(item.raw["question_count"]?.integer ?? 5)").font(.system(size: 12)); Spacer(); Button("提前结束") { confirmation = "finish" }.disabled(busy || uncertain != nil); Button("放弃本场") { confirmation = "abandon" }.disabled(busy || uncertain != nil) }
                ForEach(Array(item.questions.enumerated()), id: \.offset) { _, question in
                    card {
                        VStack(alignment: .leading, spacing: 16) {
                            HStack { Image(systemName: "sparkles"); Text(question.text("kind") == "follow_up" ? "AI 面试官 · 追问" : "AI 面试官 · 主问题").font(.system(size: 12)).foregroundStyle(.secondary) }
                            Text(question.text("content")).textSelection(.enabled)
                            if question.text("answer_status") == "answered" { Divider(); Text("你的回答").font(.system(size: 12)).foregroundStyle(.secondary); Text(question.text("answer_text")).textSelection(.enabled) }
                            if question.text("answer_status") == "skipped" { Text("已跳过").foregroundStyle(.secondary) }
                        }
                    }
                }
                if item.raw["needs_reply"] == .bool(true) { card { VStack(alignment: .leading, spacing: 12) { Text("回答已保存，面试官回复尚未完成。"); Button("重新生成回复") { Task { await commandAction("reply:retry") } }.buttonStyle(WebActionStyle()).disabled(busy) } } }
                else if let current = item.current, item.raw.text("answer_mode") != "voice" {
                    card {
                        VStack(alignment: .leading, spacing: 12) {
                            TextEditor(text: $draft).frame(minHeight: 140).disabled(busy || uncertain != nil)
                            HStack { Text("\(draft.count) / 8000 字").font(.system(size: 11)).foregroundStyle(.secondary); Spacer(); Button("跳过本题") { Task { await submit(current, skip: true) } }.disabled(busy || uncertain != nil); Button(busy ? "面试官正在思考…" : "提交回答") { Task { await submit(current, skip: false) } }.buttonStyle(WebActionStyle()).disabled(busy || uncertain != nil || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.count > 8000) }
                        }
                    }
                } else if item.raw.text("answer_mode") == "voice" { Text("本场是语音面试，请在 Web 继续作答。原生文字流程不会把纯文字冒充语音回答。").foregroundStyle(.orange) }
                if let uncertain { Button("重试原提交") { Task { await sendAnswer(uncertain.command, uncertain.body) } }.disabled(busy) }
            }
            if !item.active { HStack { Button("再练一次") { Task { await commandAction("repeat") } }.buttonStyle(WebActionStyle()).disabled(busy || repeatUnknown || item.raw.text("answer_mode") == "voice"); Spacer(); Button("删除记录", role: .destructive) { confirmation = "delete" }.disabled(busy) } }
        }
    }
    private func report(_ item: MockInterview) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            if let report = item.raw["report"], report != .null {
                card { HStack(spacing: 32) { VStack(alignment: .leading, spacing: 8) { Text(String(format: "%.1f", report["total_score"]?.numberValue ?? 0)).font(.system(size: 48, weight: .medium)); Text("综合得分").foregroundStyle(.secondary); if report["low_confidence"] == .bool(true) { Text("作答样本较少，报告置信度较低").foregroundStyle(.orange).font(.system(size: 12)) } }; Divider(); VStack(alignment: .leading, spacing: 12) { Text("逐题平均：" + String(format: "%.1f", report["question_average"]?.numberValue ?? 0)); Text("维度得分：" + String(format: "%.1f", report["dimension_score"]?.numberValue ?? 0)); Text(report.text("headline") + "\n" + report.text("summary")).foregroundStyle(.secondary) } } }
                card { VStack(alignment: .leading, spacing: 18) { Text("能力维度").font(.headline); radar(report["dimensions"]?.items ?? []).frame(height: 160); ForEach(Array((report["dimensions"]?.items ?? []).enumerated()), id: \.offset) { _, dimension in HStack { Text(MockInterview.dimensions[dimension.text("key")] ?? dimension.text("key")).frame(width: 90, alignment: .leading); ProgressView(value: dimension["score"]?.numberValue ?? 0, total: 5).frame(width: 140); Text(String(format: "%.1f", dimension["score"]?.numberValue ?? 0)); VStack(alignment: .leading, spacing: 6) { Text(dimension.text("comment")); Text((dimension["evidence"]?.items ?? []).compactMap(\.stringValue).joined(separator: "；")) }.font(.system(size: 12)).foregroundStyle(.secondary) } } } }
                Text("逐题评估").font(.headline)
                ForEach(Array((report["questions"]?.items ?? []).enumerated()), id: \.offset) { _, evaluation in
                    DisclosureGroup(evaluation.text("topic") + " · " + String(format: "%.0f 分", evaluation["score"]?.numberValue ?? 0)) {
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(item.questions.filter { $0["plan_index"] == item.questions.first(where: { $0["sequence_no"] == evaluation["sequence_no"] && $0.text("kind") == "main" })?["plan_index"] }, id: \.self) { question in Text("问：" + question.text("content")); Text("答：" + question.text("answer_text")).foregroundStyle(.secondary) }
                            ForEach(evaluation["signals"]?.items ?? [], id: \.self) { signal in Text(signal.text("signal") + " · " + (["hit": "命中", "partial": "部分命中", "miss": "未命中"][signal.text("verdict")] ?? signal.text("verdict"))); if !signal.text("evidence").isEmpty { Text("依据：" + signal.text("evidence")).font(.system(size: 12)).foregroundStyle(.secondary) } }
                            Text("参考回答：" + evaluation.text("reference_answer")).textSelection(.enabled)
                            textArray(evaluation["highlights"], title: "亮点"); textArray(evaluation["weaknesses"], title: "待加强"); textArray(evaluation["factual_errors"], title: "事实问题")
                        }.padding(.top, 12)
                    }.padding(20).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0xE4E4E0)))
                }
                card { VStack(alignment: .leading, spacing: 14) { Text("参考资料事实核验").font(.headline); Text(["not_requested": "未选择参考资料", "completed": "核验已完成", "failed": "资料核验失败，其他评分仍可查看"][report["fact_check"]?.text("status") ?? ""] ?? "查看核验内容"); ForEach(report["fact_check"]?["items"]?.items ?? [], id: \.self) { fact in Text(fact.text("claim") + " · " + (["consistent":"有资料支持", "conflict":"与资料矛盾", "not_found":"未找到依据", "stronger_in_material":"资料表述更强"][fact.text("verdict")] ?? fact.text("verdict"))); Text(fact.text("note")).font(.system(size: 12)).foregroundStyle(.secondary); if !fact.text("quote").isEmpty { Text((fact["source"]?.text("title") ?? "资料") + "：" + fact.text("quote")).font(.system(size: 12)).textSelection(.enabled) } }; textArray(report["resume_risks"], title: "简历风险"); textArray(report["improvements"], title: "改进建议") } }
            } else { Text("报告暂不可用，请刷新后重试。").foregroundStyle(.orange) }
        }
    }
    private func textArray(_ value: JSONValue?, title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let values = value?.items, !values.isEmpty { Text(title).font(.system(size: 13, weight: .semibold)); ForEach(Array(values.enumerated()), id: \.offset) { _, item in Text(item.stringValue ?? item.text("suggestion") + item.text("description") + item.text("risk") + item.text("action")).font(.system(size: 12)).textSelection(.enabled) } }
        }
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
