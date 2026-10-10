import DrawOfferCore
import SwiftUI

/// 深层页面（求职详情、复盘报告等）跳转到工作区其他栏目的入口，由 `WorkspaceView` 注入并消费。
/// `draft` 只把文字放进首页输入框，由用户确认后再发送，不替用户自动发起对话。
@MainActor @Observable
final class WorkspaceRouter {
    enum Jump: Equatable { case section(WorkspaceSection), draft(String), editResume(String) }
    private(set) var pending: Jump?

    func jump(_ target: Jump) { pending = target }
    func take() -> Jump? { defer { pending = nil }; return pending }
}
