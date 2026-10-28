import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./ErrorState";

type Props = { children: ReactNode };
type State = { failed: boolean };

/** Last line of defence around the whole app (route errors are handled by RouteErrorPage). */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error("[app] render error", error, info.componentStack);
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex min-h-svh items-center justify-center p-4">
          <ErrorState
            title="Something went wrong"
            message="Reload the page to try again. Your gifts are safe."
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
