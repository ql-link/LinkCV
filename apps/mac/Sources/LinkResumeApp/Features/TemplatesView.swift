import LinkResumeCore
import LinkResumeRender
import SwiftUI

/// 简历模板（Web `features/templates/ResumeTemplatesPage.tsx`）。
/// 登录后读取 `GET /api/resume-templates` 的真实启用模板与使用次数，并可直接创建简历；
/// 游客没有模板接口权限，只展示随包的虚构示例，“使用此模板”先登录，登录后按模板 key 匹配真实模板继续创建。
struct TemplatesView: View {
    @Environment(SessionStore.self) private var session
    /// 登录前选中的示例模板 key；进入页面后自动打开创建弹窗。
    @Binding var pendingCreateKey: String?
    let requireLogin: (ResumeTemplate) -> Void
    let onCreated: (ResumeSummary.ID) -> Void

    @State private var templates: [ResumeTemplate] = []
    @State private var source = ""
    @State private var loading = false
    @State private var loadError: String?
    @State private var reload = UUID()
    @State private var preview: ResumeTemplate?
    @State private var createAfterDismiss: ResumeTemplate?
    @State private var creating: ResumeTemplate?
    @State private var selectedStyle = "全部风格"
    @State private var selectedUse = "全部场景"

    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var guest: Bool { account.isEmpty }
    private var styles: [String] { Array(Set(templates.flatMap(\.styleCategories))).sorted() }
    private var uses: [String] { Array(Set(templates.flatMap(\.useCases))).sorted() }
    private var filtered: [ResumeTemplate] {
        templates.filter {
            (selectedStyle == "全部风格" || $0.styleCategories.contains(selectedStyle))
                && (selectedUse == "全部场景" || $0.useCases.contains(selectedUse))
        }
    }
    private var ready: Bool { source == (guest ? "guest" : account) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                V3PageHead(eyebrow: ["TEMPLATES", ready ? "\(templates.count) 套" : "– 套"], title: "简历模板",
                           subtitle: "浏览当前可用版式，选择后填写简历名称并创建简历。") { EmptyView() }
                if guest {
                    Text("当前展示随包的虚构示例，可离线预览；登录后显示线上全部可用模板。")
                        .font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.top, 6)
                }
                if let loadError, !ready {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.arrow.triangle.2.circlepath").font(.system(size: 30)).foregroundStyle(V3.fnt)
                        Text("模板暂时无法加载").font(V3.serif(18))
                        Text(loadError).font(V3.sans(13)).foregroundStyle(V3.sub)
                        Button { reload = UUID() } label: { Label("重新加载", systemImage: "arrow.clockwise") }
                            .buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(loading)
                    }.frame(maxWidth: .infinity).padding(.top, 80)
                } else if !ready {
                    ProgressView("正在加载简历模板…").font(V3.sans(13)).frame(maxWidth: .infinity, minHeight: 250)
                } else if templates.isEmpty {
                    VStack(spacing: 12) {
                        Text("当前没有可用模板").font(V3.serif(18))
                        Text("模板启用后会显示在这里，你仍可以从已有简历继续使用。").font(V3.sans(13)).foregroundStyle(V3.sub)
                    }.frame(maxWidth: .infinity).padding(.top, 80)
                } else { grid }
            }.frame(maxWidth: 860, alignment: .leading).padding(.horizontal, 52).padding(.vertical, 20).frame(maxWidth: .infinity)
        }
        .task(id: "\(account)|\(reload)") { await load() }
        .onChange(of: account) { _, _ in templates = []; source = ""; preview = nil; creating = nil; selectedStyle = "全部风格"; selectedUse = "全部场景" }
        .onChange(of: source) { _, _ in openPendingCreate() }
        .sheet(item: $preview, onDismiss: {
            if let template = createAfterDismiss { createAfterDismiss = nil; use(template) }
        }) { template in
            TemplatePreview(template: template, guest: guest, close: { preview = nil }, use: {
                createAfterDismiss = template
                preview = nil
            }).frame(width: 960, height: 720)
        }
        .sheet(item: $creating) { template in
            CreateResumeSheet(template: template, close: { creating = nil }, created: { id in
                creating = nil
                onCreated(id)
            })
        }
    }

    private var grid: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("找到 \(filtered.count) 套模板").font(V3.sans(13))
                if selectedStyle != "全部风格" || selectedUse != "全部场景" {
                    Button("清除筛选") { selectedStyle = "全部风格"; selectedUse = "全部场景" }.buttonStyle(.link).font(V3.sans(12.5))
                }
                Spacer()
                Picker("风格", selection: $selectedStyle) {
                    Text("全部风格").tag("全部风格")
                    ForEach(styles, id: \.self) { Text($0).tag($0) }
                }.labelsHidden().frame(width: 140)
                Picker("场景", selection: $selectedUse) {
                    Text("全部场景").tag("全部场景")
                    ForEach(uses, id: \.self) { Text($0).tag($0) }
                }.labelsHidden().frame(width: 140)
            }.padding(.top, 28)
            Divider().padding(.top, 12)
            if filtered.isEmpty {
                Text("没有符合条件的模板，试试减少一个筛选条件。").font(V3.sans(13)).foregroundStyle(V3.fnt)
                    .frame(maxWidth: .infinity, minHeight: 160)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 20)], alignment: .leading, spacing: 32) {
                ForEach(filtered) { template in
                    Button { preview = template } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            TemplateThumbnail(template: template, guest: guest)
                            HStack(alignment: .firstTextBaseline) {
                                Text(template.name).font(V3.sans(13, weight: .medium)).lineLimit(2)
                                Spacer(minLength: 4)
                                if let count = template.useCount {
                                    Text("\(TemplatesView.formatUses(count)) 使用").font(V3.number(11, weight: .regular)).foregroundStyle(V3.fnt)
                                }
                            }
                            Text((template.styleCategories + template.useCases).joined(separator: " · "))
                                .font(V3.sans(11)).foregroundStyle(V3.fnt).lineLimit(2)
                        }
                    }.buttonStyle(.plain).accessibilityLabel("查看模板：\(template.name)")
                }
            }.padding(.top, 24)
        }
    }

    private func load() async {
        let owner = account
        loading = true; loadError = nil
        defer { if owner == account { loading = false } }
        do {
            let result: [ResumeTemplate]
            if owner.isEmpty { result = try GuestTemplates.load() } else { result = try await session.api.listResumeTemplates() }
            try Task.checkCancellation()
            guard owner == account else { return }
            templates = result; source = owner.isEmpty ? "guest" : owner
        } catch is CancellationError {
        } catch {
            guard owner == account else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure(); return }
            loadError = owner.isEmpty ? "随包示例读取失败，请重新打开模板页。" : "请检查网络后重试，已有简历不会受到影响。"
        }
    }

    private func use(_ template: ResumeTemplate) {
        if guest { requireLogin(template) } else { creating = template }
    }

    /// 登录前选的是随包示例，ID 与线上不同，按模板 key 找到对应的真实模板。
    private func openPendingCreate() {
        guard !guest, ready, let key = pendingCreateKey else { return }
        pendingCreateKey = nil
        if let template = templates.first(where: { $0.key == key }) { creating = template }
    }

    /// Web `formatTemplateUses`：千以下写原数，千以上写成 3.2k。
    static func formatUses(_ count: Int) -> String {
        guard count >= 1000 else { return String(count) }
        let value = (Double(count) / 100).rounded() / 10
        return value == value.rounded() ? "\(Int(value))k" : String(format: "%.1fk", value)
    }
}

/// 真实模板经会话准备私有图片；随包示例不读取会话、不发请求。
private func preparePaper(_ template: ResumeTemplate, guest: Bool, api: any APIClient) async throws -> PaperPreparation {
    if guest { return try await GuestTemplates.prepare(template) }
    return try await api.preparePaper(template.renderRequest())
}

/// 缩略纸面。
struct TemplateThumbnail: View {
    @Environment(SessionStore.self) private var session
    let template: ResumeTemplate
    let guest: Bool
    @State private var paper: ResumeRenderRequest?
    @State private var failed = false
    var body: some View {
        GeometryReader { geometry in
            if let paper {
                ResumePaperView(request: paper, onError: { _ in failed = true })
                    .frame(width: 794, height: 1123)
                    .scaleEffect(geometry.size.width / 794, anchor: .topLeading)
                    .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
                    .allowsHitTesting(false)
            } else if !failed { ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity) }
            if failed { Text("预览不可用").font(.caption).padding(8).background(.white) }
        }.aspectRatio(210.0 / 297, contentMode: .fit).background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xD3D3CE)))
            .task(id: template.id) {
                do {
                    let result = try await preparePaper(template, guest: guest, api: session.api)
                    try Task.checkCancellation(); paper = result.request
                }
                catch is CancellationError { }
                catch { failed = true }
            }
    }
}

private struct TemplatePreview: View {
    @Environment(SessionStore.self) private var session
    let template: ResumeTemplate
    let guest: Bool
    let close: () -> Void
    let use: () -> Void
    @State private var paper: ResumeRenderRequest?
    @State private var height: CGFloat = 1123
    @State private var error: String?
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(template.name).font(.title3.weight(.semibold))
                    if let description = template.description, !description.isEmpty {
                        Text(description).font(V3.sans(12)).foregroundStyle(V3.fnt).lineLimit(2)
                    }
                }
                Spacer()
                Button(guest ? "使用此模板" : "创建简历", action: use).buttonStyle(WebActionStyle())
                Button("关闭", action: close).buttonStyle(.plain).keyboardShortcut(.cancelAction)
            }.padding(20)
            Text("虚构示例资料 · 最终排版以 PDF 为准；字体、换行与分页可能不同。")
                .font(.system(size: 12)).foregroundStyle(Tokens.Color.textMuted).padding(.bottom, 12)
            if let error { Text(error).foregroundStyle(.red) }
            ScrollView([.vertical, .horizontal]) {
                if let paper {
                    ResumePaperView(request: paper, onRendered: { height = max(1123, $0) }, onError: { error = $0 })
                        .frame(width: 794, height: height).padding(24)
                } else if error == nil { ProgressView("加载预览…").padding(40) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Tokens.Color.stage)
        }.task {
            do {
                let result = try await preparePaper(template, guest: guest, api: session.api)
                try Task.checkCancellation(); paper = result.request
            }
            catch is CancellationError { }
            catch { self.error = "预览加载失败，请重试。" }
        }
    }
}

/// Web 模板页的“创建简历”弹窗：基于所选模板创建，输入一个便于识别的名称。
/// 创建接口没有幂等标识；结果不确定时提示先查看简历列表，避免重复创建。
private struct CreateResumeSheet: View {
    @Environment(SessionStore.self) private var session
    let template: ResumeTemplate
    let close: () -> Void
    let created: (ResumeSummary.ID) -> Void
    @State private var title = ""
    @State private var busy = false
    @State private var error: String?
    @State private var uncertain = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("创建简历").font(V3.serif(20))
            Text("基于“\(template.name)”创建简历，输入一个便于识别的名称。").font(V3.sans(13)).foregroundStyle(V3.sub)
            VStack(alignment: .leading, spacing: 6) {
                Text("简历名称").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.sub)
                TextField("例如：2026 产品经理简历", text: $title).textFieldStyle(.roundedBorder).onSubmit { submit() }
            }
            if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red).fixedSize(horizontal: false, vertical: true) }
            Text("创建后直接进入编辑器填写内容。")
                .font(V3.sans(12)).foregroundStyle(V3.fnt).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy).keyboardShortcut(.cancelAction)
                Button(busy ? "正在创建…" : uncertain ? "查看简历列表" : "确认创建", action: submit)
                    .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy)
            }
        }.padding(24).frame(width: 440)
    }

    private func submit() {
        guard !busy else { return }
        if uncertain { created(""); return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { error = "请输入简历名称。"; return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let result = try await session.api.careerRequest(path: "/api/resumes", method: "POST", query: [:],
                    body: .object(["title": .string(name), "template_id": .string(template.id)]))
                created(result["resume"]?["id"]?.stringValue ?? "")
            } catch {
                if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
                if case APIError.server = error {
                    self.error = ResumeRequest.errorMessage(error, fallback: "创建失败，请稍后重试。")
                } else if case APIError.unauthorized = error {
                    self.error = ResumeRequest.errorMessage(error, fallback: "")
                } else {
                    uncertain = true
                    self.error = "网络中断，无法确认是否已创建。请先查看简历列表，避免重复创建。"
                }
            }
        }
    }
}
