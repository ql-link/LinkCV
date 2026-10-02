import Darwin
import Foundation

/// The App owns this lease for its lifetime. Core actors only coordinate within one process.
public final class DesktopInstanceLease: Sendable {
    private let descriptor: Int32

    public init(fileURL: URL) throws {
        descriptor = open(fileURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw APIError.server(status: 503, code: "INSTANCE_LOCK_UNAVAILABLE") }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            close(descriptor)
            throw APIError.server(status: 409, code: "DESKTOP_ALREADY_RUNNING")
        }
    }

    deinit {
        _ = flock(descriptor, LOCK_UN)
        close(descriptor)
    }
}
