import Observation

/// 登录态。整个 App 共享一个实例，界面按 `phase` 决定显示登录页还是工作区。
@MainActor
@Observable
public final class SessionStore {
    public enum Phase: Equatable {
        case restoring
        case signedOut
        case signedIn(User)
    }

    public private(set) var phase: Phase = .restoring
    public private(set) var errorMessage: String?
    public let api: any APIClient
    private var operation = 0

    public init(api: any APIClient) {
        self.api = api
    }

    public func restore() async {
        operation += 1
        let current = operation
        errorMessage = nil
        do {
            let user = try await api.currentUser()
            guard current == operation else { return }
            phase = user.map(Phase.signedIn) ?? .signedOut
        } catch APIError.unauthorized {
            guard current == operation else { return }
            phase = .signedOut
            errorMessage = "登录已失效，请重新登录。"
        } catch {
            guard current == operation else { return }
            phase = .restoring
            errorMessage = "暂时无法恢复登录，可重试；已保留安全凭据。"
        }
    }

    public func signIn(email: String, password: String) async {
        operation += 1
        let current = operation
        errorMessage = nil
        do {
            let user = try await api.signIn(email: email, password: password)
            guard current == operation else { return }
            phase = .signedIn(user)
        } catch {
            guard current == operation else { return }
            errorMessage = "登录失败，请检查邮箱和密码。"
        }
    }

    public func signOut() async {
        operation += 1
        let current = operation
        phase = .signedOut
        errorMessage = nil
        do {
            try await api.signOut()
        } catch {
            guard current == operation else { return }
            errorMessage = "本地已退出；远端撤销或安全存储清理未确认，请重试。"
        }
    }
}
