import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional label shown above the error message (e.g. which screen). */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-phase errors from descendants and displays them inline
 * instead of letting React unmount the whole tree. Without this, a single
 * bug in (say) the chart would leave the user on a blank dark screen with
 * only the generic top-level "Uncaught error / Script error" reporter to
 * tell them what happened.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
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
