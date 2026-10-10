import AppKit
import DrawOfferCore
import SwiftUI

struct HomeGuideContent: Decodable {
    struct Card: Decodable, Identifiable {
        let id: String
        let title: String
        let subtitle: String
        let action: String
    }
    let title: String
    let subtitle: String
    let placeholder: String
    let chips: [String]
    let cards: [Card]
    static func load() throws -> Self {
        guard let url = Bundle.module.url(forResource: "content", withExtension: "json", subdirectory: "Home") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

struct AssistantHomeView: View {
    @Environment(SessionStore.self) private var session
    let nickname: String?
    @Binding var draft: String
    let browse: () -> Void
    let requireAccount: () -> Void
    let showPlugin: () -> Void
    var navigate: (WorkspaceSection) -> Void = { _ in }
    var editResume: (String) -> Void = { _ in }
    /// 登录后发送输入：进入原生 AI 对话。
    var send: (String) -> Void = { _ in }
    @State private var dashboard = HomeDashboardModel()
    @State private var content: HomeGuideContent?
    @State private var failed = false
    @FocusState private var composerFocused: Bool

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let prefix = hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好"
        return prefix + (nickname.map { "，\($0)" } ?? "") + "。"
    }

    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var ready: HomeDashboard? { if case .ready(let value) = dashboard.state { return value }; return nil }
    private var signedInCopy: (title: String, subtitle: String, chips: [String])? { nickname == nil ? nil : ready?.copy }

    var body: some View {
        GeometryReader { viewport in
            let compact = viewport.size.height < 740
            if let content {
                VStack(spacing: 0) {
                    Text(greeting + (signedInCopy?.title ?? (nickname == nil ? content.title : "今天想推进什么？")))
                        .font(V3.serif(28)).foregroundStyle(V3.txt).multilineTextAlignment(.center)
                        .frame(minHeight: 36)
                    Text(signedInCopy?.subtitle ?? (nickname == nil ? content.subtitle : "改简历、分析 JD、准备面试，从这里开始。"))
                        .font(V3.sans(14)).foregroundStyle(V3.fnt).padding(.top, 11)
                    composer(content).padding(.top, compact ? 24 : 32)
                    HStack(spacing: 10) {
                        ForEach(signedInCopy?.chips ?? content.chips, id: \.self) { chip in
                            Button { draft = chip; composerFocused = true } label: { V3Chip(label: chip) }.buttonStyle(.plain)
                        }
                    }.padding(.top, compact ? 12 : 16)
                    if nickname != nil, let ready {
                        HStack(spacing: 19) {
                            ForEach(Array(ready.cards.enumerated()), id: \.offset) { _, card in
                                HomeCardView(card: card, compact: compact, navigate: navigate, showPlugin: showPlugin, editResume: editResume)
                            }
                        }.padding(.top, compact ? 20 : 32)
                    } else if nickname != nil, case .failed = dashboard.state {
                        HStack(spacing: 8) {
                            Text("首页进度没能加载出来。").font(V3.sans(12.5)).foregroundStyle(V3.sub)
                            Button("重新加载") { Task { await dashboard.load(api: session.api, account: account) } }.buttonStyle(.link)
                        }.padding(.top, compact ? 20 : 32)
                    } else if nickname != nil {
                        ProgressView().controlSize(.small).frame(height: compact ? 200 : 236).padding(.top, compact ? 20 : 32)
                    } else {
                    HStack(spacing: 19) {
                        ForEach(content.cards) { card in
                            Button {
                                switch card.id {
                                case "firstResume": browse()
                                case "plugin": showPlugin()
                                default: requireAccount()
                                }
                            } label: { guideCard(card, compact: compact) }.buttonStyle(.plain)
                                .accessibilityLabel(card.title)
                        }
                    }.padding(.top, compact ? 20 : 32)
                    }
                    Text(nickname == nil ? "游客引导 · 当前输入仅保留在本次会话；登录后可与 AI 对话。" : "卡片按你的简历、排期和求职进度生成，不经过 AI。")
                        .font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top, compact ? 16 : 20)
                }.frame(width: min(720, max(0, viewport.size.width - 48)))
                    .padding(.top, min(251, max(40, viewport.size.height * 0.4 - 130)))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else if failed {
                ContentUnavailableView("首页信息暂时无法读取", systemImage: "exclamationmark.triangle",
                    description: Text("请重新打开客户端。"))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }.task {
            do { content = try HomeGuideContent.load() }
            catch { failed = true }
        }
        .task(id: account) { if !account.isEmpty { await dashboard.load(api: session.api, account: account) } }
    }

    private func composer(_ content: HomeGuideContent) -> some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $draft).font(V3.sans(14)).scrollContentBackground(.hidden).scrollIndicators(.never)
                    .focused($composerFocused).accessibilityLabel("向 DrawOffer 提问")
                if draft.isEmpty {
                    Text(content.placeholder).foregroundStyle(V3.fnt).font(V3.sans(14)).padding(.leading, 5).padding(.top, 8)
                        .allowsHitTesting(false).accessibilityHidden(true)
                }
            }.frame(height: 52).padding(.horizontal, 17).padding(.top, 15)
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Button(action: requireAccount) {
                    Image(systemName: "plus").frame(width: 32, height: 32)
                        .overlay(Circle().stroke(V3.cl))
                }.buttonStyle(.plain).accessibilityLabel("添加资料")
                Spacer()
                Label(nickname == nil ? "登录后可用" : "AI 助手", systemImage: "cpu").font(V3.sans(13.5)).foregroundStyle(V3.sub)
                Button { if nickname == nil { requireAccount() } else { send(draft) } } label: {
                    Image(systemName: "arrow.up").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white).frame(width: 36, height: 36)
                        .background(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color(hex: 0xC9C9C3) : V3.txt, in: Circle())
                }.buttonStyle(.plain).disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .keyboardShortcut(.return, modifiers: .command).accessibilityLabel("发送")
            }.padding(.leading, 16).padding(.trailing, 12).padding(.bottom, 12)
        }.frame(height: 120).background(.white, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
            .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }

    private func guideCard(_ card: HomeGuideContent.Card, compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let url = Bundle.module.url(forResource: card.id, withExtension: "png", subdirectory: "Home"), let image = NSImage(contentsOf: url) {
                Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: 211).frame(height: compact ? 84 : 112).clipShape(RoundedRectangle(cornerRadius: 11)).frame(maxWidth: .infinity)
            }
            Text(nickname != nil && card.id == "firstResume" ? "准备一份简历" : card.title)
                .font(V3.sans(15, weight: .semibold)).foregroundStyle(V3.txt).lineLimit(1).padding(.horizontal, 12).padding(.top, compact ? 12 : 18)
            Text(card.subtitle).font(V3.sans(12)).foregroundStyle(V3.sub).lineLimit(1)
                .padding(.horizontal, 12).padding(.top, 6)
            Spacer(minLength: 0)
            HStack(spacing: 5) { Text(card.action); Image(systemName: "arrow.right").font(.system(size: 10)) }
                .font(V3.sans(14, weight: .medium)).foregroundStyle(V3.sub)
                .padding(.horizontal, 12).padding(.bottom, 14)
        }.padding(8).frame(maxWidth: .infinity).frame(height: compact ? 200 : 236)
            .background(.white, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
            .shadow(color: .black.opacity(0.04), radius: 8, y: 4)
    }
}
