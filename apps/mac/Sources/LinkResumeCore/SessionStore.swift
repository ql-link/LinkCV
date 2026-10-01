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

    public init(api: any APIClient) {
        self.api = api
    }

    public func restore() async {
        do {
            phase = try await api.currentUser().map(Phase.signedIn) ?? .signedOut
        } catch {
            phase = .signedOut
        }
    }

    public func signIn(email: String, password: String) async {
        errorMessage = nil
        do {
            phase = .signedIn(try await api.signIn(email: email, password: password))
        } catch {
            errorMessage = "登录失败，请检查邮箱和密码。"
        }
    }

    public func signOut() async {
        try? await api.signOut()
        phase = .signedOut
    }
}
