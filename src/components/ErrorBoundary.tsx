import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;

  label?: string;
}

interface State {
  error: Error | null;
}

// React error boundary that catches render-time exceptions in its subtree
// and shows an inline error card (with the error message + stack) instead
// of unmounting the whole app. Wrapped per-screen so one screen's crash
// doesn't take down navigation. The Dismiss button re-renders the
// children, useful if the underlying state was already corrected.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {

    console.error('[ErrorBoundary]', this.props.label ?? '', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="screen">
        <div
          className="card"
          style={{
            padding: 16,
            borderColor: 'var(--danger)',
            color: 'var(--danger)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {this.props.label ? `${this.props.label} crashed` : 'Something crashed'}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'var(--text)',
            }}
          >
            {error.message || String(error)}
            {error.stack ? `\n\n${error.stack}` : ''}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={this.reset}
            style={{ marginTop: 12 }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
}
