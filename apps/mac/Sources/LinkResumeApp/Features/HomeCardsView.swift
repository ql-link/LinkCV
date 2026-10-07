import LinkResumeCore
import SwiftUI

/// 已登录首页的数据：简历、本周起两周的排期与进行中的求职进程（Web `useHomeDashboard`）。
@MainActor @Observable
final class HomeDashboardModel {
    enum State { case loading, ready(HomeDashboard), failed }
    private(set) var state: State = .loading
    private var owner = ""

    func load(api: any APIClient, account: String) async {
        owner = account; state = .loading
        let now = Date()
        let start = HomeDashboard.startOfWeek(now)
        let end = start.addingTimeInterval(14 * 86_400)
        let formatter = ISO8601DateFormatter()
        let range = ["start_at": formatter.string(from: start), "end_at": formatter.string(from: end)]
        do {
            async let resumes = api.listResumes()
            async let sessions = api.careerRequest(path: "/api/interview-sessions", method: "GET", query: range, body: nil)
            async let applications = api.careerRequest(path: "/api/job-applications", method: "GET", query: ["scope": "active"], body: nil)
            let (resumeList, sessionPage, applicationPage) = try await (resumes, sessions, applications)
            let dashboard = HomeDashboard.build(now: now, resumes: resumeList, sessions: sessionPage["items"]?.items ?? [],
                                                applications: applicationPage["items"]?.items ?? [])
            guard owner == account else { return }
            state = .ready(dashboard)
        } catch {
            guard owner == account, !(error is CancellationError) else { return }
            state = .failed
        }
    }
}

/// 首页推荐岗位：没有可用结果时请求服务端开始计算，随后每 3 秒轮询，最多 20 次（Web `useJobMatchRecommendations`）。
@MainActor @Observable
final class JobRecommendationsModel {
    private(set) var data: JobMatchRecommendations?
    private(set) var failed = false
    private(set) var stalled = false

    func load(api: any APIClient) async {
        data = nil; failed = false; stalled = false
        do {
            var result = JobMatchRecommendations(try await api.careerRequest(path: "/api/job-matches/recommendations", method: "GET", query: [:], body: nil))
            if result.canCompute {
                result = JobMatchRecommendations(try await api.careerRequest(path: "/api/job-matches/recommendations:ensure", method: "POST", query: [:], body: nil))
            }
            data = result
            var polls = 0
            while (data?.pendingCount ?? 0) > 0 && polls < JobMatch.pollLimit {
                try await Task.sleep(for: JobMatch.pollInterval)
                polls += 1
                data = JobMatchRecommendations(try await api.careerRequest(path: "/api/job-matches/recommendations", method: "GET", query: [:], body: nil))
            }
            stalled = (data?.pendingCount ?? 0) > 0
        } catch is CancellationError {
        } catch { failed = true }
    }
}

/// 一张首页卡片：插图区 + 标题 + 副标题 + 操作（与游客引导卡同一外框，Web `CardFrame`）。
struct HomeCardFrame<Stage: View>: View {
    let title: String
    let subtitle: String
    let action: String
    let compact: Bool
    let perform: () -> Void
    @ViewBuilder var stage: () -> Stage

    var body: some View {
        Button(action: perform) {
            VStack(alignment: .leading, spacing: 0) {
                stage().frame(maxWidth: .infinity).frame(height: compact ? 84 : 112)
                    .background(V3.stage, in: RoundedRectangle(cornerRadius: 11))
                Text(title).font(V3.sans(15, weight: .semibold)).foregroundStyle(V3.txt).lineLimit(1)
                    .padding(.horizontal, 12).padding(.top, compact ? 12 : 18)
                Text(subtitle).font(V3.sans(12)).foregroundStyle(V3.sub).lineLimit(1).padding(.horizontal, 12).padding(.top, 6)
                Spacer(minLength: 0)
                HStack(spacing: 5) { Text(action); Image(systemName: "arrow.right").font(.system(size: 10)) }
                    .font(V3.sans(14, weight: .medium)).foregroundStyle(V3.sub).padding(.horizontal, 12).padding(.bottom, 14)
            }.padding(8).frame(maxWidth: .infinity).frame(height: compact ? 200 : 236)
                .background(.white, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
                .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityLabel(title)
    }
}

struct HomeCardView: View {
    @Environment(SessionStore.self) private var session
    let card: HomeDashboard.Card
    let compact: Bool
    let navigate: (WorkspaceSection) -> Void
    let showPlugin: () -> Void
    var editResume: (String) -> Void = { _ in }
    @State private var jobs = JobRecommendationsModel()

    var body: some View {
        switch card {
        case .firstResume:
            HomeCardFrame(title: "新建第一份简历", subtitle: "选模板新建，或导入已有文件", action: "新建简历", compact: compact, perform: { navigate(.templates) }) { symbol("doc.badge.plus") }
        case .target:
            HomeCardFrame(title: "设置求职方向", subtitle: "用来推荐岗位和优化简历", action: "去设置", compact: compact, perform: { navigate(.account) }) { symbol("scope") }
        case .plugin:
            HomeCardFrame(title: "安装浏览器插件", subtitle: "在招聘网站一键收藏岗位", action: "安装插件", compact: compact, perform: showPlugin) { symbol("puzzlepiece.extension") }
        case .offer(let company, _, let due):
            HomeCardFrame(title: "\(company) · \(due.map { "\($0) 前回复" } ?? "回复截止待填写")",
                          subtitle: due == nil ? "填写 Offer 信息后显示截止提醒" : "Offer 待回复", action: "查看 Offer", compact: compact,
                          perform: { navigate(.jobs) }) { symbol("envelope.open") }
        case .today(let item, let others):
            HomeCardFrame(title: "\(clock(item.text("start_at"))) · \(item.text("company_name")) \(item.text("stage_label"))",
                          subtitle: others > 0 ? "另有 \(others) 场安排" : "今天只有这一场", action: "查看日程", compact: compact,
                          perform: { navigate(.schedule) }) { big(clock(item.text("start_at")), caption: modeLabel(item.text("mode"))) }
        case .deadline(let item, let days):
            HomeCardFrame(title: "\(item.text("company_name")) · \(days == 0 ? "今天截止" : "\(days) 天后截止")",
                          subtitle: "\(item.text("stage_label")) · \(clock(item.text("answer_plan_end_at").isEmpty ? item.text("end_at") : item.text("answer_plan_end_at"))) 前完成",
                          action: "查看日程", compact: compact, perform: { navigate(.schedule) }) { big(days == 0 ? "今天" : "\(days)", caption: days == 0 ? "截止" : "天后截止") }
        case .week(let sessions):
            HomeCardFrame(title: sessions.isEmpty ? "本周还没有面试" : "本周 \(sessions.count) 场面试",
                          subtitle: sessions.isEmpty ? "可以先投几个新岗位" : weekdays(sessions) + "各有安排", action: "查看日程", compact: compact,
                          perform: { navigate(.schedule) }) { big("\(sessions.count)", caption: "本周安排") }
        case .compare(let offers):
            HomeCardFrame(title: "对比 \(offers.count) 个 Offer", subtitle: offers.map { $0.text("company_name_snapshot") }.joined(separator: " vs "),
                          action: "查看 Offer", compact: compact, perform: { navigate(.jobs) }) { symbol("square.split.2x1") }
        case .resumeTodo(let resume, let score, let missing):
            HomeCardFrame(title: "\(resume.title) · \(score)%", subtitle: "待完善：\(missing)", action: "继续编辑", compact: compact,
                          perform: { editResume(resume.id) }) { big("\(score)%", caption: "待补 · \(missing)") }
        case .resumeRecent(let resume, let score):
            HomeCardFrame(title: score.map { "\(resume.title) · \($0)%" } ?? resume.title, subtitle: "最近编辑的简历", action: "继续编辑", compact: compact,
                          perform: { editResume(resume.id) }) { symbol("doc.text") }
        case .pipeline(let applications, let hint):
            let columns = HomeDashboard.pipelineColumns(applications)
            HomeCardFrame(title: "\(applications.count) 个岗位进行中", subtitle: hint, action: "岗位看板", compact: compact, perform: { navigate(.jobs) }) {
                HStack(spacing: 14) {
                    column("待投递", columns.pending, V3.fnt); column("笔试", columns.test, V3.orange)
                    column("面试", columns.interview, V3.blue); column("Offer", columns.offer, V3.green)
                }
            }
        case .jobs:
            jobsCard
        }
    }

    @ViewBuilder private var jobsCard: some View {
        let data = jobs.data
        let resume = data?.resumeTitle ?? "最近编辑的简历"
        Group {
            if data == nil && !jobs.failed {
                HomeCardFrame(title: "与简历最匹配的岗位", subtitle: "正在读取…", action: "岗位看板", compact: compact, perform: { navigate(.jobs) }) { ProgressView().controlSize(.small) }
            } else if let data, data.state == "ready" || !data.items.isEmpty {
                HomeCardFrame(title: "与简历最匹配的岗位",
                              subtitle: data.pendingCount > 0 && !jobs.stalled ? "基于《\(resume)》· 还在分析 \(data.pendingCount) 个" : "基于《\(resume)》",
                              action: "查看岗位", compact: compact, perform: { navigate(.jobs) }) { jobList(data.items) }
            } else if data?.state == "no_jobs" {
                HomeCardFrame(title: "保存岗位，查看匹配度", subtitle: "用插件导入或粘贴岗位描述即可", action: "添加岗位", compact: compact, perform: { navigate(.jobs) }) { symbol("briefcase") }
            } else if data?.state == "no_resume" {
                HomeCardFrame(title: "先创建一份简历", subtitle: "有了简历才能计算岗位匹配度", action: "去创建", compact: compact, perform: { navigate(.templates) }) { symbol("doc.badge.plus") }
            } else if data?.state == "computing" && !jobs.stalled {
                HomeCardFrame(title: "正在对照你的简历…", subtitle: "基于《\(resume)》", action: "岗位看板", compact: compact, perform: { navigate(.jobs) }) { ProgressView().controlSize(.small) }
            } else {
                HomeCardFrame(title: "暂时无法计算匹配度", subtitle: jobs.stalled ? "还在分析，稍后刷新查看" : "稍后再试", action: "岗位看板", compact: compact, perform: { navigate(.jobs) }) { symbol("gauge.with.dots.needle.33percent") }
            }
        }.task { await jobs.load(api: session.api) }
    }

    private func jobList(_ items: [JobMatchRecommendations.Item]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(items.prefix(3)) { item in
                HStack(spacing: 6) {
                    Text("\(item.score)").font(V3.number(12)).foregroundStyle(V3.green).frame(width: 26, alignment: .leading)
                    Text("\(item.company) · \(item.title)").font(V3.sans(11)).foregroundStyle(V3.txt).lineLimit(1)
                    Spacer(minLength: 4)
                    Text(item.applicationStatus ?? "未投递").font(V3.sans(9)).foregroundStyle(V3.fnt)
                }
            }
        }.padding(.horizontal, 14)
    }

    private func symbol(_ name: String) -> some View { Image(systemName: name).font(.system(size: 30, weight: .light)).foregroundStyle(V3.fnt) }

    private func big(_ value: String, caption: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(V3.number(26)).foregroundStyle(V3.txt)
            Text(caption).font(V3.sans(11)).foregroundStyle(V3.fnt)
        }
    }

    private func column(_ label: String, _ count: Int, _ color: Color) -> some View {
        VStack(spacing: 4) {
            Text("\(count)").font(V3.number(18)).foregroundStyle(color)
            Text(label).font(V3.sans(10)).foregroundStyle(V3.fnt)
        }
    }

    private func clock(_ value: String) -> String {
        guard let date = HomeDashboard.date(value) else { return "--:--" }
        let formatter = DateFormatter(); formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func modeLabel(_ mode: String) -> String { ["video": "视频", "onsite": "现场", "phone": "电话", "other": "其他"][mode] ?? "面试" }

    private func weekdays(_ sessions: [JSONValue]) -> String {
        let names = ["日", "一", "二", "三", "四", "五", "六"]
        var seen: [Int] = []
        for session in sessions {
            guard let date = HomeDashboard.date(session.text("start_at")) else { continue }
            let day = Calendar.current.component(.weekday, from: date) - 1
            if !seen.contains(day) { seen.append(day) }
        }
        return seen.sorted { ($0 + 6) % 7 < ($1 + 6) % 7 }.map { "周" + names[$0] }.joined(separator: "、")
    }
}
