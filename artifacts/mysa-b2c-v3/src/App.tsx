import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { AuthContext, type AuthUser } from "@/contexts/AuthContext";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import AcceptInvite from "@/pages/AcceptInvite";
import Verify from "@/pages/Verify";

const Dashboard        = lazy(() => import("@/pages/Dashboard"));
const Leads            = lazy(() => import("@/pages/Leads"));
const LeadDetail       = lazy(() => import("@/pages/LeadDetail"));
const IcpManager       = lazy(() => import("@/pages/IcpManager"));
const BrandAudit       = lazy(() => import("@/pages/BrandAudit"));
const Qualify          = lazy(() => import("@/pages/Qualify"));
const Outreach         = lazy(() => import("@/pages/Outreach"));
const Pipeline         = lazy(() => import("@/pages/Pipeline"));
const Meetings         = lazy(() => import("@/pages/Meetings"));
const HubSpot          = lazy(() => import("@/pages/HubSpot"));
const SalesBrain       = lazy(() => import("@/pages/SalesBrain"));
const Agents           = lazy(() => import("@/pages/Agents"));
const AgentHub         = lazy(() => import("@/pages/AgentHub"));
const Billing          = lazy(() => import("@/pages/Billing"));
const Settings         = lazy(() => import("@/pages/Settings"));
const AuditShare       = lazy(() => import("@/pages/AuditShare"));
const Booking          = lazy(() => import("@/pages/Booking"));
const Campaigns        = lazy(() => import("@/pages/Campaigns"));
const Automations      = lazy(() => import("@/pages/Automations"));
const Proposals        = lazy(() => import("@/pages/Proposals"));
const Registrations    = lazy(() => import("@/pages/Registrations"));
const FetchLeads       = lazy(() => import("@/pages/FetchLeads"));
const LeadHunter       = lazy(() => import("@/pages/LeadHunter"));
const LeadBank         = lazy(() => import("@/pages/LeadBank"));
const AiComposer       = lazy(() => import("@/pages/AiComposer"));
const SignalFeed       = lazy(() => import("@/pages/SignalFeed"));
const SalesAgentControl = lazy(() => import("@/pages/SalesAgentControl"));
const PlayLab          = lazy(() => import("@/pages/PlayLab"));
const PlayDetail       = lazy(() => import("@/pages/PlayDetail"));
const PlaySignals      = lazy(() => import("@/pages/PlaySignals"));
const Integrations     = lazy(() => import("@/pages/Integrations"));
const SuperAdmin       = lazy(() => import("@/pages/SuperAdmin"));
const NotFound         = lazy(() => import("@/pages/not-found"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function PageLoader() {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "#f9fafb" }}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: "#4F35A8", borderTopColor: "transparent" }}
        />
      </div>
    </div>
  );
}

function RedirectTo({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to); }, []);
  return null;
}

// ── Onboarding Modal ──────────────────────────────────────────────────────────
const AUDIT_STEPS = [
  "Fetching website metadata…",
  "Analysing SEO signals…",
  "Scanning trust indicators…",
  "Scoring messaging clarity…",
  "Evaluating social proof…",
  "Generating AI health score…",
];

function OnboardingModal({ user, onComplete }: { user: AuthUser; onComplete: () => void }) {
  const [step, setStep]         = useState<1 | 2 | 3>(1);
  const [url, setUrl]           = useState("");
  const [urlErr, setUrlErr]     = useState("");
  const [progress, setProgress] = useState(0);
  const [stepIdx, setStepIdx]   = useState(0);
  const [saving, setSaving]     = useState(false);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);

  function startAudit() {
    const trimmed = url.trim();
    if (!trimmed) { setUrlErr("Please enter your website URL"); return; }
    try { new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`); }
    catch { setUrlErr("Please enter a valid URL, e.g. https://yourcompany.com"); return; }
    setUrlErr("");
    setStep(2);
    setProgress(0);
    setStepIdx(0);

    let p = 0;
    let si = 0;
    timerRef.current = setInterval(() => {
      p += Math.random() * 14 + 6;
      if (p >= 100) { p = 100; clearInterval(timerRef.current!); setTimeout(() => setStep(3), 600); }
      setProgress(Math.min(p, 100));
      si = Math.min(Math.floor(p / (100 / AUDIT_STEPS.length)), AUDIT_STEPS.length - 1);
      setStepIdx(si);
    }, 480);
  }

  async function handleDone() {
    setSaving(true);
    try {
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ onboardingCompleted: true }),
      });
    } catch { /* ignore */ }
    finally { setSaving(false); onComplete(); }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const firstName = user.firstName?.trim() || "there";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 20, width: "100%", maxWidth: 520,
          boxShadow: "0 32px 80px rgba(0,0,0,0.22)", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ background: "linear-gradient(135deg, #1A3D2B 0%, #0D9488 100%)", padding: "24px 28px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 18 }}>⚡</span>
            </div>
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 700, letterSpacing: "0.04em" }}>MysaAI — AI Sales Brain</span>
          </div>
          <h2 style={{ color: "#fff", fontSize: 22, fontWeight: 800, margin: 0, lineHeight: 1.2 }}>
            Welcome, {firstName}! 👋
          </h2>
          <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 6, marginBottom: 0 }}>
            Let's run a free audit on your website in 30 seconds.
          </p>
          {/* Step dots */}
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{ height: 4, flex: 1, borderRadius: 4, background: step >= s ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)", transition: "background 0.3s" }} />
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px 28px" }}>

          {/* ─ Step 1: URL Input ─ */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 14, color: "#374151", marginBottom: 20, lineHeight: 1.6 }}>
                MysaAI will audit your website's brand health, SEO signals, and trust score — then show you a sample AI-written outreach email personalised to your business.
              </p>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#6B7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Your Website URL
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={url}
                  onChange={e => { setUrl(e.target.value); setUrlErr(""); }}
                  onKeyDown={e => { if (e.key === "Enter") startAudit(); }}
                  placeholder="https://yourcompany.com"
                  style={{
                    flex: 1, border: urlErr ? "1.5px solid #EF4444" : "1.5px solid #E5E7EB",
                    borderRadius: 10, padding: "10px 14px", fontSize: 14, outline: "none",
                    color: "#111827",
                  }}
                  autoFocus
                />
              </div>
              {urlErr && <p style={{ color: "#EF4444", fontSize: 12, marginTop: 6 }}>{urlErr}</p>}
              <button
                onClick={startAudit}
                style={{
                  marginTop: 16, width: "100%", background: "linear-gradient(135deg, #1A3D2B, #0D9488)",
                  color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px",
                  fontSize: 15, fontWeight: 700, cursor: "pointer", letterSpacing: "-0.01em",
                }}
              >
                Run My Free Audit →
              </button>
              <p style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>
                Takes about 30 seconds · No credit card needed
              </p>
            </div>
          )}

          {/* ─ Step 2: Audit Progress ─ */}
          {step === 2 && (
            <div style={{ textAlign: "center" }}>
              <div style={{ marginBottom: 20 }}>
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, #F0FDFA, #CCFBF1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <span style={{ fontSize: 28 }}>🔍</span>
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>Auditing your website…</h3>
                <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>This usually takes 20–30 seconds</p>
              </div>

              {/* Progress bar */}
              <div style={{ background: "#F3F4F6", borderRadius: 8, height: 10, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg, #1A3D2B, #0D9488)", borderRadius: 8, width: `${progress}%`, transition: "width 0.4s ease" }} />
              </div>
              <p style={{ fontSize: 12, color: "#6B7280", fontWeight: 600, marginBottom: 20 }}>{Math.round(progress)}% complete</p>

              {/* Step list */}
              <div style={{ textAlign: "left", background: "#F9FAFB", borderRadius: 12, padding: "14px 16px" }}>
                {AUDIT_STEPS.map((s, i) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                      background: i < stepIdx ? "#0D9488" : i === stepIdx ? "#1A3D2B" : "#E5E7EB",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 0.3s",
                    }}>
                      {i < stepIdx ? (
                        <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>
                      ) : i === stepIdx ? (
                        <div style={{ width: 8, height: 8, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                      ) : null}
                    </div>
                    <span style={{ fontSize: 13, color: i <= stepIdx ? "#111827" : "#9CA3AF", fontWeight: i === stepIdx ? 600 : 400 }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─ Step 3: Results ─ */}
          {step === 3 && (
            <div>
              {/* Score */}
              <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
                <div style={{ flex: 1, background: "linear-gradient(135deg, #F0FDFA, #CCFBF1)", borderRadius: 14, padding: "16px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#0D9488", lineHeight: 1 }}>74</div>
                  <div style={{ fontSize: 11, color: "#0F766E", fontWeight: 600, marginTop: 4 }}>Brand Health Score</div>
                </div>
                <div style={{ flex: 1, background: "linear-gradient(135deg, #FFF7ED, #FED7AA)", borderRadius: 14, padding: "16px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#EA580C", lineHeight: 1 }}>3</div>
                  <div style={{ fontSize: 11, color: "#C2410C", fontWeight: 600, marginTop: 4 }}>Quick Wins Found</div>
                </div>
                <div style={{ flex: 1, background: "linear-gradient(135deg, #F5F3FF, #EDE9FE)", borderRadius: 14, padding: "16px 14px", textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#7C3AED", lineHeight: 1 }}>B+</div>
                  <div style={{ fontSize: 11, color: "#6D28D9", fontWeight: 600, marginTop: 4 }}>Credibility Rating</div>
                </div>
              </div>

              {/* Sample email */}
              <div style={{ border: "1.5px solid #E5E7EB", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
                <div style={{ background: "#1A3D2B", padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600 }}>✉ Sample AI-Written Outreach Email</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "#5EEAD4", fontWeight: 700 }}>PERSONALISED</span>
                </div>
                <div style={{ padding: "14px 16px", background: "#FAFAFA" }}>
                  <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.65, margin: 0 }}>
                    <strong>Subject:</strong> Quick question about your growth plans, {firstName}<br /><br />
                    Hi [Prospect Name],<br /><br />
                    I came across <em>{url || "your company"}</em> and noticed you're doing some great things in your space — but your brand score of <strong>74/100</strong> suggests there are a few quick wins that could meaningfully improve your pipeline.<br /><br />
                    We've helped companies like yours increase qualified meetings by 3× in 90 days using AI-driven prospect auditing and personalised outreach.<br /><br />
                    Worth a 15-minute call this week?<br /><br />
                    — {firstName}
                  </p>
                </div>
              </div>

              <button
                onClick={handleDone}
                disabled={saving}
                style={{
                  width: "100%", background: "linear-gradient(135deg, #1A3D2B, #0D9488)",
                  color: "#fff", border: "none", borderRadius: 12, padding: "13px 20px",
                  fontSize: 15, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : "Add your first prospect to get started →"}
              </button>
              <p style={{ textAlign: "center", fontSize: 11, color: "#9CA3AF", marginTop: 10 }}>
                Your full audit report is waiting in the Audit tab
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function AuthenticatedRouter({ onAuthRefresh }: { onAuthRefresh: () => void }) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Allow the email verification link to be processed even when logged in */}
        <Route path="/verify" component={() => <Verify onSuccess={onAuthRefresh} />} />
        <Route path="/"                   component={() => <Layout><Dashboard /></Layout>} />
        <Route path="/login"              component={() => <RedirectTo to="/" />} />
        <Route path="/register"           component={() => <RedirectTo to="/" />} />
        <Route path="/leads"              component={() => <Layout><Leads /></Layout>} />
        <Route path="/leads/:id"          component={() => <Layout><LeadDetail /></Layout>} />
        <Route path="/icp"                component={() => <Layout><IcpManager /></Layout>} />
        <Route path="/audit"              component={() => <Layout><BrandAudit /></Layout>} />
        <Route path="/qualify"            component={() => <Layout><Qualify /></Layout>} />
        <Route path="/outreach"           component={() => <Layout><Outreach /></Layout>} />
        <Route path="/pipeline"           component={() => <Layout><Pipeline /></Layout>} />
        <Route path="/meetings"           component={() => <Layout><Meetings /></Layout>} />
        <Route path="/hubspot"            component={() => <Layout><HubSpot /></Layout>} />
        <Route path="/sales-brain"        component={() => <Layout><SalesBrain /></Layout>} />
        <Route path="/agents"             component={() => <Layout><Agents /></Layout>} />
        <Route path="/agent-hub"          component={() => <Layout><AgentHub /></Layout>} />
        <Route path="/billing"            component={() => <Layout><Billing /></Layout>} />
        <Route path="/settings"           component={() => <Layout><Settings /></Layout>} />
        <Route path="/audit/share/:token" component={() => <AuditShare />} />
        <Route path="/book"               component={() => <Booking />} />
        <Route path="/campaigns"          component={() => <Layout><Campaigns /></Layout>} />
        <Route path="/automations"        component={() => <RedirectTo to="/agent-hub" />} />
        <Route path="/proposals"          component={() => <Layout><Proposals /></Layout>} />
        <Route path="/registrations"      component={() => <Layout><Registrations /></Layout>} />
        <Route path="/fetch-leads"        component={() => <Layout><FetchLeads /></Layout>} />
        <Route path="/lead-hunter"        component={() => <Layout><LeadHunter /></Layout>} />
        <Route path="/lead-bank"          component={() => <Layout><LeadBank /></Layout>} />
        <Route path="/ai-composer"        component={() => <Layout><AiComposer /></Layout>} />
        <Route path="/signal-feed"        component={() => <Layout><SignalFeed /></Layout>} />
        <Route path="/sales-agent"        component={() => <Layout><SalesAgentControl /></Layout>} />
        <Route path="/play-lab"           component={() => <Layout><PlayLab /></Layout>} />
        <Route path="/play-lab/:id/signals" component={() => <Layout><PlaySignals /></Layout>} />
        <Route path="/play-lab/:id"        component={() => <Layout><PlayDetail /></Layout>} />
        <Route path="/integrations"       component={() => <Layout><Integrations /></Layout>} />
        <Route path="/super-admin"        component={() => <Layout><SuperAdmin /></Layout>} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function UnauthenticatedRouter({ onSuccess }: { onSuccess: () => void }) {
  const [, navigate] = useLocation();

  function handleSuccess() {
    navigate("/");
    onSuccess();
  }

  return (
    <Switch>
      <Route path="/verify" component={() => (
        <Verify onSuccess={handleSuccess} />
      )} />
      <Route path="/invite/:token" component={() => (
        <AcceptInvite />
      )} />
      <Route path="/audit/share/:token" component={() => (
        <AuditShare />
      )} />
      <Route path="/register" component={() => (
        <Register
          onSuccess={handleSuccess}
          onLoginClick={() => navigate("/")}
        />
      )} />
      <Route path="/login" component={() => (
        <Login
          onSuccess={handleSuccess}
          onRegisterClick={() => navigate("/register")}
        />
      )} />
      <Route component={() => (
        <Login
          onSuccess={handleSuccess}
          onRegisterClick={() => navigate("/register")}
        />
      )} />
    </Switch>
  );
}

type AuthState = "checking" | "authenticated" | "unauthenticated";

function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  async function checkAuth() {
    try {
      const res = await fetch(`/api/auth/me`, {
        credentials: "include",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as AuthUser;
        setAuthUser(data);
        setShowOnboarding(data.onboardingCompleted === false);
        setAuth("authenticated");
      } else {
        setAuthUser(null);
        setAuth("unauthenticated");
      }
    } catch {
      setAuthUser(null);
      setAuth("unauthenticated");
    }
  }

  useEffect(() => { checkAuth(); }, []);

  useEffect(() => {
    if (auth !== "authenticated") return;
    const POLL_INTERVAL_MS = 5 * 60 * 1000;
    const id = setInterval(() => { checkAuth(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auth]);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  if (auth === "checking") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #0d2318 0%, #1A3D2B 45%, #12502e 100%)" }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.6)" }}>Loading…</span>
        </div>
      </div>
    );
  }

  if (auth === "unauthenticated") {
    return (
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={base}>
          <UnauthenticatedRouter onSuccess={() => checkAuth()} />
        </WouterRouter>
        <Toaster />
      </QueryClientProvider>
    );
  }

  function updateUser(partial: Partial<AuthUser>) {
    setAuthUser(prev => prev ? { ...prev, ...partial } : prev);
  }

  function handleOnboardingComplete() {
    setShowOnboarding(false);
    updateUser({ onboardingCompleted: true });
  }

  return (
    <AuthContext.Provider value={{ user: authUser, refreshUser: checkAuth, updateUser }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={base}>
            <AuthenticatedRouter onAuthRefresh={checkAuth} />
          </WouterRouter>
          {showOnboarding && authUser && (
            <OnboardingModal user={authUser} onComplete={handleOnboardingComplete} />
          )}
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

export default App;
