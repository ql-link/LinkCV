import SwiftUI

/// Web `v3/v3.css` page tokens and base controls shared by the board, schedule, library and mock pages.
enum V3 {
    static let txt = Color(hex: 0x1D1D1B)
    static let sub = Color(hex: 0x55554F)
    static let fnt = Color(hex: 0x6C6C65)
    static let fnt2 = Color(hex: 0xC4C4BE)
    static let line = Color(hex: 0xECECEA)
    static let cl = Color(hex: 0xE4E4E0)
    static let field = Color(hex: 0xF4F4F2)
    static let hl = Color(hex: 0xE6E6E2)
    static let stage = Color(hex: 0xF4F4F1)
    static let column = Color(hex: 0xF7F7F5)
    static let sk2 = Color(hex: 0xDCDCD8)
    static let blue = Color(hex: 0x3F6FD8)
    static let blueSoft = Color(hex: 0xEAF0FB)
    static let orange = Color(hex: 0xD9822B)
    static let orangeSoft = Color(hex: 0xFBF1E6)
    static let green = Color(hex: 0x3B9A5B)
    static let greenSoft = Color(hex: 0xEEF6F0)
    static let red = Color(hex: 0xD64545)
    static let redSoft = Color(hex: 0xFBF2F2)
    static let purple = Color(hex: 0x8A5CC7)
    static let purpleSoft = Color(hex: 0xF3EEFA)

    static func sans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font { LibraryTypography.sans(size, weight: weight) }
    static func serif(_ size: CGFloat) -> Font { LibraryTypography.serif(size) }
    static func number(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font { .system(size: size, weight: weight, design: .default).monospacedDigit() }
}

/// `.career-v3-head`: eyebrow, serif page title, subtitle and right-aligned actions (31px from the top).
struct V3PageHead<Actions: View>: View {
    let eyebrow: [String]
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 0) {
                Text(eyebrow.joined(separator: " · ")).font(V3.sans(12, weight: .medium)).foregroundStyle(V3.fnt).frame(height: 18)
                Text(title).font(V3.serif(28)).foregroundStyle(V3.txt).frame(height: 36).padding(.top, 8)
                if let subtitle { Text(subtitle).font(V3.sans(14)).foregroundStyle(V3.sub).lineLimit(1).padding(.top, 6) }
            }
            Spacer(minLength: 0)
            HStack(spacing: 10) { actions() }.padding(.top, 31)
        }
    }
}

/// `.v3-btn`: pill buttons. Dark is the single primary action on a page.
struct V3ButtonStyle: ButtonStyle {
    enum Kind { case dark, ghost, text, danger }
    var kind: Kind = .ghost
    var height: CGFloat = 32
    var width: CGFloat? = nil
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        return HStack(spacing: 6) { configuration.label }
            .font(V3.sans(kind == .text ? 13 : 14, weight: .medium)).lineLimit(1).fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(kind == .dark || kind == .danger ? Color.white : kind == .text ? (pressed ? V3.txt : V3.sub) : V3.txt)
            .padding(.horizontal, kind == .text ? 0 : height >= 36 ? 18 : 14)
            .frame(width: width, height: kind == .text ? nil : height)
            .background {
                switch kind {
                case .dark: Capsule().fill(pressed ? Color(hex: 0x0E0E0D) : V3.txt)
                case .danger: Capsule().fill(pressed ? Color(hex: 0xC33B3B) : V3.red)
                case .ghost: Capsule().fill(pressed ? V3.field : .white).overlay(Capsule().stroke(V3.cl))
                case .text: Color.clear
                }
            }
            .opacity(enabled ? 1 : 0.38)
            .contentShape(Capsule())
    }
}

/// Full-width 44pt dark submit (`.mi-new-submit`).
struct V3PrimaryBlockStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(V3.sans(13.5, weight: .medium)).foregroundStyle(.white)
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(configuration.isPressed ? Color(hex: 0x0E0E0D) : V3.txt, in: Capsule())
            .opacity(enabled ? 1 : 0.45).contentShape(Capsule())
    }
}

/// `.v3-search`.
struct V3SearchField: View {
    @Binding var text: String
    var placeholder: String
    var width: CGFloat? = 180
    var height: CGFloat = 32
    @FocusState private var focused: Bool
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(V3.fnt)
            TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(V3.fnt)).textFieldStyle(.plain)
                .font(V3.sans(14)).foregroundStyle(V3.txt).focused($focused)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 11)).foregroundStyle(V3.fnt2) }
                    .buttonStyle(.plain).accessibilityLabel("清除搜索")
            }
        }
        .padding(.horizontal, 10).frame(width: width, height: height)
        .background(focused ? Color.white : V3.field, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(focused ? V3.sk2 : .clear))
    }
}

/// `.v3-seg`: grey track with a white pressed segment.
struct V3Segmented<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value
    var segmentWidth: CGFloat? = nil
    var height: CGFloat = 30
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let chosen = option.0 == selection
                Button { selection = option.0 } label: {
                    Text(option.1).font(V3.sans(14, weight: .medium)).foregroundStyle(chosen ? V3.txt : V3.sub)
                        .padding(.horizontal, segmentWidth == nil ? 12 : 0)
                        .frame(width: segmentWidth, height: height - 6)
                        .background {
                            if chosen { RoundedRectangle(cornerRadius: 6).fill(.white).shadow(color: .black.opacity(0.08), radius: 1.5, y: 1) }
                        }.contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityAddTraits(chosen ? .isSelected : [])
            }
        }
        .padding(3).frame(height: height).background(V3.field, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// `.v3-chip`.
struct V3Chip: View {
    let label: String
    var foreground: Color = V3.sub
    var background: Color = V3.field
    var height: CGFloat = 22
    var size: CGFloat = 12
    var body: some View {
        Text(label).font(V3.sans(size, weight: .medium)).lineLimit(1).fixedSize()
            .foregroundStyle(foreground).padding(.horizontal, 7).frame(height: height)
            .background(background, in: RoundedRectangle(cornerRadius: 5))
    }
}

/// `.v3-stage.has-dots`: the dotted art stage used by empty states and dialogs.
struct V3DotStage<Content: View>: View {
    /// `nil` fills the proposed height.
    var height: CGFloat? = 200
    @ViewBuilder var content: () -> Content
    var body: some View {
        ZStack {
            Canvas { context, size in
                for x in stride(from: 5.0, through: size.width, by: 14) {
                    for y in stride(from: 5.0, through: size.height, by: 14) {
                        context.fill(Path(ellipseIn: CGRect(x: x - 0.9, y: y - 0.9, width: 1.8, height: 1.8)), with: .color(Color(hex: 0xD6D6D1)))
                    }
                }
            }
            content()
        }
        .frame(maxWidth: .infinity).frame(height: height)
        .background(V3.stage).clipShape(RoundedRectangle(cornerRadius: 11))
    }
}

/// `.v3-empty`: a 520pt card with art, a serif heading, body copy and actions.
struct V3EmptyCard<Art: View, Actions: View>: View {
    let title: String
    let message: String
    var stageHeight: CGFloat = 200
    @ViewBuilder var art: () -> Art
    @ViewBuilder var actions: () -> Actions
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            V3DotStage(height: stageHeight, content: art)
            Text(title).font(V3.serif(18)).foregroundStyle(V3.txt).padding(.horizontal, 24).padding(.top, 22)
            Text(message).font(V3.sans(13)).foregroundStyle(V3.sub).lineSpacing(6).fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 24).padding(.top, 10)
            HStack(spacing: 20) { actions() }.padding(.horizontal, 24).padding(.top, 26)
        }
        .padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 30)
        .frame(maxWidth: 520)
        .background(.white, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
        .shadow(color: .black.opacity(0.04), radius: 8, y: 2)
    }
}

/// `.v3-menu`-style popover row with an optional check mark.
struct V3MenuRow: View {
    let label: String
    var systemImage: String? = nil
    var checked = false
    var danger = false
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 13)).frame(width: 15) }
                Text(label).font(V3.sans(12.5))
                Spacer(minLength: 0)
                if checked { Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)) }
            }
            .foregroundStyle(danger ? V3.red : V3.txt)
            .padding(.horizontal, 10).frame(height: 34)
            .background(hover ? (danger ? V3.redSoft : V3.field) : .clear, in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }.buttonStyle(.plain).onHover { hover = $0 }
    }
}
