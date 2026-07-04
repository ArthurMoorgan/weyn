import { Component, type ErrorInfo, type ReactNode } from "react";

// Last-resort catch: without this, any uncaught render error white-screens
// the whole app instead of showing something a user can act on. No Sentry
// package is installed on the frontend (only server/monitoring.js has it) —
// logging to console is the honest option here rather than adding a new
// dependency for one component.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="detail">
        <div className="empty" style={{ paddingTop: 120 }}>
          <div className="ic"><i className="ti ti-alert-triangle" /></div>
          <p><b style={{ color: "var(--text)" }}>Something went wrong.</b><br />Reloading usually fixes it.</p>
          <button className="btn" style={{ maxWidth: 200, margin: "0 auto" }} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
