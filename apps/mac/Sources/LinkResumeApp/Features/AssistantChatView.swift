import AppKit
import LinkResumeCore
import SwiftUI
import UniformTypeIdentifiers

/// 侧栏“最近对话”（`GET /api/agent/sessions`）。退出或换账号时清空。
@MainActor @Observable
final class AgentSessionsModel {
    private(set) var sessions: [JSONValue] = []
    private(set) var loaded = false
    private var owner = ""

    func load(api: any APIClient, account: String) async {
        if owner != account { sessions = []; loaded = false; owner = account }
        guard !account.isEmpty else { return }
        guard let result = try? await api.careerRequest(path: "/api/agent/sessions", method: "GET", query: [:], body: nil), owner == account else { return }
        sessions = (result["sessions"]?.items ?? []).filter { $0.text("status") != "archived" }
            .sorted { ($0["pinned"]?.bool == true ? 1 : 0, $0.text("last_message_at").nonEmptyOr($0.text("updated_at"))) > ($1["pinned"]?.bool == true ? 1 : 0, $1.text("last_message_at").nonEmptyOr($1.text("updated_at"))) }
        loaded = true
    }

    func remove(_ id: String) { sessions.removeAll { $0.text("id") == id } }
}

/// AI 对话（Web `features/assistant/AssistantPage.tsx` 的核心流程）：会话消息、流式回复、追问选项、
/// 简历修改建议的应用/不采用、附加资料、截图附件与停止生成。消息带固定幂等键，中断后刷新即可确认结果。
/// 截图与 Web 一致只在本机：带截图发送时不请求后端，在对话里留下本地消息并可在右侧预览。
struct AssistantChatView: View {
    @Environment(SessionStore.self) private var session
    /// nil 表示新对话：第一次发送时创建会话。
    let sessionID: String?
    /// 首页输入框带过来的第一条消息。
    let initialMessage: String?
    let created: (String) -> Void
    let deleted: () -> Void
    let sessionsChanged: () -> Void

    @State private var currentID: String?
    @State private var title = "新对话"
    @State private var messages: [JSONValue] = []
    @State private var proposals: [JSONValue] = []
    @State private var draft = ""
    @State private var streaming = ""
    @State private var status: String?
    @State private var runID: String?
    @State private var sending = false
    @State private var error: String?
    @State private var ready: Bool?
    @State private var modelName: String?
    @State private var models: [JSONValue] = []
    @State private var modelID: String?
    @State private var steering = false
    @State private var savingDocument: String?
    @State private var contexts: [JSONValue] = []
    @State private var contextGroups: [JSONValue] = []
    @State private var answers: [String: String] = [:]
    @State private var proposalBusy: String?
    @State private var renaming = false
    @State private var renameDraft = ""
    @State private var confirmDelete = false
    @State private var consumedInitial = false
    @State private var previewTabs: [ChatPreviewTab] = []
    @State private var previewActive: String?
    @State private var previewOpen = false
    @State private var unavailableFiles = Set<String>()
    @State private var savedDocuments = Set<String>()
    @State private var screenshots: [ChatScreenshot] = []
    @State private var localMessages: [LocalChatMessage] = []
    @State private var notice: String?

    private var api: any APIClient { session.api }
    private var pendingClarification: JSONValue? {
        guard !sending, let last = messages.last, last.text("role") == "assistant", let clarification = last["clarification"], clarification != .null,
              !(clarification["questions"]?.items ?? []).isEmpty else { return nil }
        return last
    }

    var body: some View {
        HStack(spacing: 0) {
            chat
            if previewOpen, !previewTabs.isEmpty {
                Divider()
                ChatPreviewPanel(tabs: previewTabs.map { tab in var tab = tab; if tab.kind == .generated { tab.saved = savedDocuments.contains(tab.content) }; return tab },
                                 active: previewActive, unavailable: unavailableFiles,
                                 activate: { previewActive = $0 }, closeTab: closePreview, close: { previewOpen = false },
                                 save: { savingDocument = $0.content }, markUnavailable: { unavailableFiles.insert($0) })
                    .frame(width: 460)
            }
        }
        .task(id: sessionID ?? "new") { await open() }
        .sheet(item: Binding(get: { savingDocument.map { DocumentDraft(content: $0) } }, set: { if $0 == nil { savingDocument = nil } })) { draft in
            SaveDocumentSheet(content: draft.content, title: Self.documentTitle(draft.content) ?? "AI 文档", close: { savingDocument = nil },
                              saved: { savedDocuments.insert(draft.content) })
        }
        .alert("重命名对话", isPresented: $renaming) {
            TextField("对话名称", text: $renameDraft)
            Button("取消", role: .cancel) {}
            Button("保存") { Task { await rename() } }
        }
        .confirmationDialog("删除这个对话？", isPresented: $confirmDelete) {
            Button("删除", role: .destructive) { Task { await deleteSession() } }
        } message: { Text("删除后对话记录无法恢复；已经应用到简历的修改不受影响。") }
    }

    private var chat: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if messages.isEmpty && streaming.isEmpty && !sending {
                            VStack(spacing: 8) {
                                Text("今天想推进什么？").font(V3.serif(24))
                                Text("改简历、分析 JD、准备面试，从这里开始。可以用“+”附加简历、岗位或资料。").font(V3.sans(13)).foregroundStyle(V3.fnt)
                            }.frame(maxWidth: .infinity).padding(.top, 80)
                        }
                        ForEach(Array(messages.enumerated()), id: \.offset) { index, message in
                            localBubbles(at: index)
                            bubble(message, index: index)
                        }
                        localBubbles(at: messages.count)
                        ForEach(proposals.filter { $0.text("status") == "pending" }, id: \.self) { proposalCard($0) }
                        if sending {
                            VStack(alignment: .leading, spacing: 6) {
                                if !streaming.isEmpty { NativeMarkdownView(source: streaming).textSelection(.enabled) }
                                HStack(spacing: 6) { ProgressView().controlSize(.small); Text(status ?? "正在思考…").font(V3.sans(12)).foregroundStyle(V3.fnt) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                        if let pendingClarification { clarificationCard(pendingClarification) }
                        if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red) }
                        Color.clear.frame(height: 1).id("bottom")
                    }.frame(maxWidth: 760, alignment: .leading).padding(.horizontal, 40).padding(.vertical, 24).frame(maxWidth: .infinity)
                }
                .onChange(of: messages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .onChange(of: localMessages.count) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
                .onChange(of: streaming) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            }
            composer.frame(maxWidth: 760).padding(.horizontal, 40).padding(.bottom, 20).frame(maxWidth: .infinity)
        }.frame(minWidth: 420)
    }

    // MARK: Preview

    /// 本次对话涉及的全部文件：消息附加的简历与资料、AI 生成的文档。
    private var sessionFiles: [ChatPreviewTab] {
        var tabs: [ChatPreviewTab] = []
        for (index, message) in messages.enumerated() {
            for context in message["contexts"]?.items ?? [] { if let tab = ChatPreviewTab.forContext(context) { tabs = ChatPreviewTab.open(tabs, tab) } }
            if message.text("role") == "assistant", let tab = generatedTab(message, index: index) { tabs = ChatPreviewTab.open(tabs, tab) }
        }
        for local in localMessages { for shot in local.screenshots { tabs = ChatPreviewTab.open(tabs, shot.tab) } }
        return tabs
    }

    private func generatedTab(_ message: JSONValue, index: Int) -> ChatPreviewTab? {
        guard let title = Self.documentTitle(message.text("content")) else { return nil }
        let id = message["sequence_no"]?.integer.map(String.init) ?? "m\(index)"
        return ChatPreviewTab(kind: .generated, id: id, label: title + ".md", content: message.text("content"))
    }

    private func openPreview(_ tab: ChatPreviewTab) {
        guard !unavailableFiles.contains(tab.key) else { return }
        var tab = tab
        if tab.kind == .resume {
            tab.pending = proposals.filter { $0.text("status") == "pending" && $0.text("resume_id") == tab.id }
                .flatMap { ($0["preview"]?["changes"]?.items ?? []).map { $0.text("before") } }.filter { !$0.isEmpty }
        }
        previewTabs = ChatPreviewTab.open(previewTabs, tab)
        previewActive = tab.key
        previewOpen = true
    }

    private func openAllFiles() {
        var tabs = previewTabs
        for tab in sessionFiles { tabs = ChatPreviewTab.open(tabs, tab) }
        previewTabs = tabs
        if previewActive == nil { previewActive = tabs.first?.key }
        previewOpen = !tabs.isEmpty
    }

    private func closePreview(_ key: String) {
        previewTabs.removeAll { $0.key == key }
        if previewActive == key { previewActive = previewTabs.last?.key }
        if previewTabs.isEmpty { previewOpen = false }
    }

    // MARK: Pieces

    private var header: some View {
        HStack(spacing: 10) {
            Text(title).font(V3.sans(15, weight: .medium)).lineLimit(1)
            Spacer()
            if models.count > 1 {
                Menu {
                    ForEach(models, id: \.self) { model in
                        Button((model.text("id") == modelID ? "✓ " : "") + model.text("name")) { Task { await chooseModel(model) } }
                    }
                } label: { Label(currentModelName ?? "选择模型", systemImage: "cpu").font(V3.sans(12)) }.fixedSize().disabled(sending)
            } else if let name = currentModelName { Label(name, systemImage: "cpu").font(V3.sans(12)).foregroundStyle(V3.fnt) }
            let files = sessionFiles.count
            if files > 0 {
                Button { if previewOpen { previewOpen = false } else { openAllFiles() } } label: { Label("文件 \(files)", systemImage: "sidebar.right") }
                    .buttonStyle(V3ButtonStyle(kind: .ghost)).accessibilityLabel(previewOpen ? "收起文件预览" : "查看本次对话的文件")
            }
            if currentID != nil {
                Menu {
                    Button("重命名") { renameDraft = title; renaming = true }
                    Button("删除对话", role: .destructive) { confirmDelete = true }
                } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().disabled(sending)
            }
        }.padding(.horizontal, 24).frame(height: 52)
    }

    private func bubble(_ message: JSONValue, index: Int) -> some View {
        let user = message.text("role") == "user"
        let attached = (message["contexts"]?.items ?? []).filter { !$0.text("label").isEmpty }
        return HStack {
            if user { Spacer(minLength: 80) }
            VStack(alignment: user ? .trailing : .leading, spacing: 6) {
                if !attached.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(attached, id: \.self) { context in
                            if let tab = ChatPreviewTab.forContext(context) {
                                let gone = unavailableFiles.contains(tab.key)
                                Button { openPreview(tab) } label: { Label(context.text("label"), systemImage: tab.kind == .resume ? "doc.text" : "doc").font(V3.sans(11.5)).lineLimit(1) }
                                    .buttonStyle(.plain).foregroundStyle(gone ? V3.fnt : V3.blue).disabled(gone).help(gone ? "这个文件已不可用" : "在右侧预览")
                            } else {
                                Text(context.text("label")).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                            }
                        }
                    }
                }
                if user {
                    Text(message.text("content")).font(V3.sans(14)).textSelection(.enabled).padding(.horizontal, 14).padding(.vertical, 10)
                        .background(V3.field, in: RoundedRectangle(cornerRadius: 14))
                } else {
                    NativeMarkdownView(source: message.text("content")).textSelection(.enabled)
                    if let tab = generatedTab(message, index: index) {
                        HStack(spacing: 8) {
                            Button { openPreview(tab) } label: { Label("预览文档", systemImage: "sidebar.right") }.buttonStyle(V3ButtonStyle(kind: .ghost))
                            let saved = savedDocuments.contains(tab.content)
                            Button { savingDocument = message.text("content") } label: { Label(saved ? "已保存" : "保存到资料库", systemImage: "tray.and.arrow.down") }
                                .buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(saved)
                        }
                    }
                }
            }
            if !user { Spacer(minLength: 0) }
        }
    }

    private func clarificationCard(_ message: JSONValue) -> some View {
        let questions = message["clarification"]?["questions"]?.items ?? []
        let complete = questions.allSatisfy { answers[$0.text("id")] != nil }
        return VStack(alignment: .leading, spacing: 12) {
            ForEach(questions, id: \.self) { question in
                VStack(alignment: .leading, spacing: 6) {
                    Text(question.text("question").nonEmptyOr(question.text("header"))).font(V3.sans(13, weight: .medium))
                    FlowLayout(spacing: 6) {
                        ForEach(question["options"]?.items ?? [], id: \.self) { option in
                            let selected = answers[question.text("id")] == option.text("id")
                            Button { answers[question.text("id")] = option.text("id") } label: {
                                Text(option.text("label")).font(V3.sans(12.5)).padding(.horizontal, 10).frame(height: 28)
                                    .foregroundStyle(selected ? .white : V3.txt)
                                    .background(selected ? V3.txt : V3.field, in: RoundedRectangle(cornerRadius: 8))
                            }.buttonStyle(.plain).help(option.text("description"))
                        }
                    }
                }
            }
            Button("提交选择") { Task { await answerClarification(message, questions: questions) } }
                .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(!complete || sending)
        }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
    }

    private func proposalCard(_ proposal: JSONValue) -> some View {
        let changes = proposal["preview"]?["changes"]?.items ?? []
        let id = proposal.text("id")
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("简历修改建议", systemImage: "doc.badge.gearshape").font(V3.sans(13, weight: .medium))
                Spacer()
                if !proposal.text("proposed_title").isEmpty { Text("将生成「\(proposal.text("proposed_title"))」").font(V3.sans(11.5)).foregroundStyle(V3.fnt) }
            }
            Text(proposal.text("summary")).font(V3.sans(13)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true)
            ForEach(Array(changes.prefix(8).enumerated()), id: \.offset) { _, change in
                VStack(alignment: .leading, spacing: 4) {
                    if !change.text("before").isEmpty { Text(change.text("before")).font(V3.sans(12)).strikethrough().foregroundStyle(V3.fnt) }
                    if !change.text("after").isEmpty { Text(change.text("after")).font(V3.sans(12)).foregroundStyle(V3.txt) }
                }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(V3.stage, in: RoundedRectangle(cornerRadius: 8))
            }
            if changes.count > 8 { Text("另有 \(changes.count - 8) 处修改").font(V3.sans(11.5)).foregroundStyle(V3.fnt) }
            HStack {
                if !proposal.text("resume_id").isEmpty {
                    Button("在简历中预览") { openPreview(ChatPreviewTab(kind: .resume, id: proposal.text("resume_id"), label: proposal.text("resume_title").nilIfEmpty ?? "简历")) }
                        .buttonStyle(CareerActionStyle(kind: .link))
                }
                Spacer()
                Button("不采用") { Task { await decide(proposal, confirm: false) } }.buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(proposalBusy != nil)
                Button(proposalBusy == id ? "正在应用…" : "应用到简历") { Task { await decide(proposal, confirm: true) } }
                    .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(proposalBusy != nil)
            }
        }.padding(16).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !screenshots.isEmpty { screenshotStrip(screenshots, removable: true) }
            if !contexts.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(contexts, id: \.self) { item in
                        HStack(spacing: 4) {
                            Text(item.text("label")).font(V3.sans(12)).lineLimit(1)
                            Button { contexts.removeAll { $0 == item } } label: { Image(systemName: "xmark").font(.system(size: 8, weight: .semibold)) }.buttonStyle(.plain)
                        }.padding(.horizontal, 8).frame(height: 24).background(V3.blueSoft, in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $draft).font(V3.sans(14)).scrollContentBackground(.hidden).frame(height: 56).accessibilityLabel("向 LinkResume 提问")
                if draft.isEmpty { Text(ready == false ? "AI 助手暂未开放" : "输入问题，⌘↩ 发送").foregroundStyle(V3.fnt).font(V3.sans(14)).padding(.leading, 5).padding(.top, 8).allowsHitTesting(false) }
            }
            HStack(spacing: 10) {
                Menu {
                    if contextGroups.isEmpty { Text("正在读取可附加的资料…") }
                    ForEach(contextGroups, id: \.self) { group in
                        Section(contextTypeLabel(group.text("type"))) {
                            ForEach((group["items"]?.items ?? []).prefix(12), id: \.self) { item in
                                Button(item.text("label")) { if !contexts.contains(item) { contexts.append(item) } }
                            }
                        }
                    }
                    Section("截图") {
                        Button("截取屏幕区域…") { Task { await captureScreen() } }
                        Button("粘贴剪贴板中的图片") { pasteImage() }
                        Button("选择图片文件…") { pickImages() }
                    }
                } label: { Image(systemName: "plus") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .accessibilityLabel("附加资料或截图").task { await loadContexts() }
                if let notice { Text(notice).font(V3.sans(11.5)).foregroundStyle(V3.orange).lineLimit(2) }
                Spacer()
                if sending, runID != nil {
                    Button { Task { await cancel() } } label: { Label("停止", systemImage: "stop.circle") }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }
                Button { Task { await send(draft) } } label: {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white).frame(width: 36, height: 36)
                        .background(canSend ? V3.txt : Color(hex: 0xC9C9C3), in: Circle())
                }.buttonStyle(.plain).disabled(!canSend).keyboardShortcut(.return, modifiers: .command).accessibilityLabel("发送")
            }
        }.padding(14).background(.white, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
        .dropDestination(for: URL.self) { urls, _ in
            let images = urls.compactMap { url in NSImage(contentsOf: url).flatMap(Self.png).map { (url.lastPathComponent, $0) } }
            images.forEach { addScreenshot($0.1, label: $0.0) }
            return !images.isEmpty
        }
    }

    // MARK: Screenshots

    private func screenshotStrip(_ shots: [ChatScreenshot], removable: Bool) -> some View {
        FlowLayout(spacing: 6) {
            ForEach(shots) { shot in
                ZStack(alignment: .topTrailing) {
                    Button { openPreview(shot.tab) } label: {
                        Group {
                            if let image = NSImage(data: shot.data) { Image(nsImage: image).resizable().aspectRatio(contentMode: .fill) } else { V3.field }
                        }.frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(previewActive == shot.tab.key && previewOpen ? V3.blue : V3.cl))
                    }.buttonStyle(.plain).help(shot.label).accessibilityLabel("预览截图 \(shot.label)")
                    if removable {
                        Button { screenshots.removeAll { $0.id == shot.id }; closePreview(shot.tab.key) } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(V3.fnt).background(Circle().fill(.white))
                        }.buttonStyle(.plain).offset(x: 5, y: -5).accessibilityLabel("移除截图 \(shot.label)")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func localBubbles(at anchor: Int) -> some View {
        ForEach(localMessages.filter { $0.anchor == anchor }) { local in
            HStack {
                if local.user { Spacer(minLength: 80) }
                VStack(alignment: local.user ? .trailing : .leading, spacing: 6) {
                    if !local.screenshots.isEmpty { screenshotStrip(local.screenshots, removable: false) }
                    if !local.contexts.isEmpty {
                        Text(local.contexts.map { $0.text("label") }.joined(separator: "、")).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                    }
                    if local.user {
                        Text(local.content).font(V3.sans(14)).textSelection(.enabled).padding(.horizontal, 14).padding(.vertical, 10)
                            .background(V3.field, in: RoundedRectangle(cornerRadius: 14))
                    } else {
                        Text(local.content).font(V3.sans(13.5)).foregroundStyle(V3.sub).textSelection(.enabled)
                    }
                }
                if !local.user { Spacer(minLength: 0) }
            }
        }
    }

    static let maximumScreenshots = 9

    private func addScreenshot(_ data: Data, label: String) {
        guard screenshots.count < Self.maximumScreenshots else { notice = "一次最多附加 \(Self.maximumScreenshots) 张截图。"; return }
        guard data.count <= 10 * 1024 * 1024 else { notice = "截图不能超过 10 MB。"; return }
        notice = nil
        screenshots.append(ChatScreenshot(id: UUID().uuidString.lowercased(), label: label, data: data))
    }

    static func png(_ image: NSImage) -> Data? {
        guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) else { return nil }
        return bitmap.representation(using: .png, properties: [:])
    }

    private func pasteImage() {
        let board = NSPasteboard.general
        if let data = board.data(forType: .png) { addScreenshot(data, label: "粘贴的截图.png"); return }
        if let image = NSImage(pasteboard: board), let data = Self.png(image) { addScreenshot(data, label: "粘贴的截图.png"); return }
        notice = "剪贴板里没有图片。"
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            if let image = NSImage(contentsOf: url), let data = Self.png(image) { addScreenshot(data, label: url.lastPathComponent) }
            else { notice = "「\(url.lastPathComponent)」读取失败。" }
        }
    }

    /// 系统交互式区域截图（`screencapture -i`），按 Esc 取消时不添加。首次使用需要在系统设置授予屏幕录制权限。
    private func captureScreen() async {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("linkresume-shot-\(UUID().uuidString).png")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        process.arguments = ["-i", "-x", url.path]
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            process.terminationHandler = { _ in continuation.resume() }
            do { try process.run() } catch { process.terminationHandler = nil; continuation.resume() }
        }
        defer { try? FileManager.default.removeItem(at: url) }
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return }
        let formatter = DateFormatter(); formatter.dateFormat = "HHmmss"
        addScreenshot(data, label: "截图-\(formatter.string(from: Date())).png")
    }

    /// Web `isDocumentRequest`：明确要求生成文档（且没有否定）的请求。
    static func isDocumentRequest(_ prompt: String) -> Bool {
        prompt.range(of: "(?:不要|不必|不用|不需要|无需|别).{0,8}(?:生成|整理|写|输出|制作|准备)", options: .regularExpression) == nil
            && prompt.range(of: "(?:生成|整理成|写|输出|制作|准备).{0,30}(?:文档|\\.md|markdown)", options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// 生成中也可插话（服务端开放 steering 时），消息会排进当前运行。
    private var canSend: Bool { (!sending || (steering && runID != nil)) && ready != false && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var currentModelName: String? { models.first { $0.text("id") == modelID }?.text("name").nilIfEmpty ?? modelName }

    /// Web 文档生成规则：完整回复中有一级 Markdown 标题时视为可保存的文档。
    static func documentTitle(_ content: String) -> String? {
        content.components(separatedBy: "\n").first { $0.hasPrefix("# ") }.map { String($0.dropFirst(2)).trimmingCharacters(in: .whitespaces) }.flatMap { $0.isEmpty ? nil : $0 }
    }

    private func contextTypeLabel(_ type: String) -> String {
        ["user_profile": "求职资料", "resume": "简历", "resume_version": "简历版本", "dataset": "资料库", "job": "岗位", "application": "求职进程", "interview": "面试"][type] ?? type
    }

    // MARK: Actions

    private func open() async {
        currentID = sessionID; messages = []; proposals = []; streaming = ""; error = nil; title = "新对话"; answers = [:]
        previewTabs = []; previewActive = nil; previewOpen = false; unavailableFiles = []
        screenshots = []; localMessages = []; notice = nil
        let api = self.api
        async let readiness = try? api.careerRequest(path: "/api/agent/readiness", method: "GET", query: [:], body: nil)
        async let model = try? api.careerRequest(path: "/api/agent/model", method: "GET", query: [:], body: nil)
        let (readyValue, modelValue) = await (readiness, model)
        if case .bool(let flag) = readyValue?["ready"] { ready = flag } else { ready = readyValue == nil ? nil : false }
        if case .bool(let flag) = readyValue?["steering"] { steering = flag }
        modelName = modelValue?["model"]?.text("name").nilIfEmpty
        if let list = try? await api.careerRequest(path: "/api/agent/models", method: "GET", query: [:], body: nil) {
            models = list["models"]?.items ?? []
            modelID = list["defaultModelId"]?.stringValue ?? modelValue?["model"]?.text("id").nilIfEmpty
        }
        if let sessionID {
            await reload(sessionID)
            if let active = try? await api.careerRequest(path: "/api/agent/sessions/\(sessionID)/active-run", method: "GET", query: [:], body: nil),
               let run = active["run"]?.text("run_id"), !run.isEmpty {
                await stream(path: "/api/agent/runs/\(run)/events", method: "GET", body: nil, sessionID: sessionID)
            }
        }
        if let initialMessage, !consumedInitial, !initialMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            consumedInitial = true
            await send(initialMessage)
        }
    }

    private func reload(_ id: String) async {
        do {
            let result = try await api.careerRequest(path: "/api/agent/sessions/\(id)", method: "GET", query: [:], body: nil)
            guard currentID == id else { return }
            messages = result["session"]?["messages"]?.items ?? []
            title = result["session"]?.text("title").nilIfEmpty ?? "新对话"
            if let selected = result["session"]?["selected_model_id"]?.stringValue { modelID = selected }
            if let list = try? await api.careerRequest(path: "/api/agent/proposals", method: "GET", query: ["session_id": id], body: nil), currentID == id {
                proposals = list["proposals"]?.items ?? []
            }
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            if currentID == id { self.error = AgentRequest.errorMessage(error) }
        }
    }

    private func loadContexts() async {
        guard contextGroups.isEmpty, let result = try? await api.careerRequest(path: "/api/agent/contexts", method: "GET", query: ["limit": "50"], body: nil) else { return }
        if let groups = result["groups"]?.items, !groups.isEmpty { contextGroups = groups }
        else if let flat = result["contexts"]?.items {
            var types: [String] = []
            for item in flat where !types.contains(item.text("type")) { types.append(item.text("type")) }
            contextGroups = types.map { type in .object(["type": .string(type), "items": .array(flat.filter { $0.text("type") == type })]) }
        }
    }

    private func ensureSession() async throws -> String {
        if let currentID { return currentID }
        let result = try await api.careerRequest(path: "/api/agent/sessions", method: "POST", query: [:], body: modelID.map { .object(["modelId": .string($0)]) } ?? .object([:]))
        guard let id = result["session"]?.text("id").nilIfEmpty else { throw APIError.invalidResponse }
        currentID = id; title = result["session"]?.text("title").nilIfEmpty ?? "新对话"
        created(id)
        return id
    }

    private func send(_ text: String, replyTo: Int? = nil, clarificationAnswers: [JSONValue]? = nil) async {
        let content = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if replyTo == nil, !screenshots.isEmpty, !content.isEmpty, !sending {
            // 与 Web 相同：截图理解尚未连接后端，只在本机留下本地消息。
            if Self.isDocumentRequest(content) { notice = "截图目前仅支持本地预览，请移除截图后发送文字请求。"; return }
            let anchor = messages.count
            localMessages.append(LocalChatMessage(id: UUID().uuidString, anchor: anchor, user: true, content: content, contexts: contexts, screenshots: screenshots))
            localMessages.append(LocalChatMessage(id: UUID().uuidString, anchor: anchor, user: false,
                                                  content: "截图已加入本次对话，可点击缩略图查看。截图理解尚未连接后端，当前仅保留本地预览。", contexts: [], screenshots: []))
            draft = ""; screenshots = []; contexts = []; notice = nil
            return
        }
        if sending, steering, let runID, !content.isEmpty { await steer(content, runID: runID); return }
        guard !content.isEmpty, !sending else { return }
        sending = true; error = nil; streaming = ""; status = nil
        let attached = contexts
        do {
            let id = try await ensureSession()
            var body: [String: JSONValue] = ["content": .string(content), "idempotency_key": .string(UUID().uuidString.lowercased())]
            if !attached.isEmpty {
                body["contexts"] = .array(attached.map { item in
                    var ref: [String: JSONValue] = ["type": .string(item.text("type")), "id": .string(item.text("id")), "presentation": .string("mention")]
                    if !item.text("version_id").isEmpty { ref["version_id"] = .string(item.text("version_id")) }
                    return .object(ref)
                })
            }
            if let replyTo { body["reply_to_sequence_no"] = .number(Double(replyTo)) }
            if let clarificationAnswers { body["clarification_answers"] = .array(clarificationAnswers) }
            draft = ""; contexts = []; answers = [:]
            messages.append(.object(["role": .string("user"), "content": .string(content), "contexts": .array(attached)]))
            await stream(path: "/api/agent/sessions/\(id)/messages", method: "POST", body: .object(body), sessionID: id)
        } catch {
            sending = false
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = AgentRequest.errorMessage(error)
        }
    }

    private func stream(path: String, method: String, body: JSONValue?, sessionID id: String) async {
        sending = true
        defer { sending = false; runID = nil; status = nil }
        do {
            try await api.streamAgent(path: path, method: method, body: body) { event in
                guard currentID == id else { return }
                handle(event)
            }
        } catch is CancellationError {
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            if currentID == id { self.error = AgentRequest.errorMessage(error) }
        }
        streaming = ""
        if currentID == id { await reload(id) }
        sessionsChanged()
    }

    private func handle(_ event: AgentEvent) {
        let data = event.data
        if runID == nil, !data.text("runId").isEmpty { runID = data.text("runId") }
        switch event.type {
        case "run.phase": status = data.text("label").nilIfEmpty ?? status
        case "assistant.activity.status": status = data.text("label").nilIfEmpty ?? status
        case "tool.started": status = "正在调用工具…"
        case "assistant.delta": streaming += data.text("delta")
        case "assistant.message.completed":
            var message: [String: JSONValue] = ["role": .string("assistant"), "content": .string(data.text("content")),
                                                "sequence_no": data["sequenceNo"] ?? .null]
            if let clarification = data["clarification"] { message["clarification"] = clarification }
            messages.append(.object(message)); streaming = ""
        case "clarification.requested":
            if let index = messages.lastIndex(where: { $0.text("role") == "assistant" }), case .object(var fields) = messages[index] {
                fields["clarification"] = data["clarification"]; messages[index] = .object(fields)
            }
        case "proposal.created": if let proposal = data["proposal"] { proposals.append(proposal) }
        case "user.message.rejected": error = AgentRequest.errorMessage(APIError.server(status: 409, code: data.text("error")))
        case "run.failed": error = AgentRequest.errorMessage(APIError.server(status: 500, code: data.text("error")))
        case "run.cancelled": status = nil; if !streaming.isEmpty { messages.append(.object(["role": .string("assistant"), "content": .string(streaming + "\n\n（已停止生成）")])); streaming = "" }
        default: break
        }
    }

    private func answerClarification(_ message: JSONValue, questions: [JSONValue]) async {
        let text = questions.map { question in
            let option = (question["options"]?.items ?? []).first { $0.text("id") == answers[question.text("id")] }
            return "\(question.text("header"))：\(option?.text("label") ?? "")"
        }.joined(separator: "\n")
        let payload = questions.map { JSONValue.object(["question_id": .string($0.text("id")), "option_id": .string(answers[$0.text("id")] ?? "")]) }
        await send(text, replyTo: message["sequence_no"]?.integer, clarificationAnswers: payload)
    }

    private func decide(_ proposal: JSONValue, confirm: Bool) async {
        let id = proposal.text("id")
        guard proposalBusy == nil else { return }
        proposalBusy = id; defer { proposalBusy = nil }
        do {
            let result = try await api.careerRequest(path: "/api/agent/proposals/\(id)/\(confirm ? "confirm" : "reject")", method: "POST", query: [:], body: nil)
            if let index = proposals.firstIndex(where: { $0.text("id") == id }), case .object(var fields) = proposals[index] {
                fields["status"] = .string(confirm ? "applied" : "rejected"); proposals[index] = .object(fields)
            }
            if confirm { error = nil; messages.append(.object(["role": .string("assistant"), "content": .string("已应用到「\(result["resume"]?.text("title") ?? "简历")」，可以在“我的简历”预览。")])) }
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = AgentRequest.errorMessage(error)
            if let current = currentID { await reload(current) }
        }
    }

    /// 插话：`POST /api/agent/runs/{id}/steer`，回执的应用结果随当前流的 `user.message.applied/rejected` 返回。
    private func steer(_ content: String, runID: String) async {
        let key = UUID().uuidString.lowercased()
        do {
            _ = try await api.careerRequest(path: "/api/agent/runs/\(runID)/steer", method: "POST", query: [:],
                                            body: .object(["content": .string(content), "idempotency_key": .string(key)]))
            draft = ""
            messages.append(.object(["role": .string("user"), "content": .string(content)]))
            status = "已插入，将在当前步骤后处理"
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = AgentRequest.errorMessage(error)
        }
    }

    private func chooseModel(_ model: JSONValue) async {
        let id = model.text("id")
        guard id != modelID else { return }
        let previous = modelID
        modelID = id
        guard let currentID else { return }
        do { _ = try await api.careerRequest(path: "/api/agent/sessions/\(currentID)", method: "PATCH", query: [:], body: .object(["modelId": .string(id)])) }
        catch { modelID = previous; self.error = AgentRequest.errorMessage(error) }
    }

    private func cancel() async {
        guard let runID else { return }
        _ = try? await api.careerRequest(path: "/api/agent/runs/\(runID)/cancel", method: "POST", query: [:], body: nil)
    }

    private func rename() async {
        let value = renameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let currentID, !value.isEmpty else { return }
        do {
            let result = try await api.careerRequest(path: "/api/agent/sessions/\(currentID)", method: "PATCH", query: [:], body: .object(["title": .string(value)]))
            title = result["session"]?.text("title").nilIfEmpty ?? value; sessionsChanged()
        } catch { self.error = AgentRequest.errorMessage(error) }
    }

    private func deleteSession() async {
        guard let currentID else { return }
        do { _ = try await api.careerRequest(path: "/api/agent/sessions/\(currentID)", method: "DELETE", query: [:], body: nil); deleted() }
        catch { self.error = AgentRequest.errorMessage(error) }
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

private struct DocumentDraft: Identifiable { let content: String; var id: String { content } }

/// 本机截图附件。
struct ChatScreenshot: Identifiable, Equatable {
    let id: String
    let label: String
    let data: Data
    var tab: ChatPreviewTab { ChatPreviewTab(kind: .image, id: id, label: label, imageData: data) }
}

/// 只存在于本机的对话消息（带截图发送时产生），`anchor` 为它出现时服务端消息的数量。
struct LocalChatMessage: Identifiable {
    let id: String
    let anchor: Int
    let user: Bool
    let content: String
    let contexts: [JSONValue]
    let screenshots: [ChatScreenshot]
}

/// 把 AI 生成的文档以 `.md` 保存到资料库所选文件夹（Web “保存到资料库”）。重名时加时间后缀保留两份；
/// 上传使用固定标识，网络结果不确定时重试不会重复保存。
private struct SaveDocumentSheet: View {
    @Environment(SessionStore.self) private var session
    let content: String
    let title: String
    let close: () -> Void
    var saved: () -> Void = {}
    @State private var folders: [JSONValue] = []
    @State private var folder = ""
    @State private var newFolder = ""
    @State private var busy = false
    @State private var error: String?
    @State private var upload: DatasetUpload?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("保存到资料库").font(V3.serif(20))
            Text("「\(title)」将以 Markdown 文件保存。").font(V3.sans(13)).foregroundStyle(V3.sub)
            Picker("文件夹", selection: $folder) {
                Text("选择文件夹").tag("")
                ForEach(folders, id: \.self) { Text($0.text("name")).tag($0.text("id")) }
            }.disabled(busy || upload != nil)
            HStack {
                TextField("或新建文件夹", text: $newFolder).textFieldStyle(.roundedBorder)
                Button("新建") { Task { await createFolder() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    .disabled(busy || newFolder.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("取消") { upload?.discard(); close() }.buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy)
                Button(busy ? "正在保存…" : "保存") { Task { await save() } }.buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy || folder.isEmpty)
            }
        }.padding(24).frame(width: 440)
            .task { await loadFolders() }
    }

    private func loadFolders() async {
        guard let result = try? await session.api.careerRequest(path: "/api/datasets/folders", method: "GET", query: [:], body: nil) else { error = "文件夹读取失败，请稍后重试。"; return }
        folders = (result["folders"]?.items ?? result["items"]?.items ?? []).filter { !$0.text("id").isEmpty }
        if folder.isEmpty { folder = folders.first?.text("id") ?? "" }
    }

    private func createFolder() async {
        busy = true; defer { busy = false }
        do {
            let result = try await session.api.careerRequest(path: "/api/datasets/folders", method: "POST", query: [:],
                                                             body: .object(["name": .string(newFolder.trimmingCharacters(in: .whitespacesAndNewlines))]))
            newFolder = ""
            await loadFolders()
            if let id = (result["folder"] ?? result)["id"]?.stringValue { folder = id }
        } catch { self.error = "新建文件夹失败，可能已有同名文件夹。" }
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            if upload == nil || upload?.folder != folder {
                upload?.discard()
                let safe = title.map { "/:\\\0".contains($0) ? "-" : $0 }.reduce(into: "") { $0.append($1) }.prefix(80)
                let directory = try DatasetUpload.privateDirectory()
                defer { try? FileManager.default.removeItem(at: directory) }
                let source = directory.appendingPathComponent(String(safe) + ".md")
                try Data(content.utf8).write(to: source)
                upload = try DatasetUpload.snapshot(source, folder: folder, limit: 50 * 1024 * 1024)
            }
            guard var current = upload else { return }
            do { _ = try await session.api.uploadDataset(current) }
            catch APIError.server(_, let code) where ["DATASET_NAME_CONFLICT", "DATASET_FILENAME_CONFLICT"].contains(code) {
                let formatter = DateFormatter(); formatter.dateFormat = "yyyyMMdd-HHmmss"
                current = current.rekey(); current.name = title + "-" + formatter.string(from: Date()) + ".md"; upload = current
                _ = try await session.api.uploadDataset(current)
            }
            current.discard(); upload = nil
            saved()
            close()
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = "保存失败：结果尚未确认时可直接重试，不会重复保存。"
        }
    }
}
