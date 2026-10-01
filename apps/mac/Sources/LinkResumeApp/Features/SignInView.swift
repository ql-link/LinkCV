import LinkResumeCore
import SwiftUI

/// 登录页。目前走 mock：任意邮箱和密码即可进入。
/// 需后端：desktop 渠道就绪后，这里换成微信扫码（复用 /api/auth/wechat/qrcode 流程）+ Dev 环境密码登录。
struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @State private var email = "v3-preview@example.com"
    @State private var password = ""
    @State private var submitting = false

    var body: some View {
        VStack(spacing: Tokens.Space.s4) {
            Text("登录 LinkResume").font(.title2.weight(.semibold))
            Form {
                TextField("邮箱", text: $email).textContentType(.username)
                SecureField("密码", text: $password).textContentType(.password)
            }
            .formStyle(.grouped)
            .frame(width: 360)
            if let message = session.errorMessage {
                Text(message).foregroundStyle(.red).font(.callout)
            }
            Button {
                submitting = true
                Task {
                    await session.signIn(email: email, password: password)
                    submitting = false
                }
            } label: {
                Text(submitting ? "正在登录…" : "登录").frame(width: 120)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(submitting || email.isEmpty || password.isEmpty)
            Text("当前为本地演示数据，登录不会连接服务器").font(.footnote).foregroundStyle(Tokens.Color.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tokens.Color.background)
    }
}
