import LinkResumeCore
import LinkResumeRender
import SwiftUI

/// 简历模板页（原生版的示范页面）：左侧模板列表，右侧点阵舞台上的 A4 纸面。
/// 列表、舞台、切换动画、键盘操作都是原生；只有纸面内容由 ResumePaperView 渲染。
struct TemplatesView: View {
    @Environment(SessionStore.self) private var session
    @State private var templates: [ResumeTemplate] = []
    @State private var selectedID: ResumeTemplate.ID?
    @State private var loadError: String?

    private var selected: ResumeTemplate? { templates.first { $0.id == selectedID } }

    var body: some View {
        HSplitView {
            List(templates, selection: $selectedID) { template in
                VStack(alignment: .leading, spacing: 2) {
                    Text(template.name).font(.headline)
                    if let description = template.description {
                        Text(description).font(.caption).foregroundStyle(Tokens.Color.textMuted).lineLimit(2)
                    }
                }
                .padding(.vertical, 4)
            }
            .frame(minWidth: 220, idealWidth: 260, maxWidth: 320)

            stage
        }
        .navigationTitle("简历模板")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("使用此模板", systemImage: "plus") {}
                    .disabled(selected == nil)
                    .help("创建简历（待实现）")
            }
        }
        .task { await load() }
    }

    private var stage: some View {
        GeometryReader { proxy in
            // A4 = 210 × 297mm，纸面按舞台高度等比缩放，四周留 32pt
            let height = max(proxy.size.height - Tokens.Space.s6 * 2, 200)
            let width = height * 210 / 297
            ZStack {
                Tokens.Color.stage
                if let template = selected {
                    ResumePaperView(request: template.renderRequest())
                        // 纸面页按 794px（A4 在 96dpi 下的宽度）排版，这里整体缩放到舞台尺寸
                        .frame(width: 794, height: 1123)
                        .scaleEffect(width / 794)
                        .frame(width: width, height: height)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
                        .id(template.id)
                        .transition(.push(from: .trailing))
                } else if let loadError {
                    ContentUnavailableView("模板加载失败", systemImage: "exclamationmark.triangle", description: Text(loadError))
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .animation(.smooth(duration: 0.42), value: selectedID)
        }
    }

    private func load() async {
        do {
            templates = try await session.api.listResumeTemplates()
            selectedID = templates.first?.id
        } catch {
            loadError = "请稍后重试。"
        }
    }
}
