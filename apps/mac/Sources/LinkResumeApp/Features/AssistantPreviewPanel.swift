import AppKit
import LinkResumeCore
import LinkResumeRender
import SwiftUI

/// 对话右侧文件预览（Web `features/assistant/PreviewPanel.tsx`）：简历纸面、资料库文本、AI 生成文档与本地截图，最多 6 个标签。
/// 简历标签把待确认修改的原文所在段落标黄（与 Web `HighlightedContent` 同样按段落/列表项文字匹配）。
struct ChatPreviewTab: Equatable {
    enum Kind: String { case resume, dataset, generated, image }
    let kind: Kind
    let id: String
    var label: String
    var content = ""
    var pending: [String] = []
    var saved = false
    /// 截图标签的 PNG 数据，只在本机内存中。
    var imageData: Data?
    var key: String { kind.rawValue + ":" + id }

    static let maximum = 6

    /// 同一文件只保留一个标签，内容有变化时就地更新；超出上限时丢掉最早打开的。
    static func open(_ tabs: [ChatPreviewTab], _ tab: ChatPreviewTab) -> [ChatPreviewTab] {
        if let index = tabs.firstIndex(where: { $0.key == tab.key }) {
            var next = tabs; next[index] = tab; return next
        }
        return Array((tabs + [tab]).suffix(maximum))
    }

    /// 消息上下文（`resume` / `resume_version` / `dataset`）对应的标签；其他类型不可预览。
    static func forContext(_ context: JSONValue) -> ChatPreviewTab? {
        switch context.text("type") {
        case "resume", "resume_version":
            let id = context.text("resume_id").nilIfEmpty ?? context.text("id")
            return id.isEmpty ? nil : ChatPreviewTab(kind: .resume, id: id, label: context.text("label"))
        case "dataset":
            return context.text("id").isEmpty ? nil : ChatPreviewTab(kind: .dataset, id: context.text("id"), label: context.text("label"))
        default: return nil
        }
    }
}

struct ChatPreviewPanel: View {
    @Environment(WorkspaceRouter.self) private var router: WorkspaceRouter?
    let tabs: [ChatPreviewTab]
    let active: String?
    let unavailable: Set<String>
    let activate: (String) -> Void
    let closeTab: (String) -> Void
    let close: () -> Void
    let save: (ChatPreviewTab) -> Void
    let markUnavailable: (String) -> Void
    @State private var reload = UUID()
    @State private var copied = false

    private var current: ChatPreviewTab? { tabs.first { $0.key == active } ?? tabs.last }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 2) { ForEach(tabs, id: \.key) { tab in tabButton(tab) } }
                }
                Menu {
                    Button("重新加载") { reload = UUID() }
                    Button("关闭其他标签") { tabs.filter { $0.key != current?.key }.forEach { closeTab($0.key) } }.disabled(tabs.count < 2)
                } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().accessibilityLabel("更多操作")
                Button(action: close) { Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)) }.buttonStyle(.plain).padding(.horizontal, 6)
                    .keyboardShortcut(.cancelAction).accessibilityLabel("关闭预览")
            }.padding(.horizontal, 10).frame(height: 44)
            Divider()
            Group {
                if let current {
                    switch current.kind {
                    case .resume: ChatResumePreview(resumeID: current.id, highlights: current.pending, onMissing: { markUnavailable(current.key) })
                    case .image: ChatImagePreview(data: current.imageData, label: current.label)
                    case .dataset: ChatDatasetPreview(datasetID: current.id, onMissing: { markUnavailable(current.key) })
                    case .generated: ScrollView { NativeMarkdownView(source: current.content).textSelection(.enabled).padding(20).frame(maxWidth: .infinity, alignment: .leading) }
                    }
                }
            }.id((current?.key ?? "") + reload.uuidString).frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            if let current { footer(current).padding(.horizontal, 14).frame(height: 48) }
        }
        .background(.white)
    }

    private func tabButton(_ tab: ChatPreviewTab) -> some View {
        let selected = tab.key == current?.key
        return HStack(spacing: 5) {
            Button { activate(tab.key) } label: {
                Label(tab.label.nilIfEmpty ?? "未命名", systemImage: ["resume": "doc.text", "generated": "sparkles.rectangle.stack", "image": "photo"][tab.kind.rawValue] ?? "doc")
                    .font(V3.sans(12)).lineLimit(1).frame(maxWidth: 140)
            }.buttonStyle(.plain).foregroundStyle(unavailable.contains(tab.key) ? V3.fnt : V3.txt)
            Button { closeTab(tab.key) } label: { Image(systemName: "xmark").font(.system(size: 8, weight: .semibold)) }.buttonStyle(.plain)
                .accessibilityLabel("关闭 \(tab.label)")
        }.padding(.horizontal, 9).frame(height: 28).background(selected ? V3.field : .clear, in: RoundedRectangle(cornerRadius: 7)).help(tab.label)
    }

    @ViewBuilder private func footer(_ tab: ChatPreviewTab) -> some View {
        HStack(spacing: 8) {
            switch tab.kind {
            case .resume:
                Text(tab.pending.isEmpty ? "只读预览 · 编辑请在编辑器中打开" : "\(tab.pending.count) 处待确认修改已在简历中标出").font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                Spacer()
                Button { router?.jump(.editResume(tab.id)) } label: { Label("在编辑器中打开", systemImage: "arrow.up.forward.square") }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    .disabled(unavailable.contains(tab.key))
            case .dataset:
                Text("只读预览 · AI 已读取其中的文字内容").font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                Spacer()
                Button { router?.jump(.section(.datasets)) } label: { Label("在资料库中打开", systemImage: "arrow.up.forward.square") }.buttonStyle(V3ButtonStyle(kind: .ghost))
            case .image:
                Text("截图 · 仅在本次对话中可见").font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                Spacer()
            case .generated:
                Text(tab.saved ? "已保存到资料库" : "未保存 · 仅在本次对话中可见").font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents(); NSPasteboard.general.setString(tab.content, forType: .string)
                    copied = true; Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: { Label(copied ? "已复制" : "复制", systemImage: "doc.on.doc") }.buttonStyle(V3ButtonStyle(kind: .ghost))
                Button(tab.saved ? "已保存" : "保存到资料库") { save(tab) }.buttonStyle(V3ButtonStyle(kind: .dark)).disabled(tab.saved)
            }
        }
    }
}

private enum PreviewLoad { case loading, ready, missing, failed }

private func previewMissing(_ error: Error) -> Bool {
    if case APIError.server(let status, let code) = error { return [403, 404].contains(status) || code.contains("NOT_FOUND") || code.contains("FORBIDDEN") }
    return false
}

private struct PreviewStateView: View {
    let state: PreviewLoad
    var unsupported = false
    var body: some View {
        VStack(spacing: 8) {
            if state == .loading { ProgressView().controlSize(.small) }
            else {
                Text(unsupported ? "暂不支持预览此格式" : state == .missing ? "这个文件已不可用" : "预览加载失败").font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt)
                Text(unsupported ? "Word、图片等格式请在资料库下载后查看；AI 已读取其中的文字内容。" : state == .missing ? "它可能已被删除或移动，对话中的引用保留为灰色。" : "网络异常或文件解析未完成，可以从“更多操作”重新加载。")
                    .font(V3.sans(12)).foregroundStyle(V3.fnt).multilineTextAlignment(.center)
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// 简历标签：取列表中的预览快照（与“我的简历”卡片同源），在纸面 WebView 中按面板宽度缩放显示。
private struct ChatResumePreview: View {
    @Environment(SessionStore.self) private var session
    let resumeID: String
    var highlights: [String] = []
    let onMissing: () -> Void
    @State private var paper: ResumeRenderRequest?
    @State private var height: CGFloat = 1123
    @State private var state = PreviewLoad.loading

    var body: some View {
        GeometryReader { geometry in
            let scale = max(0.3, (geometry.size.width - 32) / 794)
            ScrollView {
                if let paper, state == .ready {
                    ResumePaperView(request: paper, highlights: highlights, onRendered: { height = max(1123, $0) }, onError: { _ in state = .failed })
                        .frame(width: 794, height: height).allowsHitTesting(false)
                        .scaleEffect(scale, anchor: .topLeading)
                        .frame(width: 794 * scale, height: height * scale, alignment: .topLeading)
                        .padding(16)
                } else { PreviewStateView(state: state).frame(height: geometry.size.height) }
            }.background(Tokens.Color.stage)
        }
        .task {
            state = .loading
            do {
                let resumes = try await session.api.listResumes()
                guard let resume = resumes.first(where: { $0.id == resumeID }) else { state = .missing; onMissing(); return }
                guard let request = resume.renderRequest() else { state = .failed; return }
                paper = try await session.api.preparePaper(request).request
                state = .ready
            } catch is CancellationError {
            } catch {
                if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
                state = previewMissing(error) ? .missing : .failed
                if state == .missing { onMissing() }
            }
        }
    }
}

/// 资料标签：`GET /api/datasets/{id}/content` 的解析文本；只预览 md/txt/pdf 的文字内容。
private struct ChatDatasetPreview: View {
    @Environment(SessionStore.self) private var session
    let datasetID: String
    let onMissing: () -> Void
    @State private var markdown = ""
    @State private var unsupported = false
    @State private var state = PreviewLoad.loading

    var body: some View {
        Group {
            if state == .ready && !unsupported {
                ScrollView { NativeMarkdownView(source: markdown).textSelection(.enabled).padding(20).frame(maxWidth: .infinity, alignment: .leading) }
            } else { PreviewStateView(state: unsupported ? .failed : state, unsupported: unsupported) }
        }
        .task {
            state = .loading; unsupported = false
            do {
                let content = try await session.api.careerRequest(path: "/api/datasets/\(datasetID)/content", method: "GET", query: [:], body: nil)
                let format = content.text("file_format").lowercased()
                unsupported = !["md", "markdown", "txt", "pdf"].contains(format)
                markdown = content.text("markdown")
                state = .ready
            } catch is CancellationError {
            } catch {
                if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
                state = previewMissing(error) ? .missing : .failed
                if state == .missing { onMissing() }
            }
        }
    }
}

/// 截图标签（Web `ImageBody`）：25%–300% 缩放查看。
private struct ChatImagePreview: View {
    let data: Data?
    let label: String
    @State private var zoom = 100

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Spacer()
                Button { zoom = max(25, zoom - 25) } label: { Image(systemName: "minus") }.disabled(zoom <= 25).accessibilityLabel("缩小图片")
                Button("\(zoom)%") { zoom = 100 }.font(V3.number(11.5, weight: .regular)).accessibilityLabel("恢复图片大小")
                Button { zoom = min(300, zoom + 25) } label: { Image(systemName: "plus") }.disabled(zoom >= 300).accessibilityLabel("放大图片")
            }.buttonStyle(.borderless).padding(.horizontal, 12).frame(height: 32)
            if let data, let image = NSImage(data: data) {
                GeometryReader { geometry in
                    ScrollView([.vertical, .horizontal]) {
                        Image(nsImage: image).resizable().aspectRatio(contentMode: .fit)
                            .frame(width: max(40, (geometry.size.width - 32) * CGFloat(zoom) / 100)).padding(16)
                    }
                }.background(Tokens.Color.stage)
            } else { PreviewStateView(state: .failed) }
        }.accessibilityLabel(label)
    }
}
