import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://127.0.0.1:8000";

export default function App() {
  const [apiOnline, setApiOnline] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function checkBackend() {
      try {
        const response = await fetch(`${API_URL}/health`);
        if (!response.ok) throw new Error("Backend unavailable");

        const data = await response.json();
        if (!cancelled) setApiOnline(data.status === "ok");
      } catch {
        if (!cancelled) setApiOnline(false);
      }
    }

    checkBackend();
    const timer = setInterval(checkBackend, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">Q</span>
          <span>QueuePulse</span>
        </a>

        <div className={`connection ${apiOnline ? "is-online" : ""}`}>
          <span className="connection-dot" />
          {apiOnline === null
            ? "Checking backend"
            : apiOnline
              ? "Backend online"
              : "Backend offline"}
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SMARTER SERVICE STARTS HERE</p>
          <h1>
            Less waiting.
            <br />
            <span>Better service.</span>
          </h1>
          <p className="hero-description">
            QueuePulse helps customers track their place and helps service
            teams keep queues moving.
          </p>

          <div className="feature-list">
            <span>Digital queue tokens</span>
            <span>Live queue updates</span>
            <span>Smarter counter use</span>
          </div>
        </div>

        <div className="queue-preview" aria-label="QueuePulse preview">
          <div className="preview-heading">
            <span>QUEUE STATUS</span>
            <span className="live-label">
              <i /> LIVE
            </span>
          </div>

          <div className="preview-ticket">
            <small>YOUR PLACE</small>
            <strong>A024</strong>
            <div className="preview-divider" />
            <div className="preview-row">
              <span>People ahead</span>
              <b>3</b>
            </div>
            <div className="preview-row">
              <span>Estimated wait</span>
              <b>8 min</b>
            </div>
          </div>

          <p className="preview-note">A clearer queue, from start to service.</p>
        </div>
      </section>

      <footer className="footer">
        <span>QUEUEPULSE</span>
        <span>Smarter service, less waiting.</span>
      </footer>
    </main>
  );
}