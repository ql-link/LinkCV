import AppKit
import LinkResumeCore
import SwiftUI

/// 04.C01 palette. Values come from the Web `--v3-*` tokens and the ap-/sd-/rp- page variables.
enum CareerPalette {
    static let text = Color(hex: 0x1D1D1B)
    static let sub = Color(hex: 0x55554F)
    static let faint = Color(hex: 0x96968F)
    static let hint = Color(hex: 0x8C8C85)
    static let line = Color(hex: 0xECECEA)
    static let border = Color(hex: 0xE6E6E2)
    static let control = Color(hex: 0xE4E4E0)
    static let field = Color(hex: 0xF4F4F2)
    static let soft = Color(hex: 0xFAFAF9)
    static let pipelineLine = Color(hex: 0xEDEDE9)
    static let dashed = Color(hex: 0xB3B3AD)
    static let rail = Color(hex: 0xE3E3DE)
    static let chipGray = Color(hex: 0xF0F0EC)
    static let blue = Color(hex: 0x3F6FD8)
    static let blueSoft = Color(hex: 0xEBF0FB)
    static let green = Color(hex: 0x359564)
    static let greenSoft = Color(hex: 0xEAF5EF)
    static let orange = Color(hex: 0xA96B27)
    static let orangeSoft = Color(hex: 0xFBF2E6)
    static let red = Color(hex: 0xD64545)
    static let redSoft = Color(hex: 0xFBECEC)

    static func foreground(_ tone: CareerTone) -> Color {
        switch tone {
        case .blue: return blue
        case .green: return green
        case .orange: return orange
        case .red: return red
        case .gray: return sub
        case .dark: return .white
        }
    }
    static func background(_ tone: CareerTone) -> Color {
        switch tone {
        case .blue: return blueSoft
        case .green: return greenSoft
        case .orange: return orangeSoft
        case .red: return redSoft
        case .gray: return chipGray
        case .dark: return text
        }
    }
    /// Solid colour for dots, accents and bars.
    static func solid(_ tone: CareerTone) -> Color {
        switch tone {
        case .blue: return blue
        case .green: return green
        case .orange: return orange
        case .red: return red
        case .gray: return faint
        case .dark: return text
        }
    }
}

struct CareerChipView: View {
    let chip: CareerChip
    init(_ chip: CareerChip) { self.chip = chip }
    init(_ label: String, _ tone: CareerTone) { chip = CareerChip(label, tone) }
    var body: some View {
        Text(chip.label).font(LibraryTypography.sans(11, weight: .medium)).lineLimit(1).fixedSize()
            .foregroundStyle(CareerPalette.foreground(chip.tone))
            .padding(.horizontal, 8).frame(height: 22)
            .background(CareerPalette.background(chip.tone), in: RoundedRectangle(cornerRadius: 6))
    }
}

/// `.ap-outline-button` / `.ap-primary-button` / `.ap-text-button` / link buttons.
struct CareerActionStyle: ButtonStyle {
    enum Kind { case outline, primary, text, danger, link, muted }
    var kind: Kind = .outline
    var large = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        let label = configuration.label.font(LibraryTypography.sans(large ? 13 : 12, weight: kind == .muted ? .regular : .medium)).lineLimit(1).fixedSize()
        return Group {
            switch kind {
            case .outline:
                label.foregroundStyle(CareerPalette.text).padding(.horizontal, large ? 14 : 10).frame(height: large ? 34 : 30)
                    .background(configuration.isPressed ? CareerPalette.field : .white, in: RoundedRectangle(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(CareerPalette.border))
            case .primary:
                label.foregroundStyle(.white).padding(.horizontal, large ? 14 : 10).frame(height: large ? 34 : 30)
                    .background(enabled ? (configuration.isPressed ? Color.black : CareerPalette.text) : Color(hex: 0x9E9E99), in: RoundedRectangle(cornerRadius: 8))
            case .text, .danger:
                label.foregroundStyle(kind == .danger ? CareerPalette.red : CareerPalette.sub).padding(.horizontal, 10).frame(height: 30)
                    .background(configuration.isPressed ? CareerPalette.field : .clear, in: RoundedRectangle(cornerRadius: 8))
            case .link:
                label.foregroundStyle(CareerPalette.blue)
            case .muted:
                label.foregroundStyle(configuration.isPressed ? CareerPalette.text : CareerPalette.faint)
            }
        }
        .opacity(enabled || kind == .primary ? 1 : 0.6)
        .contentShape(Rectangle())
    }
}

extension View {
    /// `.ap-side-card` / `.sd-card`: white card with a hairline border.
    func careerCard(padding: CGFloat = 18, radius: CGFloat = 14, border: Color = CareerPalette.border, lineWidth: CGFloat = 1) -> some View {
        self.padding(padding).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(border, lineWidth: lineWidth))
    }
}

/// `.ap-file-badge`: extension tag for a linked file.
struct CareerFileBadge: View {
    let name: String
    var size: CGFloat = 30
    static func badge(_ name: String) -> String {
        let parts = name.split(separator: ".")
        return parts.count > 1 ? String(parts.last!.prefix(4)).uppercased() : "DOC"
    }
    var body: some View {
        Text(Self.badge(name)).font(LibraryTypography.sans(8, weight: .medium)).foregroundStyle(CareerPalette.sub)
            .frame(width: size, height: size)
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(CareerPalette.border))
    }
}

/// Breadcrumb used by the progress, stage-detail and report pages.
struct CareerBreadcrumb: View {
    let back: String
    let current: String
    let action: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            Button(back, action: action).buttonStyle(CareerActionStyle(kind: .muted))
            Text("/").foregroundStyle(CareerPalette.faint)
            Text(current).foregroundStyle(CareerPalette.faint).lineLimit(1)
        }.font(LibraryTypography.sans(12))
    }
}

/// Label/value rows in side cards (`.ap-side-card dl`).
struct CareerInfoRows: View {
    let rows: [CareerInfoRow]
    var body: some View {
        VStack(spacing: 8) {
            ForEach(rows) { row in
                HStack(alignment: .top, spacing: 12) {
                    Text(row.label).foregroundStyle(CareerPalette.faint).fixedSize()
                    Spacer(minLength: 0)
                    Text(row.value).foregroundStyle(row.tone.map(CareerPalette.solid) ?? CareerPalette.text).lineLimit(1).truncationMode(.tail)
                }.font(LibraryTypography.sans(12))
            }
        }
    }
}

/// Dialog shell shared by the stage sheets (`.sd-dialog`): serif title, subtitle, divider footer.
struct CareerSheet<Content: View, Footer: View>: View {
    let title: String
    var subtitle: String = ""
    let width: CGFloat
    @ViewBuilder let content: () -> Content
    @ViewBuilder let footer: () -> Footer
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(LibraryTypography.serif(20))
                if !subtitle.isEmpty { Text(subtitle).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub).lineLimit(1) }
            }.padding(.horizontal, 32).padding(.top, 28).padding(.bottom, 16)
            ScrollView { VStack(alignment: .leading, spacing: 16) { content() }.padding(.horizontal, 32).padding(.bottom, 8).frame(maxWidth: .infinity, alignment: .leading) }
            Rectangle().fill(CareerPalette.line).frame(height: 1).padding(.top, 8)
            HStack(spacing: 10) { Spacer(); footer() }.padding(.horizontal, 32).padding(.vertical, 18)
        }
        .frame(width: width).foregroundStyle(CareerPalette.text).font(LibraryTypography.sans(13))
    }
}

/// `.sd-field` textarea.
struct CareerTextArea: View {
    let title: String
    @Binding var text: String
    var placeholder = ""
    var minHeight: CGFloat = 96
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !title.isEmpty { Text(title).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub) }
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text).font(LibraryTypography.sans(13)).scrollContentBackground(.hidden).padding(.horizontal, 7).padding(.vertical, 6)
                if text.isEmpty { Text(placeholder).font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.faint).padding(.horizontal, 12).padding(.vertical, 10).allowsHitTesting(false) }
            }
            .frame(minHeight: minHeight)
            .background(.white, in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(CareerPalette.control))
            .accessibilityLabel(title.isEmpty ? placeholder : title)
        }
    }
}

enum CareerErrors {
    static func message(_ error: Error) -> String {
        if error is CancellationError { return "操作已取消。" }
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。" }
        if case APIError.server(let status, let code) = error {
            if let text = CareerTranscript.importError(code) { return text }
            if code == "LLM_MODEL_NOT_CONFIGURED" { return "请先配置模拟面试的 AI 模型，再生成复盘。" }
            if status == 409 { return "内容已在其他地方更新，请刷新后重试。" }
            if status == 403 { return "当前服务尚未开放桌面端的这项操作，请更新服务端后重试。" }
            if status == 404 { return "记录不存在或已被删除。" }
            return "操作失败（\(code)），请稍后重试。"
        }
        return "连接失败，请检查网络后重试。"
    }
}
