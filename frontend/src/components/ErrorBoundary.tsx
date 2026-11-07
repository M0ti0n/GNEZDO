import { Component, type ReactNode } from "react";
import { diag } from "../job/diag";

interface Props { children: ReactNode; what: string }
interface State { error: Error | null }

// Keeps a failure in one screen from blanking the whole app: that screen shows what went wrong,
// the rest (tabs, panels, other parts) keeps working.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`GNEZDO: ${this.props.what} failed`, error);
    diag("error", `Screen failed: ${this.props.what}: ${error.message}`, { stack: error.stack?.slice(0, 3000), components: info.componentStack?.slice(0, 2000) });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>{this.props.what} could not be shown</h2>
        <p>This is a fault in GNEZDO, not in your file. Close this tab; the other parts and tabs still work.
          Please send the file so it can be fixed.</p>
        <pre>{this.state.error.message}</pre>
      </div>
    );
  }
}
