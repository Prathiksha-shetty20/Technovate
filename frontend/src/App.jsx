import { useEffect, useState } from "react";

const API = "http://127.0.0.1:8000";

const AREAS = [
  { apiName: "General", title: "General", detail: "Everyday enquiries", icon: "◉", color: "#3566d4" },
  { apiName: "Account Services", title: "Accounts", detail: "Accounts and payments", icon: "▤", color: "#8858c7" },
  { apiName: "Customer Support", title: "Support", detail: "Customer help and issues", icon: "✳", color: "#138365" },
];

const STAFF_ACCOUNTS = [
  { label: "Demo staff", email: "staff@queuepulse.demo" },
  { label: "Demo accounts staff", email: "accounts1@queuepulse.demo" },
  { label: "Demo support staff", email: "support@queuepulse.demo" },
];

const NAV_ITEMS = [
  { id: "work", label: "My Work", icon: "▤" },
  { id: "busyness", label: "Busyness", icon: "⌁" },
  { id: "history", label: "Completed History", icon: "◷" },
];

export default function App() {
  const [auth, setAuth] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("queuepulse-auth"));
    } catch {
      return null;
    }
  });
  const [roleChoice, setRoleChoice] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [selectedService, setSelectedService] = useState("");
  const [activeTab, setActiveTab] = useState("work");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [customerService, setCustomerService] = useState("General");
  const [customerTokens, setCustomerTokens] = useState(() => {
    try {
      const savedAuth = JSON.parse(localStorage.getItem("queuepulse-auth"));
      const savedEmail = savedAuth?.user?.email?.toLowerCase();
      return savedEmail ? JSON.parse(localStorage.getItem(`queuepulse-customer-tokens:${savedEmail}`) || "[]") : [];
    } catch { return []; }
  });
  const [staffQueue, setStaffQueue] = useState([]);
  const [completedHistory, setCompletedHistory] = useState([]);
  const [serviceCounters, setServiceCounters] = useState(null);
  const [overview, setOverview] = useState([]);
  const [insight, setInsight] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [extraCounters, setExtraCounters] = useState(1);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [breakBusyCounter, setBreakBusyCounter] = useState("");

  const headers = auth ? { Authorization: `Bearer ${auth.token}` } : {};
  const isStaff = auth?.user?.role === "staff";
  const customerTokenStorageKey = auth?.user?.email ? `queuepulse-customer-tokens:${auth.user.email.toLowerCase()}` : "";
  const customerTokenIdsKey = customerTokens.map((token) => token.id).join(",");
  const activeCustomerTokens = customerTokens.filter((token) => ["checking", "waiting", "called", "in_service"].includes(String(token.status || "checking").toLowerCase()));
  const selectedServiceToken = activeCustomerTokens.find((token) => token.service === customerService);
  const selectedArea = AREAS.find((area) => area.apiName === selectedService);
  const waiting = staffQueue.filter((item) => item.status === "waiting");
  const inService = staffQueue.filter((item) => item.status === "called");
  const freeCounters = serviceCounters?.available ?? 0;
  const canCallNext = waiting.length > 0 && freeCounters > 0;

  useEffect(() => {
    if (!isStaff) return;

    if (selectedService) {
      loadServiceData(selectedService);
      const timer = setInterval(() => loadServiceData(selectedService), 3000);
      return () => clearInterval(timer);
    }

    loadOverview();
    const timer = setInterval(loadOverview, 5000);
    return () => clearInterval(timer);
  }, [auth, selectedService]);

  useEffect(() => {
    if (!auth || auth.user.role !== "customer" || !customerTokenStorageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(customerTokenStorageKey) || "[]");
      setCustomerTokens(Array.isArray(saved) ? saved : []);
    } catch { setCustomerTokens([]); }
  }, [auth?.user?.email, auth?.user?.role]);

  useEffect(() => {
    if (!auth || auth.user.role !== "customer" || !customerTokenIdsKey) return;
    const tokenIds = customerTokenIdsKey.split(",");
    async function refreshCustomerTokens() {
      try {
        const updated = await Promise.all(tokenIds.map(async (id) => {
          const response = await fetch(`${API}/tokens/${id}/status`, { headers });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || "Could not refresh token status");
          return data;
        }));
        setCustomerTokens((current) => {
          const byId = new Map(updated.map((token) => [String(token.id), token]));
          return current.map((token) => byId.get(String(token.id)) || token);
        });
        setError("");
      } catch (err) { setError(err.message || "Could not refresh your token status."); }
    }
    refreshCustomerTokens();
    const timer = setInterval(refreshCustomerTokens, 3000);
    return () => clearInterval(timer);
  }, [auth, customerTokenIdsKey]);

  async function loadOverview() {
    try {
      const counterResponse = await fetch(`${API}/counters/all`, { headers });
      const allCounters = await counterResponse.json();
      if (!counterResponse.ok) {
        throw new Error(allCounters.detail || "Could not load counter data");
      }

      const serviceData = await Promise.all(
        AREAS.map(async (area) => {
          const query = `service=${encodeURIComponent(area.apiName)}`;
          const [queueResponse, analyticsResponse] = await Promise.all([
            fetch(`${API}/tokens?${query}`, { headers }),
            fetch(`${API}/analytics/summary?${query}`, { headers }),
          ]);

          const queue = await queueResponse.json();
          const analyticsResult = await analyticsResponse.json();

          if (!queueResponse.ok) {
            throw new Error(queue.detail || `Could not load ${area.title} queue`);
          }
          if (!analyticsResponse.ok) {
            throw new Error(analyticsResult.detail || `Could not load ${area.title} analytics`);
          }

          const counters = allCounters.find((item) => item.service === area.apiName);
          return {
            ...area,
            capacity: counters?.capacity ?? 0,
            busyCount: counters?.busy ?? 0,
            onBreakCount: counters?.on_break ?? 0,
            freeCount: counters?.available ?? 0,
            waitingCount: queue.filter((item) => item.status === "waiting").length,
            servingCount: queue.filter((item) => item.status === "called").length,
            analytics: analyticsResult,
          };
        })
      );

      setOverview(serviceData);
      setError("");
    } catch (err) {
      setError(err.message || "Could not connect to QueuePulse.");
    }
  }

  async function loadServiceData(serviceName) {
    try {
      const query = `service=${encodeURIComponent(serviceName)}`;
      const [queueResponse, countersResponse, insightResponse, analyticsResponse, historyResponse] =
        await Promise.all([
          fetch(`${API}/tokens?${query}`, { headers }),
          fetch(`${API}/counters?${query}`, { headers }),
          fetch(`${API}/analytics/bottlenecks?${query}`, { headers }),
          fetch(`${API}/analytics/summary?${query}`, { headers }),
          fetch(`${API}/tokens/completed?${query}`, { headers }),
        ]);

      const queue = await queueResponse.json();
      const counters = await countersResponse.json();
      const insights = await insightResponse.json();
      const summary = await analyticsResponse.json();
      const history = await historyResponse.json();

      if (!queueResponse.ok) throw new Error(queue.detail || "Could not load the live queue");
      if (!countersResponse.ok) throw new Error(counters.detail || "Could not load counter status");
      if (!insightResponse.ok) throw new Error(insights.detail || "Could not load bottleneck insights");
      if (!analyticsResponse.ok) throw new Error(summary.detail || "Could not load analytics");
      if (!historyResponse.ok) throw new Error(history.detail || "Could not load completed history");

      setStaffQueue(queue);
      setServiceCounters(counters);
      setInsight(insights[0] || null);
      setAnalytics(summary);
      setCompletedHistory(history);
      setError("");
    } catch (err) {
      setError(err.message || "Could not load this service workspace.");
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const registering = roleChoice === "customer" && authMode === "register";
    const endpoint = registering ? "/auth/register" : "/auth/login";
    const body = registering ? { name, email, password } : { email, password };

    try {
      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || "Sign-in failed");
      if (result.user.role !== roleChoice) {
        throw new Error(`This account is registered as ${result.user.role}. Choose that option to sign in.`);
      }

      setAuth(result);
      localStorage.setItem("queuepulse-auth", JSON.stringify(result));
      setPassword("");
      setError("");
    } catch (err) {
      setError(err.message || "Could not connect to QueuePulse.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await fetch(`${API}/auth/logout`, { method: "POST", headers });
    } catch {
      // Clear local sign-in state even when the backend is unavailable.
    }

    localStorage.removeItem("queuepulse-auth");
    setAuth(null);
    setRoleChoice("");
    setHasStarted(false);
    setSelectedService("");
    setActiveTab("work");
    setCustomerTokens([]);
    setStaffQueue([]);
    setCompletedHistory([]);
    setOverview([]);
    setServiceCounters(null);
    setAnalytics(null);
    setError("");
    setNotice("");
  }

  async function joinQueue(event) {
    event.preventDefault();
    if (selectedServiceToken) {
      setError(`You already have an active ${selectedServiceToken.service} token (${selectedServiceToken.token}).`);
      return;
    }
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API}/tokens`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ service: customerService }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || "Could not create token");
      setCustomerTokens((current) => {
        const next = [...current.filter((token) => token.service !== result.service), result];
        localStorage.setItem(customerTokenStorageKey, JSON.stringify(next.map(({ id, service, token, status }) => ({ id, service, token, status }))));
        return next;
      });
    } catch (err) {
      setError(err.message || "Could not connect to QueuePulse.");
    } finally {
      setBusy(false);
    }
  }

  async function callNext() {
    if (!canCallNext || actionBusy) return;

    setActionBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${API}/tokens/call-next?service=${encodeURIComponent(selectedService)}`,
        { method: "POST", headers }
      );
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || "Could not call the next customer");
      setNotice(`${result.token} called to ${result.counter}.`);
      await loadServiceData(selectedService);
      await loadOverview();
    } catch (err) {
      setError(err.message || "Could not call the next customer.");
      await loadServiceData(selectedService);
    } finally {
      setActionBusy(false);
    }
  }


  async function requestCounterBreak(counterName) {
    setBreakBusyCounter(counterName);
    setError("");
    setNotice("");
    try {
      const query = `service=${encodeURIComponent(selectedService)}`;
      const response = await fetch(`${API}/counters/${encodeURIComponent(counterName)}/break?${query}`, { method: "POST", headers });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not request a counter break");
      setNotice(result.next_token
        ? `Break scheduled for ${counterName}. ${result.next_token.token} is serving there; two more customers will be served before the break.`
        : `Break scheduled for ${counterName} after two more customers.`);
      await loadServiceData(selectedService);
      await loadOverview();
    } catch (err) {
      setError(err.message || "Could not request a break.");
    } finally {
      setBreakBusyCounter("");
    }
  }

  async function resumeCounter(counterName) {
    setBreakBusyCounter(counterName);
    setError("");
    setNotice("");
    try {
      const query = `service=${encodeURIComponent(selectedService)}`;
      const response = await fetch(`${API}/counters/${encodeURIComponent(counterName)}/resume?${query}`, { method: "POST", headers });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not return this counter to service");
      setNotice(`${counterName} is available for customers again.`);
      await loadServiceData(selectedService);
      await loadOverview();
    } catch (err) {
      setError(err.message || "Could not resume this counter.");
    } finally {
      setBreakBusyCounter("");
    }
  }

  async function completeService(tokenId, tokenLabel) {
    setActionBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${API}/tokens/${tokenId}/complete`, {
        method: "POST",
        headers,
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.detail || "Could not complete service");

      setNotice(
        result.counter_on_break
          ? `${tokenLabel} completed. ${result.counter} is now on break.`
          : result.next_token
            ? `${tokenLabel} completed. ${result.next_token.token} called to ${result.next_token.counter}.`
            : `${tokenLabel} completed. ${result.counter} is available again.`
      );

      await loadServiceData(selectedService);
      await loadOverview();
    } catch (err) {
      setError(err.message || "Could not complete service.");
    } finally {
      setActionBusy(false);
    }
  }

  if (!auth && !roleChoice && !hasStarted) {
    return (
      <Page>
        <Header />
        <section style={STYLES.welcomeOuter}>
          <div className="qp-welcome-visual" style={STYLES.welcomeVisual}>
            <div style={STYLES.welcomeCopy}>
              <div style={STYLES.welcomeEyebrow}><span style={STYLES.liveDot} /> SMARTER SERVICE STARTS HERE</div>
              <h1 style={STYLES.welcomeTitle}>Your time matters.<br /><span>Waiting shouldn’t.</span></h1>
              <p style={STYLES.welcomeDescription}>Join the right queue, follow your place in real time, and make every visit feel simpler.</p>
              <button style={STYLES.welcomeCta} onClick={() => setHasStarted(true)}>
                Get started <span>→</span>
              </button>
              <div style={STYLES.welcomePerks}>
                <span><b>01</b> Join digitally</span>
                <span><b>02</b> Track your place</span>
                <span><b>03</b> Serve efficiently</span>
              </div>
            </div>
            <div className="qp-welcome-art" style={STYLES.welcomeArt} aria-hidden="true">
              <div style={STYLES.artGlow} />
              <div style={STYLES.artCardBack}><span style={{ fontSize: 9, fontWeight: 850, letterSpacing: 1.4 }}>LIVE QUEUE</span><i style={{ height: 7, borderRadius: 9, background: "rgba(255,255,255,.48)" }} /><i style={{ height: 7, width: "72%", borderRadius: 9, background: "rgba(255,255,255,.3)" }} /><i style={{ height: 7, width: "84%", borderRadius: 9, background: "rgba(255,255,255,.3)" }} /></div>
              <div style={STYLES.artTicket}><small style={{ color: "#71819a", fontSize: 9, fontWeight: 850, letterSpacing: 1.5 }}>YOUR PLACE</small><strong style={{ color: "#2449a8", fontSize: 54, lineHeight: 1, letterSpacing: "-2px" }}>A024</strong><span style={{ display: "flex", alignItems: "center", gap: 7, color: "#667791", fontSize: 11 }}><i style={{ width: 7, height: 7, borderRadius: "50%", background: "#1b9a72" }} /> Est. wait <b style={{ marginLeft: "auto", color: "#233854" }}>8 min</b></span></div>
              <div style={STYLES.artOrbit}><span>Q</span></div>
              <div style={STYLES.artSpark}>✦</div>
            </div>
          </div>
          <div style={STYLES.welcomeFootnote}><span>QUEUEPULSE</span><span>Less waiting. Better service.</span></div>
        </section>
        <Footer />
      </Page>
    );
  }

  if (!auth && !roleChoice && hasStarted) {
    return (
      <Page>
        <Header />
        <section style={STYLES.center}>
          <button style={STYLES.back} onClick={() => setHasStarted(false)}>← Back to welcome</button>
          <div style={STYLES.eyebrow}>LET’S GET YOU STARTED</div>
          <h1 style={STYLES.title}>Choose your experience</h1>
          <p style={STYLES.muted}>Select how you’ll use QueuePulse today.</p>
          <div style={STYLES.roleGrid}>
            <button style={STYLES.roleCard} onClick={() => setRoleChoice("customer")}>
              <span style={STYLES.roleIcon}>♙</span>
              <strong>I'm a customer</strong>
              <small>Join a queue and track your token.</small>
              <b style={STYLES.link}>Continue as customer →</b>
            </button>
            <button style={STYLES.roleCard} onClick={() => setRoleChoice("staff")}>
              <span style={STYLES.roleIcon}>▦</span>
              <strong>I'm staff</strong>
              <small>Open and manage a service area.</small>
              <b style={STYLES.link}>Continue as staff →</b>
            </button>
          </div>
        </section>
        <Footer />
      </Page>
    );
  }

  if (!auth) {
    const isCustomer = roleChoice === "customer";

    return (
      <Page>
        <Header />
        <section className="qp-auth-layout" style={STYLES.authWrap}>
          <button style={{ ...STYLES.back, gridColumn: "1 / -1" }} onClick={() => { setRoleChoice(""); setError(""); }}>
            ← Change role
          </button>

          <aside style={STYLES.authAside}>
            <div style={STYLES.authAsideGlow} />
            <div style={STYLES.authAsideBadge}><span style={STYLES.liveDot} /> QUEUEPULSE ACCESS</div>
            <h2 style={STYLES.authAsideTitle}>{isCustomer ? "Your visit, without the guesswork." : "A smoother day starts here."}</h2>
            <p style={STYLES.authAsideCopy}>{isCustomer ? "Keep your place, follow live updates, and spend less time waiting." : "Manage live queues, balance counters, and spot delays as they happen."}</p>
            <div style={STYLES.authAsideFlow}><span>JOIN</span><i /><span>TRACK</span><i /><span>SERVE</span></div>
            <div style={STYLES.authAsideBottom}><span style={STYLES.authAsideIcon}>Q</span><span>SMARTER SERVICE<br /><b>LESS WAITING</b></span></div>
          </aside>

          <div style={STYLES.card}>
            <div style={STYLES.eyebrow}>{isCustomer ? "CUSTOMER" : "STAFF"} SIGN IN</div>
            <h1 style={STYLES.cardTitle}>
              {isCustomer && authMode === "register"
                ? "Create your account"
                : `Welcome, ${isCustomer ? "customer" : "staff"}`}
            </h1>
            <p style={STYLES.muted}>
              {isCustomer
                ? "Sign in or create an account to join a queue."
                : "Sign in, then choose a service area."}
            </p>

            <form onSubmit={submitAuth}>
              {isCustomer && authMode === "register" && (
                <>
                  <label style={STYLES.label} htmlFor="name">Your name</label>
                  <input
                    id="name"
                    style={STYLES.input}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex Morgan"
                    required
                  />
                </>
              )}

              <label style={STYLES.label} htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                style={STYLES.input}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />

              <label style={STYLES.label} htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                style={STYLES.input}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
                required
              />

              <button style={STYLES.primary} disabled={busy}>
                {busy
                  ? "Please wait…"
                  : isCustomer && authMode === "register"
                    ? "Create customer account"
                    : "Sign in"}
                <span>→</span>
              </button>
            </form>

            {error && <p style={STYLES.error}>{error}</p>}

            {isCustomer ? (
              <p style={STYLES.switchText}>
                {authMode === "login" ? "New customer?" : "Already registered?"}{" "}
                <button
                  style={STYLES.linkButton}
                  onClick={() => {
                    setAuthMode(authMode === "login" ? "register" : "login");
                    setError("");
                  }}
                >
                  {authMode === "login" ? "Create an account" : "Sign in"}
                </button>
              </p>
            ) : (
              <div style={STYLES.demoBox}>
                <strong>Demo staff accounts · password: QueuePulse123</strong>
                {STAFF_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    style={STYLES.accountButton}
                    onClick={() => setEmail(account.email)}
                  >
                    <span>{account.label}</span>
                    <small>{account.email}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <Footer />
      </Page>
    );
  }

  if (isStaff && !selectedService) {
    return (
      <Page>
        <Header user={auth.user} onSignOut={signOut} />
        <section style={STYLES.dashboard}>
          <div style={STYLES.overviewIntro}>
            <div>
              <div style={STYLES.eyebrow}>STAFF WORKSPACE</div>
              <h1 style={STYLES.title}>Choose a service</h1>
              <p style={STYLES.muted}>Open a service to manage its live queue, counters, and history.</p>
            </div>
            <button style={STYLES.secondary} onClick={loadOverview}>↻ Refresh</button>
          </div>

          {error && <p style={STYLES.error}>{error}</p>}

          <div style={STYLES.serviceGrid}>
            {AREAS.map((area) => {
              const stats = overview.find((item) => item.apiName === area.apiName);
              return (
                <button
                  key={area.apiName}
                  style={STYLES.serviceBox}
                  onClick={() => {
                    setSelectedService(area.apiName);
                    setActiveTab("work");
                    setError("");
                    setNotice("");
                  }}
                >
                  <span style={{ ...STYLES.serviceIcon, color: area.color }}>{area.icon}</span>
                  <span style={STYLES.serviceTitle}>{area.title}</span>
                  <span style={STYLES.serviceDescription}>{area.detail}</span>
                  <div style={STYLES.cardStats}>
                    <span><strong>{stats?.waitingCount ?? "—"}</strong><small>Waiting</small></span>
                    <span><strong>{stats?.servingCount ?? "—"}</strong><small>In service</small></span>
                  </div>
                  <span style={STYLES.counterSummary}>
                    {stats
                      ? `${stats.busyCount}/${stats.capacity} busy · ${stats.freeCount} free${stats.onBreakCount ? ` · ${stats.onBreakCount} on break` : ""}`
                      : "Loading counters…"}
                  </span>
                  <span style={{ ...STYLES.openService, color: area.color }}>Open {area.title} →</span>
                </button>
              );
            })}
          </div>

          <section style={STYLES.overviewChartCard}>
            <div style={STYLES.chartHeading}>
              <div>
                <div style={STYLES.sectionEyebrow}>ALL SERVICE AREAS</div>
                <h2 style={STYLES.sectionTitle}>Arrival patterns</h2>
                <p style={STYLES.sectionHint}>Compare customer arrivals by hour · India time</p>
              </div>
              <ServiceLegend />
            </div>
            <OverviewChart series={overview} />
          </section>
        </section>
        <Footer />
      </Page>
    );
  }

  if (isStaff) {
    const capacity = serviceCounters?.capacity ?? 0;

    return (
      <Page>
        <Header user={auth.user} onSignOut={signOut} />
        <section style={STYLES.dashboard}>
          <div style={STYLES.serviceHeader}>
            <div>
              <button
                style={STYLES.back}
                onClick={() => {
                  setSelectedService("");
                  setActiveTab("work");
                  setStaffQueue([]);
                  setCompletedHistory([]);
                  setServiceCounters(null);
                  setInsight(null);
                  setAnalytics(null);
                  setError("");
                  setNotice("");
                }}
              >
                ← All services
              </button>
              <div style={STYLES.eyebrow}>SERVICE WORKSPACE</div>
              <h1 style={STYLES.title}>{selectedArea?.title}</h1>
              <p style={STYLES.muted}>{selectedArea?.detail}</p>
            </div>
            <button style={STYLES.secondary} onClick={() => loadServiceData(selectedService)}>↻ Refresh</button>
          </div>

          {error && <p style={STYLES.error}>{error}</p>}
          {notice && <p style={STYLES.notice}>{notice}</p>}

          <div style={STYLES.workspace}>
            <aside style={STYLES.sidebar}>
              <div style={STYLES.sidebarLabel}>WORKSPACE</div>
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  style={{
                    ...STYLES.navButton,
                    ...(activeTab === item.id ? STYLES.navButtonActive : {}),
                  }}
                  onClick={() => { setActiveTab(item.id); setError(""); }}
                >
                  <span>{item.icon}</span>
                  {item.label}
                  {item.id === "work" && waiting.length > 0 && (
                    <b style={STYLES.navCount}>{waiting.length}</b>
                  )}
                </button>
              ))}
            </aside>

            <main style={STYLES.panel}>
              {activeTab === "work" && (
                <MyWorkView
                  area={selectedArea}
                  queue={staffQueue}
                  counters={serviceCounters}
                  waiting={waiting}
                  inService={inService}
                  freeCounters={freeCounters}
                  canCallNext={canCallNext}
                  actionBusy={actionBusy}
                  onCallNext={callNext}
                  onComplete={completeService}
                  onRequestBreak={requestCounterBreak}
                  onResumeCounter={resumeCounter}
                  breakBusyCounter={breakBusyCounter}
                />
              )}

              {activeTab === "busyness" && (
                <BusynessView
                  area={selectedArea}
                  analytics={analytics}
                  insight={insight}
                  capacity={capacity}
                  extraCounters={extraCounters}
                  setExtraCounters={setExtraCounters}
                />
              )}

              {activeTab === "history" && (
                <HistoryView records={completedHistory} />
              )}
            </main>
          </div>
        </section>
        <Footer />
      </Page>
    );
  }

  return (
    <Page>
      <Header user={auth.user} onSignOut={signOut} />
      <section className="qp-customer-layout" style={STYLES.customerWrap}>
        <div className="qp-customer-story" style={STYLES.customerStory}>
          <div style={STYLES.eyebrow}>YOUR VISIT, IN CONTROL</div>
          <h1 style={STYLES.customerTitle}>Welcome,<br /><span>{auth.user.name.split(" ")[0]}.</span></h1>
          <p style={STYLES.muted}>Choose a service, take your place, and keep track of every visit from one screen.</p>
          <div style={STYLES.queueIllustration} aria-hidden="true"><div style={STYLES.queueLine} /><span style={STYLES.queueNodeActive}>01</span><span style={STYLES.queueNode}>02</span><span style={STYLES.queueNode}>03</span><div style={STYLES.queueIllustrationLabels}><small>JOIN</small><small>TRACK</small><small>SERVED</small></div></div>
          <div style={STYLES.customerSafety}><span style={STYLES.safetyIcon}>✓</span><span style={{ display: "grid", gap: 3 }}><strong style={{ color: "#34445e", fontSize: 11 }}>Live queue updates</strong><small style={{ color: "#71819a", fontSize: 10 }}>Your token status refreshes automatically.</small></span></div>
        </div>

        <section style={STYLES.card}>
          <div style={STYLES.customerCardHeading}><div style={STYLES.sectionEyebrow}>START A VISIT</div><h2 style={STYLES.sectionTitle}>Choose a service</h2><p style={STYLES.sectionHint}>One active token per service area.</p></div>
          <form onSubmit={joinQueue}>
            <div style={STYLES.serviceOptions}>
              {AREAS.map((area) => {
                const existingToken = activeCustomerTokens.find((token) => token.service === area.apiName);
                return <button type="button" key={area.apiName} onClick={() => { setCustomerService(area.apiName); setError(""); }} style={{ ...STYLES.serviceOption, ...(customerService === area.apiName ? STYLES.serviceOptionSelected : {}), ...(existingToken ? STYLES.serviceOptionHasToken : {}) }}>
                  <span style={{ ...STYLES.roleIcon, color: area.color }}>{area.icon}</span>
                  <span style={STYLES.serviceOptionText}><strong>{area.title}</strong><small>{existingToken ? `Token ${existingToken.token} · ${existingToken.status}` : area.detail}</small></span>
                  <span style={STYLES.serviceOptionCheck}>{existingToken ? "ACTIVE" : customerService === area.apiName ? "✓" : ""}</span>
                </button>;
              })}
            </div>
            <button style={{ ...STYLES.primary, ...(selectedServiceToken ? STYLES.buttonDisabled : {}) }} disabled={busy || Boolean(selectedServiceToken)}>{busy ? "Creating token…" : selectedServiceToken ? `${selectedServiceToken.token} is active` : "Get my token"} <span>→</span></button>
          </form>
          {error && <p style={STYLES.error}>{error}</p>}
        </section>

        <section className="qp-customer-tokens" style={STYLES.customerTokenPanel}>
          <div style={STYLES.customerTokenHeading}><div><div style={STYLES.sectionEyebrow}>LIVE UPDATES</div><h2 style={STYLES.sectionTitle}>Your queue tokens</h2></div><span style={STYLES.samplePill}>{activeCustomerTokens.length} active</span></div>
          {customerTokens.length === 0 ? <div style={STYLES.customerTokenEmpty}><span style={STYLES.emptyTokenIcon}>Q</span><strong>Your tokens will appear here</strong><small>Choose a service and get a token to start tracking your place.</small></div> : <div style={STYLES.customerTokenList}>
            {AREAS.map((area) => {
              const token = customerTokens.find((item) => item.service === area.apiName);
              if (!token) return null;
              const status = String(token.status || "waiting").toLowerCase();
              const isComplete = status === "completed";
              return <article key={area.apiName} style={{ ...STYLES.customerTokenCard, borderLeft: `4px solid ${area.color}` }}>
                <div style={STYLES.customerTokenCardTop}><span style={{ ...STYLES.customerTokenService, color: area.color }}>{area.title}</span><span style={{ ...STYLES.customerTokenStatus, ...(status === "called" || status === "in_service" ? STYLES.tokenCalled : {}), ...(isComplete ? STYLES.tokenCompleted : {}) }}>{status === "called" ? "CALLED" : status === "in_service" ? "IN SERVICE" : status.toUpperCase()}</span></div>
                <strong style={STYLES.customerTokenNumber}>{token.token}</strong>
                <div style={STYLES.customerTokenMetrics}><span style={{ display: "grid", gap: 3 }}><small>People ahead</small><b>{token.people_ahead ?? 0}</b></span><span style={{ display: "grid", gap: 3 }}><small>Estimated wait</small><b>{status === "waiting" && token.working_counters === 0 ? "Service paused" : status === "waiting" && Number(token.people_ahead) === 0 ? "You’re next" : `${token.estimated_wait_minutes ?? 0} min`}</b></span></div>
                {token.counter_name && <div style={STYLES.counterCallout}>Please go to <strong>{token.counter_name}</strong></div>}
                {token.service_notice && <div style={STYLES.customerBreakNotice}>{token.service_notice}</div>}
              </article>;
            })}
          </div>}
          <p style={STYLES.note}>Statuses and estimated waits update automatically.</p>
        </section>
      </section>
      <Footer />
    </Page>
  );
}

function MyWorkView({ area, queue, counters, waiting, inService, freeCounters, canCallNext, actionBusy, onCallNext, onComplete, onRequestBreak, onResumeCounter, breakBusyCounter }) {
  return (
    <div>
      <div style={STYLES.panelHeading}>
        <div>
          <div style={STYLES.sectionEyebrow}>LIVE OPERATIONS</div>
          <h2 style={STYLES.panelTitle}>My Work</h2>
          <p style={STYLES.sectionHint}>Only waiting and in-service customers appear here.</p>
        </div>
        <span style={STYLES.livePill}><i style={STYLES.liveDot} /> LIVE</span>
      </div>

      <div style={STYLES.metricCards}>
        <Metric label="Waiting" value={waiting.length} />
        <Metric label="In service" value={inService.length} />
        <Metric label="Counter capacity" value={counters?.capacity ?? "—"} />
        <Metric label="Counters free" value={freeCounters} />
      </div>

      <section style={STYLES.innerCard}>
        <div style={STYLES.innerCardHeader}>
          <div>
            <h3 style={STYLES.innerTitle}>{area?.title} counter schedule</h3>
            <p style={STYLES.sectionHint}>Green counters are free; amber counters are serving a customer.</p>
          </div>
          <button
            style={{ ...STYLES.actionButton, ...(!canCallNext ? STYLES.buttonDisabled : {}) }}
            onClick={onCallNext}
            disabled={!canCallNext || actionBusy}
          >
            {actionBusy
              ? "Updating…"
              : waiting.length === 0
                ? "No one waiting"
                : freeCounters === 0
                  ? "All counters busy"
                  : "Call next customer"}
          </button>
        </div>

        <div style={STYLES.counterGrid}>
          {(counters?.counters || []).map((counter) => {
            const active = queue.find(
              (item) => item.counter_name === counter.name && item.status === "called"
            );
            return (
              <div
                key={counter.name}
                style={counter.break_state === "on_break" ? STYLES.counterBreak : counter.break_state === "break_pending" ? STYLES.counterBreakPending : counter.status === "busy" ? STYLES.counterBusy : STYLES.counterFree}
              >
                <div style={STYLES.counterTopline}>
                  <i style={counter.break_state === "on_break" ? STYLES.breakDot : counter.status === "busy" ? STYLES.busyDot : STYLES.freeDot} />
                  <strong>{counter.name}</strong>
                  <span>{counter.break_state === "on_break" ? "ON BREAK" : counter.break_state === "break_pending" ? "BREAK SOON" : counter.status === "busy" ? "BUSY" : "FREE"}</span>
                </div>
                <small>{active ? `Serving ${active.token} · ${active.name}` : counter.break_state === "on_break" ? "Paused; not taking customers" : counter.break_state === "break_pending" ? `${counter.break_remaining ?? 2} more customers before break` : "Ready for next customer"}</small>
                <button
                  type="button"
                  style={STYLES.breakButton}
                  disabled={breakBusyCounter === counter.name}
                  onClick={() => counter.break_state === "working" || !counter.break_state ? onRequestBreak(counter.name) : onResumeCounter(counter.name)}
                >
                  {breakBusyCounter === counter.name ? "Updating…" : counter.break_state === "on_break" ? "Return to work" : counter.break_state === "break_pending" ? "Cancel break" : "Request break"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section style={STYLES.innerCard}>
        <div style={STYLES.innerCardHeader}>
          <div>
            <h3 style={STYLES.innerTitle}>Current and upcoming customers</h3>
            <p style={STYLES.sectionHint}>
              {queue.length} active token{queue.length === 1 ? "" : "s"} in this service.
            </p>
          </div>
        </div>

        {queue.length === 0 ? (
          <div style={STYLES.empty}>
            <strong>No active customers</strong>
            <small>Completed customers are saved in Completed History.</small>
          </div>
        ) : (
          <div style={STYLES.tableWrap}>
            <table style={STYLES.table}>
              <thead>
                <tr><th>Token</th><th>Customer</th><th>Status</th><th>Counter</th><th>Action</th></tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td><strong style={STYLES.tableToken}>{item.token}</strong></td>
                    <td><strong>{item.name}</strong></td>
                    <td><StatusPill status={item.status} /></td>
                    <td>{item.counter_name || "Waiting"}</td>
                    <td>
                      {item.status === "called"
                        ? <button style={STYLES.completeButton} onClick={() => onComplete(item.id, item.token)} disabled={actionBusy}>Complete</button>
                        : <span style={STYLES.nextHint}>{item.id === waiting[0]?.id ? "NEXT IN LINE" : "IN QUEUE"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function BusynessView({ area, analytics, insight, capacity, extraCounters, setExtraCounters }) {
  const chartData = analytics?.hourly_volume || [];
  const projected = extraCounters === 0
    ? insight?.estimated_queue_minutes ?? 0
    : Math.ceil(
        ((insight?.waiting ?? 0) + (insight?.in_service ?? 0)) /
        (capacity + extraCounters)
      ) * (insight?.average_service_minutes || 6);

  return (
    <div>
      <div style={STYLES.panelHeading}>
        <div>
          <div style={STYLES.sectionEyebrow}>DEMAND & PERFORMANCE</div>
          <h2 style={STYLES.panelTitle}>{area?.title} busyness</h2>
          <p style={STYLES.sectionHint}>Queue patterns and performance for this service.</p>
        </div>
        <span style={STYLES.samplePill}>{analytics?.sample_visits ?? 0} recorded visits</span>
      </div>

      <div style={STYLES.metricCards}>
        <Metric label="Peak arrival time" value={analytics?.peak_hour || "Building history"} />
        <Metric label="Average wait" value={analytics?.average_wait_minutes != null ? `${analytics.average_wait_minutes} min` : "Collecting data"} />
        <Metric label="Service time" value={analytics?.average_service_minutes != null ? `${analytics.average_service_minutes} min` : "Collecting data"} />
        <Metric label="Current queue estimate" value={`${analytics?.estimated_current_queue_minutes ?? 0} min`} />
      </div>

      <section style={STYLES.innerCard}>
        <div style={STYLES.innerCardHeader}>
          <div>
            <h3 style={STYLES.innerTitle}>Arrivals by hour</h3>
            <p style={STYLES.sectionHint}>Historical arrivals, shown in India time.</p>
          </div>
          {analytics?.peak_hour && <span style={STYLES.peakPill}>Peak · {analytics.peak_hour}</span>}
        </div>
        <HourlyChart data={chartData} color={area?.color || "#3566d4"} />
        {(analytics?.sample_visits ?? 0) < 10 && (
          <p style={STYLES.dataNote}>Peak-hour insight is preliminary until more visits are recorded.</p>
        )}
      </section>

      <section style={STYLES.innerCard}>
        <div style={STYLES.innerCardHeader}>
          <div>
            <h3 style={STYLES.innerTitle}>Efficiency recommendations</h3>
            <p style={STYLES.sectionHint}>Suggestions based on current and recorded service data.</p>
          </div>
        </div>
        {(analytics?.recommendations || []).map((item, index) => (
          <div style={STYLES.recommendationRow} key={`${index}-${item}`}>
            <span style={STYLES.recommendationNumber}>{index + 1}</span>
            <span>{item}</span>
          </div>
        ))}
        {insight?.bottleneck && (
          <div style={STYLES.bottleneckCallout}>
            <strong>Bottleneck detected</strong>
            <span>{insight.recommendation}</span>
          </div>
        )}
      </section>

      <details style={STYLES.innerCard}>
        <summary style={STYLES.detailsSummary}>What-if counter simulation</summary>
        <p style={STYLES.sectionHint}>Projection only; it does not change the actual counter limit.</p>
        <div style={STYLES.sliderLine}>
          <label htmlFor="extra-counters">Extra counters to simulate</label>
          <strong>{extraCounters}</strong>
        </div>
        <input
          id="extra-counters"
          type="range"
          min="0"
          max="4"
          value={extraCounters}
          onChange={(event) => setExtraCounters(Number(event.target.value))}
          style={STYLES.slider}
        />
        <div style={STYLES.simulationCompare}>
          <span>Current estimate</span>
          <strong>{insight?.estimated_queue_minutes ?? 0} min</strong>
          <span>Projected with extra counters</span>
          <strong>{projected} min</strong>
        </div>
      </details>
    </div>
  );
}

function HistoryView({ records }) {
  return (
    <div>
      <div style={STYLES.panelHeading}>
        <div>
          <div style={STYLES.sectionEyebrow}>PERSISTENT SERVICE RECORDS</div>
          <h2 style={STYLES.panelTitle}>Completed History</h2>
          <p style={STYLES.sectionHint}>Completed tokens leave My Work and stay recorded here.</p>
        </div>
        <span style={STYLES.samplePill}>{records.length} completed</span>
      </div>

      <section style={STYLES.innerCard}>
        {records.length === 0 ? (
          <div style={STYLES.empty}>
            <strong>No completed visits yet</strong>
            <small>Completed customer and timing details will appear here.</small>
          </div>
        ) : (
          <div style={STYLES.tableWrap}>
            <table style={STYLES.table}>
              <thead>
                <tr>
                  <th>Token</th><th>Customer</th><th>Email</th><th>Created</th>
                  <th>Called</th><th>Completed</th><th>Wait</th><th>Service</th>
                </tr>
              </thead>
              <tbody>
                {records.map((item) => (
                  <tr key={item.id}>
                    <td><strong style={STYLES.tableToken}>{item.token}</strong></td>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td>{formatTimestamp(item.created_at)}</td>
                    <td>{formatTimestamp(item.called_at)}</td>
                    <td>{formatTimestamp(item.completed_at)}</td>
                    <td>{formatMinutes(item.wait_minutes)}</td>
                    <td>{formatMinutes(item.service_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function OverviewChart({ series }) {
  const hours = series[0]?.analytics?.hourly_volume || [];
  if (!hours.length) {
    return <div style={STYLES.empty}><small>Loading arrival data…</small></div>;
  }

  const maximum = Math.max(
    1,
    ...series.flatMap((service) =>
      (service.analytics?.hourly_volume || []).map((item) => item.count)
    )
  );

  return (
    <div style={STYLES.chart}>
      {hours.map((hour, index) => (
        <div key={`${index}-${hour.hour}`} style={STYLES.barColumn}>
          <div
            style={STYLES.groupBars}
            title={series.map((service) =>
              `${service.title}: ${service.analytics?.hourly_volume?.[index]?.count || 0}`
            ).join(" · ")}
          >
            {AREAS.map((area) => {
              const service = series.find((item) => item.apiName === area.apiName);
              const count = service?.analytics?.hourly_volume?.[index]?.count || 0;
              const height = count ? Math.max(4, (count / maximum) * 100) : 3;
              return (
                <span
                  key={area.apiName}
                  style={{
                    ...STYLES.bar,
                    height: `${height}%`,
                    background: count ? area.color : "#e8edf4",
                  }}
                />
              );
            })}
          </div>
          <small>{index % 3 === 0 ? hour.hour.split("–")[0] : ""}</small>
        </div>
      ))}
    </div>
  );
}

function HourlyChart({ data, color }) {
  const maximum = Math.max(1, ...data.map((item) => item.count));

  return (
    <div style={STYLES.chart}>
      {data.map((item, index) => (
        <div key={`${index}-${item.hour}`} style={STYLES.barColumn} title={`${item.hour}: ${item.count} arrivals`}>
          <span
            style={{
              ...STYLES.bar,
              height: item.count ? `${Math.max(4, (item.count / maximum) * 100)}%` : "3px",
              background: item.count ? color : "#e8edf4",
            }}
          />
          <small>{index % 3 === 0 ? item.hour.split("–")[0] : ""}</small>
        </div>
      ))}
    </div>
  );
}

function ServiceLegend() {
  return (
    <div style={STYLES.legend}>
      {AREAS.map((area) => (
        <span style={STYLES.legendItem} key={area.apiName}>
          <i style={{ ...STYLES.legendDot, background: area.color }} />
          {area.title}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  return (
    <span style={{
      ...STYLES.statusPill,
      ...(status === "called" ? STYLES.calledPill : {}),
    }}>
      {status === "called" ? "In service" : "Waiting"}
    </span>
  );
}

function Metric({ label, value }) {
  return (
    <div style={STYLES.metricCard}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMinutes(value) {
  return value == null ? "—" : `${value} min`;
}

function Page({ children }) {
  return (
    <>
      <style>{`
        @keyframes qpFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes qpFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @media (max-width: 560px) {
          .qp-auth-layout { grid-template-columns: 1fr !important; max-width: 520px !important; }
        }
        @media (max-width: 1120px) {
          .qp-customer-layout { grid-template-columns: minmax(210px, .8fr) minmax(350px, 1fr) !important; }
          .qp-customer-tokens { grid-column: 1 / -1; }
        }
        @media (max-width: 760px) {
          .qp-welcome-visual { grid-template-columns: 1fr !important; padding: 30px !important; }
          .qp-welcome-art { min-height: 270px !important; }
          .qp-customer-layout { grid-template-columns: 1fr !important; gap: 14px !important; }
          .qp-customer-tokens { grid-column: auto; }
          .qp-customer-story { padding: 18px 4px !important; }
        }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; } }
      `}</style>
      <main style={STYLES.page}>{children}</main>
    </>
  );
}

function Header({ user, onSignOut }) {
  return (
    <header style={STYLES.header}>
      <a href="#" style={STYLES.brand}>
        <span style={STYLES.logo}>Q</span> QueuePulse
      </a>
      {user ? (
        <div style={STYLES.userArea}>
          <span style={user.role === "staff" ? STYLES.staffBadge : STYLES.customerBadge}>
            {user.role === "staff" ? "STAFF" : "CUSTOMER"}
          </span>
          <span>{user.name}</span>
          <button style={STYLES.secondary} onClick={onSignOut}>Sign out</button>
        </div>
      ) : (
        <span style={STYLES.live}>QUEUE SERVICE</span>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer style={STYLES.footer}>
      QUEUEPULSE · SMARTER SERVICE, LESS WAITING
      <span>HACKATHON DEMO</span>
    </footer>
  );
}

const STYLES = {

  counterBreak: { display: "grid", gap: 7, padding: 11, border: "1px solid #d9dfe9", borderRadius: 10, background: "#f0f2f6", color: "#667085", fontSize: 10 },
  counterBreakPending: { display: "grid", gap: 7, padding: 11, border: "1px solid #edd8ab", borderRadius: 10, background: "#fff8ea", color: "#805a16", fontSize: 10 },
  breakDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#8b93a3" },
  breakButton: { justifySelf: "start", marginTop: 3, padding: "6px 8px", border: "1px solid rgba(85,101,126,.2)", borderRadius: 7, background: "rgba(255,255,255,.8)", color: "#43536b", fontSize: 9, fontWeight: 800, cursor: "pointer" },
  customerBreakNotice: { marginTop: 9, padding: "8px 9px", border: "1px solid #f1dfb9", borderRadius: 8, background: "#fff8ea", color: "#805a16", fontSize: 10, lineHeight: 1.45 },

  authAside: { position: "relative", overflow: "hidden", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", minHeight: 430, padding: "clamp(24px, 4vw, 42px)", borderRadius: 22, background: "linear-gradient(145deg, #112344 0%, #1c3b75 64%, #3157a2 100%)", color: "#fff", boxShadow: "0 20px 52px rgba(20,43,82,.17)" },
  authAsideGlow: { position: "absolute", width: 270, height: 270, right: -80, top: -80, borderRadius: "50%", background: "radial-gradient(circle, rgba(130,173,255,.32), transparent 70%)" },
  authAsideBadge: { position: "relative", display: "flex", alignItems: "center", gap: 8, color: "#c4d4f4", fontSize: 9, fontWeight: 850, letterSpacing: 1.5 },
  authAsideTitle: { position: "relative", maxWidth: 350, margin: "26px 0 12px", color: "#fff", fontSize: "clamp(28px, 3vw, 38px)", fontWeight: 850, lineHeight: 1.08, letterSpacing: "-1.2px" },
  authAsideCopy: { position: "relative", maxWidth: 340, color: "#cedbf1", fontSize: 13, lineHeight: 1.7 },
  authAsideFlow: { position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 32, color: "#e2eaff", fontSize: 8, fontWeight: 850, letterSpacing: 1.2 },
  authAsideBottom: { position: "relative", display: "flex", alignItems: "center", gap: 10, marginTop: 48, color: "#aebfe0", fontSize: 8, lineHeight: 1.6, fontWeight: 800, letterSpacing: 1 },
  authAsideIcon: { display: "grid", placeItems: "center", width: 33, height: 33, border: "1px solid rgba(255,255,255,.35)", borderRadius: 10, color: "#fff", fontSize: 17, fontWeight: 900 },

  customerStory: { position: "relative", alignSelf: "stretch", display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0, padding: "30px 4px", animation: "qpFadeUp .65s ease both" },
  customerTitle: { margin: "14px 0", color: "#15233b", fontSize: "clamp(42px, 5vw, 62px)", lineHeight: 1.02, letterSpacing: "-2.8px", fontWeight: 850 },
  queueIllustration: { position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", maxWidth: 390, margin: "42px 0 28px", padding: "0 6px" },
  queueLine: { position: "absolute", left: 22, right: 22, top: 19, height: 2, background: "linear-gradient(90deg, #315bd2, #d9e2f1)" },
  queueNodeActive: { position: "relative", display: "grid", placeItems: "center", width: 40, height: 40, border: "4px solid #e6edff", borderRadius: "50%", background: "#315bd2", color: "#fff", fontSize: 10, fontWeight: 850, boxShadow: "0 0 0 5px #f5f7fc" },
  queueNode: { position: "relative", display: "grid", placeItems: "center", width: 40, height: 40, border: "1px solid #dce4f0", borderRadius: "50%", background: "#fff", color: "#8291a8", fontSize: 10, fontWeight: 850, boxShadow: "0 0 0 5px #f5f7fc" },
  queueIllustrationLabels: { position: "absolute", left: 0, right: 0, top: 51, display: "flex", justifyContent: "space-between", color: "#8492a7", fontSize: 8, fontWeight: 850, letterSpacing: 1 },
  customerSafety: { display: "flex", alignItems: "center", gap: 11, maxWidth: 380, marginTop: 22, padding: 13, border: "1px solid #dce6f2", borderRadius: 13, background: "rgba(255,255,255,.7)" },
  safetyIcon: { display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 10, background: "#e5f5ed", color: "#16845b", fontWeight: 900 },
  customerCardHeading: { marginBottom: 18 },
  customerTokenPanel: { minWidth: 0, alignSelf: "stretch", padding: 20, border: "1px solid #dce4f0", borderRadius: 20, background: "rgba(255,255,255,.88)", boxShadow: "0 14px 32px rgba(31,48,78,.055)" },
  customerTokenHeading: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 9, marginBottom: 16 },
  customerTokenList: { display: "grid", gap: 11 },
  customerTokenCard: { minWidth: 0, padding: "13px 14px", borderTop: "1px solid #e5eaf2", borderRight: "1px solid #e5eaf2", borderBottom: "1px solid #e5eaf2", borderRadius: 12, background: "#fff", boxShadow: "0 5px 15px rgba(31,48,78,.035)" },
  customerTokenCardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  customerTokenService: { fontSize: 11, fontWeight: 850 },
  customerTokenStatus: { padding: "4px 7px", borderRadius: 30, background: "#fff2d9", color: "#936312", fontSize: 8, fontWeight: 850, letterSpacing: ".5px" },
  tokenCalled: { background: "#e7efff", color: "#3158bb" },
  tokenCompleted: { background: "#e3f4eb", color: "#176b50" },
  customerTokenNumber: { display: "block", margin: "8px 0", color: "#1c2d4a", fontSize: 28, lineHeight: 1, letterSpacing: "-.8px", fontWeight: 850 },
  customerTokenMetrics: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  customerTokenEmpty: { display: "grid", justifyItems: "center", gap: 9, padding: "34px 18px", border: "1px dashed #d5deea", borderRadius: 13, background: "#f8faff", color: "#667791", textAlign: "center", fontSize: 12 },
  emptyTokenIcon: { display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 13, background: "#eaf0ff", color: "#3158bb", fontWeight: 900, fontSize: 18 },
  counterCallout: { display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10, padding: "8px 9px", borderRadius: 8, background: "#eef8f2", color: "#466b57", fontSize: 10 },
  serviceOptionText: { display: "grid", gap: 4, minWidth: 0, flex: 1 },
  serviceOptionCheck: { color: "#3158bb", fontSize: 9, fontWeight: 850, letterSpacing: ".5px" },
  serviceOptionHasToken: { borderColor: "#b9c9ed", background: "#f7f9ff" },

  welcomeOuter: { width: "min(100%, 1240px)", minHeight: "calc(100vh - 132px)", margin: "auto", display: "grid", alignContent: "center", padding: "34px 0", animation: "qpFadeUp .8s ease both" },
  welcomeVisual: { position: "relative", overflow: "hidden", display: "grid", gridTemplateColumns: "minmax(0, 1.08fr) minmax(300px, .92fr)", alignItems: "center", minHeight: 510, padding: "clamp(28px, 6vw, 76px)", borderRadius: 30, background: "linear-gradient(115deg, #102344 0%, #17366a 56%, #244b93 100%)", color: "#fff", boxShadow: "0 28px 70px rgba(20,43,82,.2)" },
  welcomeCopy: { position: "relative", zIndex: 1, maxWidth: 570, animation: "qpFadeUp .9s .08s ease both" },
  welcomeEyebrow: { display: "flex", alignItems: "center", gap: 9, color: "#b9ceff", fontSize: 10, fontWeight: 850, letterSpacing: 2, textTransform: "uppercase" },
  welcomeTitle: { margin: "22px 0 16px", color: "#fff", fontSize: "clamp(42px, 6.4vw, 76px)", fontWeight: 850, letterSpacing: "-3.5px", lineHeight: .99 },
  welcomeDescription: { maxWidth: 475, margin: 0, color: "#cfdbef", fontSize: 16, lineHeight: 1.75 },
  welcomeCta: { display: "inline-flex", alignItems: "center", gap: 24, marginTop: 28, padding: "14px 18px", border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, background: "#fff", color: "#17366a", fontSize: 13, fontWeight: 850, cursor: "pointer", boxShadow: "0 10px 24px rgba(0,0,0,.15)" },
  welcomePerks: { display: "flex", flexWrap: "wrap", gap: "12px 20px", marginTop: 38, color: "#c5d4ed", fontSize: 10, fontWeight: 700 },
  welcomeArt: { position: "relative", display: "grid", placeItems: "center", minHeight: 365, animation: "qpFloat 6s ease-in-out infinite" },
  artGlow: { position: "absolute", width: "min(34vw, 390px)", aspectRatio: "1", borderRadius: "50%", background: "radial-gradient(circle, rgba(113,162,255,.34), rgba(66,113,210,.10) 55%, transparent 72%)", filter: "blur(3px)" },
  artCardBack: { position: "absolute", top: "18%", right: "4%", display: "grid", gap: 13, width: "min(76%, 310px)", padding: 20, border: "1px solid rgba(255,255,255,.2)", borderRadius: 18, background: "rgba(255,255,255,.10)", color: "#dce7fb", transform: "rotate(7deg)", backdropFilter: "blur(8px)" },
  artTicket: { position: "relative", zIndex: 1, display: "grid", gap: 11, width: "min(84%, 340px)", padding: "24px 26px", border: "1px solid rgba(255,255,255,.65)", borderRadius: 20, background: "linear-gradient(145deg, #fff, #f0f5ff)", color: "#233854", boxShadow: "0 24px 55px rgba(4,19,46,.28)", transform: "rotate(-4deg)" },
  artOrbit: { position: "absolute", right: "2%", bottom: "10%", display: "grid", placeItems: "center", width: 64, height: 64, border: "1px solid rgba(255,255,255,.36)", borderRadius: "50%", background: "rgba(255,255,255,.12)", color: "#fff", fontSize: 26, fontWeight: 850, backdropFilter: "blur(8px)" },
  artSpark: { position: "absolute", top: "14%", left: "4%", color: "#bbd0ff", fontSize: 28 },
  welcomeFootnote: { display: "flex", justifyContent: "space-between", gap: 10, padding: "17px 4px 0", color: "#71819a", fontSize: 10, fontWeight: 750, letterSpacing: ".3px" },
  page: {minHeight: "100vh", boxSizing: "border-box", padding: "0 clamp(18px, 5vw, 76px)", background: "linear-gradient(145deg, #f6f8ff 0%, #f3f6fb 56%, #eef3fb 100%)", color: "#17243a", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"},
  header: {minHeight: 76, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, borderBottom: "1px solid #dfe6f1", position: "relative", zIndex: 2},
  brand: {display: "flex", alignItems: "center", gap: 11, color: "#14213a", fontSize: 19, fontWeight: 850, letterSpacing: "-.5px", textDecoration: "none"},
  logo: {display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: "linear-gradient(145deg, #315dde, #2142a0)", color: "#fff", boxShadow: "0 7px 16px rgba(42,78,177,.22)"},
  userArea: { display: "flex", alignItems: "center", gap: 11, fontSize: 13 },
  staffBadge: { padding: "6px 9px", borderRadius: 20, background: "#e8efff", color: "#3158bb", fontSize: 9, fontWeight: 850 },
  customerBadge: { padding: "6px 9px", borderRadius: 20, background: "#e3f4eb", color: "#176b50", fontSize: 9, fontWeight: 850 },
  live: { color: "#52637b", fontSize: 10, fontWeight: 800 },
  center: {minHeight: "calc(100vh - 138px)", display: "grid", alignContent: "center", justifyItems: "center", textAlign: "center", padding: "54px 16px 66px", animation: "qpFadeUp .65s ease both"},
  eyebrow: {color: "#365bd2", fontWeight: 850, fontSize: 10, letterSpacing: 2, textTransform: "uppercase"},
  title: {margin: "12px 0 8px", color: "#14213a", fontSize: "clamp(32px, 4vw, 46px)", lineHeight: 1.08, letterSpacing: "-1.8px", fontWeight: 800},
  muted: {color: "#61718a", fontSize: 14, lineHeight: 1.7},
  roleGrid: {display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", width: "min(100%, 650px)", gap: 16, marginTop: 30},
  roleCard: {display: "grid", justifyItems: "start", gap: 12, padding: 24, border: "1px solid #dce4f0", borderRadius: 18, background: "rgba(255,255,255,.88)", color: "#192943", textAlign: "left", cursor: "pointer", boxShadow: "0 14px 32px rgba(31,53,94,.07)", transition: "transform .2s ease, box-shadow .2s ease, border-color .2s ease"},
  roleIcon: {display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 14, background: "#eaf0ff", color: "#3158c7", fontSize: 22},
  link: {color: "#3158c7", fontWeight: 850, fontSize: 12},
  authWrap: {width: "min(100%, 1020px)", margin: "18px auto 34px", minHeight: "calc(100vh - 190px)", display: "grid", gridTemplateColumns: "minmax(0, .92fr) minmax(0, 1fr)", gap: 20, alignContent: "center", alignItems: "stretch", padding: "0 0 30px", animation: "qpFadeUp .5s ease both"},
  back: {margin: "0 0 16px", padding: "8px 0", border: 0, background: "none", color: "#3158c7", fontWeight: 750, cursor: "pointer"},
  card: {padding: "clamp(22px, 5vw, 34px)", background: "rgba(255,255,255,.96)", border: "1px solid #dfe6f1", borderRadius: 20, boxShadow: "0 18px 46px rgba(28,46,79,.09)"},
  cardTitle: {margin: "10px 0 7px", color: "#15233b", fontSize: 28, lineHeight: 1.15, letterSpacing: "-.8px", fontWeight: 800},
  label: {display: "block", margin: "17px 0 7px", color: "#34445e", fontSize: 12, fontWeight: 750},
  input: {boxSizing: "border-box", width: "100%", height: 48, padding: "0 14px", border: "1px solid #cbd6e6", borderRadius: 11, color: "#182338", background: "#fff", fontSize: 14},
  primary: {display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginTop: 20, padding: "14px 16px", border: 0, borderRadius: 11, background: "linear-gradient(110deg, #315bd2, #2448ad)", color: "#fff", fontWeight: 800, cursor: "pointer", boxShadow: "0 9px 20px rgba(49,88,187,.2)"},
  secondary: {padding: "9px 13px", border: "1px solid #d5deea", borderRadius: 10, background: "#fff", color: "#34435a", fontWeight: 750, cursor: "pointer"},
  error: { padding: 10, borderRadius: 8, background: "#fff0ef", color: "#a52b25", fontSize: 12 },
  notice: { margin: "0 0 14px", padding: 10, borderRadius: 8, background: "#e5f5ed", color: "#176b50", fontSize: 12 },
  switchText: { textAlign: "center", color: "#718097", fontSize: 12 },
  linkButton: { border: 0, background: "none", color: "#3158bb", fontWeight: 750, cursor: "pointer" },
  demoBox: { display: "grid", gap: 7, marginTop: 17, padding: 12, borderRadius: 9, background: "#f3f6fc", color: "#52637b", fontSize: 11 },
  accountButton: { display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 5, padding: "7px 9px", border: "1px solid #dfe6f0", borderRadius: 7, background: "#fff", color: "#35465e", cursor: "pointer" },
  dashboard: {width: "min(100%, 1240px)", minHeight: "calc(100vh - 125px)", margin: "auto", padding: "30px 0 42px"},
  overviewIntro: {display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 22},
  serviceGrid: {display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 16},
  serviceBox: {display: "grid", justifyItems: "start", gap: 11, minHeight: 225, padding: 22, border: "1px solid #dce4f0", borderRadius: 18, background: "#fff", color: "#1a2942", textAlign: "left", cursor: "pointer", boxShadow: "0 12px 30px rgba(31,48,78,.055)", transition: "transform .2s ease, box-shadow .2s ease, border-color .2s ease"},
  serviceIcon: {display: "grid", placeItems: "center", width: 43, height: 43, borderRadius: 14, background: "#eef2ff", fontSize: 21},
  serviceTitle: {color: "#15233b", fontSize: 21, fontWeight: 850, letterSpacing: "-.4px"},
  serviceDescription: {color: "#667791", fontSize: 13},
  cardStats: {display: "flex", gap: 32, marginTop: 8},
  counterSummary: {color: "#53647d", fontSize: 11, fontWeight: 750},
  openService: {alignSelf: "end", marginTop: 7, fontSize: 12, fontWeight: 850},
  overviewChartCard: {marginTop: 22, padding: "22px 24px", border: "1px solid #dce4f0", borderRadius: 18, background: "#fff", boxShadow: "0 10px 28px rgba(31,48,78,.045)"},
  chartHeading: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  sectionEyebrow: {color: "#71819a", fontSize: 10, fontWeight: 850, letterSpacing: 1.5, marginBottom: 6},
  sectionTitle: {margin: "0 0 5px", fontSize: 19, color: "#1a2942", letterSpacing: "-.35px"},
  sectionHint: {margin: 0, color: "#73829a", fontSize: 12, lineHeight: 1.55},
  legend: { display: "flex", gap: 12, flexWrap: "wrap" },
  legendItem: { display: "flex", alignItems: "center", gap: 5, color: "#52637b", fontSize: 10, fontWeight: 700 },
  legendDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%" },
  chart: { display: "grid", gridTemplateColumns: "repeat(24, minmax(7px, 1fr))", alignItems: "end", gap: 4, height: 112, padding: "0 2px" },
  barColumn: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "end", gap: 4, height: "100%" },
  groupBars: { display: "flex", alignItems: "end", justifyContent: "center", gap: 1, width: "100%", height: "100%" },
  bar: { display: "block", flex: 1, minWidth: 2, minHeight: 3, borderRadius: "3px 3px 1px 1px" },
  serviceHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 17 },
  workspace: {display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 20, alignItems: "start"},
  sidebar: {position: "sticky", top: 15, display: "grid", gap: 6, padding: 11, border: "1px solid #dce4f0", borderRadius: 16, background: "#fff", boxShadow: "0 8px 24px rgba(31,48,78,.045)"},
  sidebarLabel: { padding: "8px 10px", color: "#8a96a8", fontSize: 9, fontWeight: 850, letterSpacing: 1.2 },
  navButton: {display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 12px", border: 0, borderRadius: 10, background: "transparent", color: "#596b84", textAlign: "left", fontSize: 12, fontWeight: 750, cursor: "pointer"},
  navButtonActive: {background: "#eaf0ff", color: "#2449a8"},
  navCount: { display: "grid", placeItems: "center", width: 19, height: 19, marginLeft: "auto", borderRadius: "50%", background: "#dce7ff", color: "#2449a8", fontSize: 10 },
  panel: { minWidth: 0 },
  panelHeading: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 15 },
  panelTitle: {margin: "5px 0", color: "#172640", fontSize: 24, letterSpacing: "-.65px", fontWeight: 820},
  livePill: { display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 20, background: "#e4f5ed", color: "#176b50", fontSize: 9, fontWeight: 850 },
  liveDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "#1b9a72" },
  metricCards: {display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 11, marginBottom: 15},
  metricCard: {display: "grid", gap: 8, padding: "15px 16px", border: "1px solid #dfe6f0", borderRadius: 13, background: "#fff", boxShadow: "0 5px 15px rgba(31,48,78,.035)"},
  innerCard: {marginBottom: 14, padding: "18px 19px", border: "1px solid #dfe6f0", borderRadius: 15, background: "#fff", boxShadow: "0 7px 22px rgba(31,48,78,.035)"},
  innerCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 13 },
  innerTitle: {margin: 0, color: "#1d2d45", fontSize: 15, fontWeight: 800},
  counterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8 },
  counterFree: { display: "grid", gap: 7, padding: 11, border: "1px solid #cce8db", borderRadius: 9, background: "#f4fbf7", color: "#176b50", fontSize: 10 },
  counterBusy: { display: "grid", gap: 7, padding: 11, border: "1px solid #efd59f", borderRadius: 9, background: "#fff9ed", color: "#805a16", fontSize: 10 },
  counterTopline: { display: "flex", alignItems: "center", gap: 7 },
  freeDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#19966b" },
  busyDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#d69727" },
  actionButton: { padding: "10px 13px", border: 0, borderRadius: 8, background: "#2449a8", color: "#fff", fontSize: 11, fontWeight: 800, cursor: "pointer" },
  completeButton: { padding: "7px 9px", border: 0, borderRadius: 7, background: "#16845b", color: "#fff", fontSize: 10, fontWeight: 750, cursor: "pointer" },
  buttonDisabled: { background: "#abb6c7", cursor: "not-allowed" },
  tableWrap: { width: "100%", overflowX: "auto" },
  table: {width: "100%", borderCollapse: "collapse", color: "#43536b", fontSize: 12, textAlign: "left"},
  tableToken: { color: "#3158bb" },
  statusPill: { display: "inline-block", padding: "5px 7px", borderRadius: 20, background: "#fff2d9", color: "#936312", fontSize: 9, fontWeight: 800 },
  calledPill: { background: "#e7efff", color: "#3158bb" },
  nextHint: { color: "#6d7b90", fontSize: 9, fontWeight: 800 },
  empty: { display: "grid", justifyItems: "center", gap: 6, padding: "28px 10px", color: "#64738a", textAlign: "center", fontSize: 12 },
  samplePill: { padding: "6px 8px", borderRadius: 20, background: "#eef2f8", color: "#52637b", fontSize: 9, fontWeight: 800 },
  peakPill: { padding: "6px 8px", borderRadius: 20, background: "#fff2d9", color: "#805a16", fontSize: 10, fontWeight: 800 },
  dataNote: { margin: "10px 0 0", color: "#7b8798", fontSize: 10 },
  recommendationRow: { display: "flex", alignItems: "start", gap: 8, padding: "9px 0", borderTop: "1px solid #edf0f5", color: "#52637b", fontSize: 11, lineHeight: 1.5 },
  recommendationNumber: { display: "grid", placeItems: "center", flex: "0 0 19px", height: 19, borderRadius: "50%", background: "#eaf0ff", color: "#3158bb", fontSize: 9, fontWeight: 800 },
  bottleneckCallout: { display: "grid", gap: 4, marginTop: 10, padding: 11, borderRadius: 9, background: "#fff6e5", color: "#805a16", fontSize: 11 },
  detailsSummary: { color: "#30445f", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  sliderLine: { display: "flex", justifyContent: "space-between", marginTop: 13, color: "#52637b", fontSize: 11 },
  slider: { width: "100%", margin: "11px 0", accentColor: "#3158bb" },
  simulationCompare: { display: "grid", gridTemplateColumns: "1fr auto", gap: 7, color: "#65758c", fontSize: 11 },
  serviceOptions: { display: "grid", gap: 8 },
  serviceOption: { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: 12, border: "1px solid #dce4f0", borderRadius: 12, background: "#fff", textAlign: "left", cursor: "pointer", color: "#26344a" },
  serviceOptionSelected: { borderColor: "#5474e2", background: "#f1f5ff", boxShadow: "0 0 0 2px rgba(84,116,226,.09)" },
  customerWrap: {width: "min(100%, 1020px)", minHeight: "calc(100vh - 125px)", margin: "auto", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 440px)", gap: 48, alignItems: "center", padding: "30px 0"},
  ticket: {marginTop: 18, padding: 19, border: "1px solid #dbe5f5", borderRadius: 15, background: "linear-gradient(145deg, #f1f5ff, #f8faff)", color: "#52627a", fontSize: 12},
  ticketTop: { display: "flex", justifyContent: "space-between", color: "#66758b", fontSize: 9, fontWeight: 800, letterSpacing: 1 },
  ticketNumber: {display: "block", margin: "9px 0", color: "#284fc7", fontSize: 46, lineHeight: 1, letterSpacing: "-1.5px", fontWeight: 850},
  ticketInfo: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, color: "#68768b", fontSize: 11 },
  note: { display: "block", marginTop: 9, color: "#7b8798", fontSize: 10 },
  footer: {width: "min(100%, 1240px)", minHeight: 54, margin: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderTop: "1px solid #dfe6f1", color: "#77859a", fontSize: 9, fontWeight: 850, letterSpacing: 1.1},
};





