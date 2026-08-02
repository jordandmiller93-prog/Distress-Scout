import React from 'react';

// A single unexpected data shape or render error anywhere in the tree used to
// blank the entire app to a white screen with no way back. This catches it,
// shows a real recovery option, and reports it to the console for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Distress Scout crashed:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.href = '/';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#000', color: '#eafff1', fontFamily: 'ui-monospace, monospace', padding: 24
      }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12, color: '#00ff6a' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#9fc4ab', marginBottom: 20 }}>
            An unexpected error occurred. Your data is safe — this is a display issue only.
          </p>
          <button
            onClick={this.handleReload}
            style={{
              background: '#00ff6a', color: '#001a0c', fontWeight: 700, padding: '10px 24px',
              borderRadius: 8, border: 'none', cursor: 'pointer'
            }}
          >
            Reload Distress Scout
          </button>
        </div>
      </div>
    );
  }
}
