import { useState, useEffect, lazy, Suspense } from "react";
import { AuthContext } from "@/contexts/AuthContext";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";

const Dashboard         = lazy(() => import("@/pages/Dashboard"));
const Leads             = lazy(() => import("@/pages/Leads"));
const LeadDetail        = lazy(() => import("@/pages/LeadDetail"));
const IcpManager        = lazy(() => import("@/pages/IcpManager"));
const BrandAudit        = lazy(() => import("@/pages/BrandAudit"));
const Qualify           = lazy(() => import("@/pages/Qualify"));
const Outreach          = lazy(() => import("@/pages/Outreach"));
const Meetings          = lazy(() => import("@/pages/Meetings"));
const Proposals         = lazy(() => import("@/pages/Proposals"));
const AiComposer        = lazy(() => import("@/pages/AiComposer"));
const Settings          = lazy(() => import("@/pages/Settings"));
const LeadBank          = lazy(() => import("@/pages/LeadBank"));
const AuditShare        = lazy(() => import("@/pages/AuditShare"));
const Pipeline          = lazy(() => import("@/pages/Pipeline"));
const Booking           = lazy(() => import("@/pages/Booking"));
const HubSpot           = lazy(() => import("@/pages/HubSpot"));
const SalesBrain        = lazy(() => import("@/pages/SalesBrain"));
const Campaigns         = lazy(() => import("@/pages/Campaigns"));
const Automations       = lazy(() => import("@/pages/Automations"));
const Agents            = lazy(() => import("@/pages/Agents"));
const LeadHunter        = lazy(() => import("@/pages/LeadHunter"));
const SalesAgentControl = lazy(() => import("@/pages/SalesAgentControl"));
const SuperAdmin        = lazy(() => import("@/pages/SuperAdmin"));
const UsersPage         = lazy(() => import("@/pages/Users"));
const Billing           = lazy(() => import("@/pages/Billing"));
const Integrations      = lazy(() => import("@/pages/Integrations"));
const Registrations     = lazy(() => import("@/pages/Registrations"));
const ApiUsage          = lazy(() => import("@/pages/ApiUsage"));
const NotFound          = lazy(() => import("@/pages/not-found"));

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

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/"                    component={() => <Layout><Dashboard /></Layout>} />
        <Route path="/lead-bank"           component={() => <Layout><LeadBank /></Layout>} />
        <Route path="/leads"               component={() => <Layout><Leads /></Layout>} />
        <Route path="/leads/:id"           component={() => <Layout><LeadDetail /></Layout>} />
        <Route path="/icp"                 component={() => <Layout><IcpManager /></Layout>} />
        <Route path="/pipeline"            component={() => <Layout><Pipeline /></Layout>} />
        <Route path="/audit"               component={() => <Layout><BrandAudit /></Layout>} />
        <Route path="/qualify"             component={() => <Layout><Qualify /></Layout>} />
        <Route path="/outreach"            component={() => <Layout><Outreach /></Layout>} />
        <Route path="/meetings"            component={() => <Layout><Meetings /></Layout>} />
        <Route path="/proposals"           component={() => <Layout><Proposals /></Layout>} />
        <Route path="/ai-composer"         component={() => <Layout><AiComposer /></Layout>} />
        <Route path="/settings"            component={() => <Layout><Settings /></Layout>} />
        <Route path="/audit/share/:token"  component={() => <AuditShare />} />
        <Route path="/book"                component={() => <Booking />} />
        <Route path="/hubspot"             component={() => <Layout><HubSpot /></Layout>} />
        <Route path="/sales-brain"         component={() => <Layout><SalesBrain /></Layout>} />
        <Route path="/campaigns"           component={() => <Layout><Campaigns /></Layout>} />
        <Route path="/automations"         component={() => <Layout><Automations /></Layout>} />
        <Route path="/agents"              component={() => <Layout><Agents /></Layout>} />
        <Route path="/agents/lead-hunter"  component={() => <Layout><LeadHunter /></Layout>} />
        <Route path="/agents/control"      component={() => <Layout><SalesAgentControl /></Layout>} />
        <Route path="/users"               component={() => <Layout><UsersPage /></Layout>} />
        <Route path="/super-admin"         component={() => <Layout><SuperAdmin /></Layout>} />
        <Route path="/feedback"            component={() => <Layout><SuperAdmin initialTab="feedback" /></Layout>} />
        <Route path="/api-usage"           component={() => <Layout><ApiUsage /></Layout>} />
        <Route path="/billing"             component={() => <Layout><Billing /></Layout>} />
        <Route path="/integrations"        component={() => <Layout><Integrations /></Layout>} />
        <Route path="/registrations"       component={() => <Layout><Registrations /></Layout>} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

type AuthState = "checking" | "authenticated" | "unauthenticated";

function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  async function checkAuth() {
    try {
      const res = await fetch(`/api/auth/me`, {
        credentials: "include",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as { email?: string };
        setUserEmail(data.email ?? null);
        setAuth("authenticated");
      } else {
        setAuth("unauthenticated");
      }
    } catch {
      setAuth("unauthenticated");
    }
  }

  useEffect(() => { checkAuth(); }, []);

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
        <Login onSuccess={() => checkAuth()} />
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <AuthContext.Provider value={userEmail ? { email: userEmail } : null}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

export default App;
