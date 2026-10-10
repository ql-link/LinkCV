import AppKit
import Foundation
import DrawOfferCore
import SwiftUI

struct SignInView: View {
    @Environment(SessionStore.self) private var session
    @State private var challenge: DesktopLoginChallenge?
    @State private var deadline = Date.distantPast
    @State private var message: String?
    @State private var waiting = false
    @State private var loginTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: Tokens.Space.s4) {
            Text("微信扫码登录 DrawOffer").font(.custom("Songti SC", size: 20).weight(.semibold))
            if let challenge, let data = Data(base64Encoded: challenge.qrcode.qr_base64), let image = NSImage(data: data) {
                Image(nsImage: image).resizable().interpolation(.none).scaledToFit().frame(width: 240, height: 240)
            }
            Text(message ?? "请使用微信扫码，并在手机上确认登录此 Mac。")
                .font(.callout).multilineTextAlignment(.center)
            if let error = session.errorMessage { Text(error).foregroundStyle(.red) }
            if case .restoring = session.phase {
                Button("重试恢复登录") { Task { await session.restore() } }
                Button("退出已有登录后重新扫码") { Task { await session.signOut() } }
            }
            Button(challenge == nil ? "获取登录二维码" : "继续等待 / 重试领取") { start(newChallenge: false) }
                .buttonStyle(WebActionStyle()).disabled(waiting || restoring)
            Button("重新生成二维码") { start(newChallenge: true) }.disabled(waiting || restoring)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Tokens.Color.background)
        .onDisappear { loginTask?.cancel() }
    }

    private var restoring: Bool { if case .restoring = session.phase { return true }; return false }

    private func start(newChallenge: Bool) {
        guard let api = session.api as? HTTPAPIClient else { return }
        loginTask?.cancel()
        waiting = true
        message = "正在连接…"
        loginTask = Task { @MainActor in
            defer { waiting = false }
            do {
                if newChallenge || challenge == nil || deadline <= Date() {
                    challenge = nil
                    guard try await api.capabilities().wechat_login_enabled else {
                        message = "当前服务尚未开放桌面微信登录。"
                        return
                    }
                    let created = try await api.beginLogin(clientVersion: "0.1.0")
                    try Task.checkCancellation()
                    challenge = created
                    deadline = Date().addingTimeInterval(TimeInterval(created.qrcode.expires_in))
                }
                guard let current = challenge else { return }
                while Date() < deadline {
                    try Task.checkCancellation()
                    let status = try await api.loginStatus(current)
                    if status == "confirmed" || status == "consumed" {
                        try await session.completeDesktopLogin(current)
                        return
                    }
                    if status == "cancelled" || status == "expired" {
                        challenge = nil
                        message = status == "cancelled" ? "手机已取消登录。" : "二维码已过期，请重新获取。"
                        return
                    }
                    message = "请在微信中扫码并确认登录。"
                    try await Task.sleep(for: .seconds(max(1, min(current.qrcode.poll_interval_seconds, 10))))
                }
                challenge = nil
                message = "二维码已过期，请重新获取。"
            } catch is CancellationError { }
            catch APIError.server(status: 404, code: _) where challenge == nil {
                message = "当前服务尚未部署桌面微信登录接口，请联系管理员更新服务后重试。"
            }
            catch {
                message = "登录未完成。请检查网络或安全存储权限后重试；重试将沿用本次领取请求。"
            }
        }
    }
}
