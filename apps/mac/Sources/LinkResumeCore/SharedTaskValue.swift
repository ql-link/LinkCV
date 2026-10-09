private actor SharedTaskWaiter<Value: Sendable> {
    private var result: Result<Value, any Error>?
    private var continuation: CheckedContinuation<Value, any Error>?

    func wait() async throws -> Value {
        try await withCheckedThrowingContinuation { continuation in
            if let result { continuation.resume(with: result) }
            else { self.continuation = continuation }
        }
    }

    func finish(_ result: Result<Value, any Error>) {
        guard self.result == nil else { return }
        self.result = result
        continuation?.resume(with: result)
        continuation = nil
    }
}

/// Cancel only this waiter; the shared exchange/refresh still belongs to the coordinator.
func sharedTaskValue<Value: Sendable>(_ task: Task<Value, any Error>) async throws -> Value {
    let waiter = SharedTaskWaiter<Value>()
    return try await withTaskCancellationHandler {
        Task {
            do { await waiter.finish(.success(try await task.value)) }
            catch { await waiter.finish(.failure(error)) }
        }
        return try await waiter.wait()
    } onCancel: {
        Task { await waiter.finish(.failure(CancellationError())) }
    }
}
