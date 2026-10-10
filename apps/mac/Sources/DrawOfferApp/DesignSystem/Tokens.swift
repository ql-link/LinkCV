import SwiftUI

/// 设计 Token，数值取自 apps/web/src/design-system/tokens.css，名字与 `--ui-*` 对应。
/// 只映射颜色、圆角、间距这类「品牌」值；控件本身用系统原生外观，不去模仿网页控件。
enum Tokens {
    enum Color {
        static let background = SwiftUI.Color(hex: 0xFCFCFC)
        static let foreground = SwiftUI.Color(hex: 0x17191C)
        static let textMuted = SwiftUI.Color(hex: 0x6F7A8C)
        static let accent = SwiftUI.Color(hex: 0x145ED6)
        static let border = SwiftUI.Color(hex: 0xDED7CC)
        static let stage = SwiftUI.Color(hex: 0xF3F2EF)
    }

    enum Radius {
        static let sm: CGFloat = 8
        static let lg: CGFloat = 12
    }

    enum Space {
        static let s2: CGFloat = 8
        static let s4: CGFloat = 16
        static let s6: CGFloat = 32
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
