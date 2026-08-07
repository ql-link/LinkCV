import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { api } from "../../api/client";

type ClientEventType =
  | "unhandled_error"
  | "unhandled_rejection"
  | "render_error";

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(typeof value === "string" ? value : "Unknown browser error");
}

function report(type: ClientEventType, value: unknown, componentStack?: string): void {
  const error = asError(value);
  const stack = [error.stack, componentStack].filter(Boolean).join("\n");
  void api
    .reportClientEvent({
      eventType: type,
      errorName: error.name.slice(0, 128) || "Error",
      message: error.message.slice(0, 16_384) || "Unknown browser error",
      stack: stack.slice(0, 32_768) || null,
    })
    .catch(() => undefined);
}

function BrowserErrorListeners() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      report("unhandled_error", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      report("unhandled_rejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

class RenderErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    report("render_error", error, info.componentStack ?? undefined);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error" role="alert">
          <h1>页面暂时无法显示</h1>
          <p>错误已经记录，请刷新页面后重试。</p>
          <button type="button" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ObservabilityBoundary({ children }: { children: ReactNode }) {
  return (
    <RenderErrorBoundary>
      <BrowserErrorListeners />
      {children}
    </RenderErrorBoundary>
  );
}
