import LinkResumeCore
import LinkResumeRender
import SwiftUI

struct TemplatesView: View {
    let initialSelectedID: String?
    let onUseTemplate: (ResumeTemplate) -> Void
    @State private var templates: [ResumeTemplate] = []
    @State private var preview: ResumeTemplate?
    @State private var useAfterDismiss: ResumeTemplate?
    @State private var selectedStyle = "全部风格"
    @State private var loadError: String?

    private var styles: [String] { Array(Set(templates.flatMap(\.styleCategories))).sorted() }
    private var filtered: [ResumeTemplate] {
        templates.filter { selectedStyle == "全部风格" || $0.styleCategories.contains(selectedStyle) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("TEMPLATES  /  \(templates.count) 套精选示例")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Tokens.Color.textMuted)
                Text("简历模板").font(.custom("Songti SC", size: 28).weight(.semibold)).padding(.top, 8)
                Text("浏览当前可用版式，选择后填写简历名称并进入编辑器。")
                    .font(.system(size: 13)).foregroundStyle(Tokens.Color.textMuted).padding(.top, 8)
                Text("当前展示内置虚构示例，可离线预览；原生创建与编辑尚未接入。")
                    .font(.system(size: 12)).foregroundStyle(Tokens.Color.textMuted).padding(.top, 6)
                HStack {
                    Text("找到 \(filtered.count) 套模板").font(.system(size: 13))
                    Spacer()
                    Picker("筛选", selection: $selectedStyle) {
                        Text("全部风格").tag("全部风格")
                        ForEach(styles, id: \.self) { Text($0).tag($0) }
                    }.frame(width: 170)
                }.padding(.top, 28)
                Divider().padding(.top, 12)
                if let loadError { Text(loadError).foregroundStyle(.red).padding(.top, 24) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 20)], alignment: .leading, spacing: 32) {
                    ForEach(filtered) { template in
                        Button { preview = template } label: {
                            VStack(alignment: .leading, spacing: 10) {
                                TemplateThumbnail(template: template)
                                Text(template.name).font(.system(size: 13, weight: .medium)).lineLimit(2)
                                Text((template.styleCategories + template.useCases).joined(separator: " · "))
                                    .font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted).lineLimit(2)
                            }
                        }.buttonStyle(.plain).accessibilityLabel("预览模板：\(template.name)")
                    }
                }.padding(.top, 24)
            }.frame(maxWidth: 860).padding(.horizontal, 52).padding(.vertical, 52).frame(maxWidth: .infinity)
        }
        .task {
            do { templates = try GuestTemplates.load() }
            catch { loadError = "模板加载失败，请重新打开模板页。" }
        }
        .sheet(item: $preview, onDismiss: {
            if let template = useAfterDismiss {
                useAfterDismiss = nil
                onUseTemplate(template)
            }
        }) { template in
            TemplatePreview(template: template, close: { preview = nil }, use: {
                useAfterDismiss = template
                preview = nil
            }).frame(width: 960, height: 720)
        }
    }
}

private struct TemplateThumbnail: View {
    let template: ResumeTemplate
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
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            if failed { Text("预览不可用").font(.caption).padding(8).background(.white) }
        }.aspectRatio(210.0 / 297, contentMode: .fit).background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xD3D3CE)))
            .task {
                do { let result = try await GuestTemplates.prepare(template); try Task.checkCancellation(); paper = result.request }
                catch is CancellationError { }
                catch { failed = true }
            }
    }
}

private struct TemplatePreview: View {
    let template: ResumeTemplate
    let close: () -> Void
    let use: () -> Void
    @State private var paper: ResumeRenderRequest?
    @State private var height: CGFloat = 1123
    @State private var error: String?
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(template.name).font(.title3.weight(.semibold))
                Spacer()
                Button("使用此模板", action: use).buttonStyle(WebActionStyle())
                Button("关闭", action: close).buttonStyle(.plain)
            }.padding(20)
            Text("虚构示例资料 · 最终排版以 PDF 为准；字体、换行与分页可能不同。")
                .font(.system(size: 12)).foregroundStyle(Tokens.Color.textMuted).padding(.bottom, 12)
            if let error { Text(error).foregroundStyle(.red) }
            ScrollView([.vertical, .horizontal]) {
                if let paper {
                    ResumePaperView(request: paper, onRendered: { height = max(1123, $0) }, onError: { error = $0 })
                        .frame(width: 794, height: height).padding(24)
                } else { ProgressView("加载预览…").padding(40) }
            }.background(Tokens.Color.stage)
        }.task {
            do { let result = try await GuestTemplates.prepare(template); try Task.checkCancellation(); paper = result.request }
            catch is CancellationError { }
            catch { self.error = "预览加载失败，请重试。" }
        }
    }
}
