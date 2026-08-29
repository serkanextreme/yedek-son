import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Log for debugging in production
    // eslint-disable-next-line no-console
    console.error("SERTEX crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          data-testid="app-error-boundary"
          style={{
            position: "fixed",
            inset: 0,
            background: "#050914",
            color: "#FF5577",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            fontFamily: "monospace",
            padding: 20,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, letterSpacing: "0.2em" }}>SERTEX · SİSTEM HATASI</div>
          <div style={{ fontSize: 12, color: "#E2F1FF", maxWidth: 640 }}>
            Uygulamada beklenmedik bir hata oluştu. Sayfayı yenileyin (Ctrl+Shift+R).
          </div>
          <div style={{ fontSize: 11, color: "#88a", opacity: 0.8, maxWidth: 640, wordBreak: "break-word" }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              background: "transparent",
              color: "#00F0FF",
              border: "1px solid #00F0FF",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "monospace",
              letterSpacing: "0.15em",
            }}
          >
            YENİDEN BAŞLAT
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
