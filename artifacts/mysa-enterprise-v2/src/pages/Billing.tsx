import { useState, useEffect } from "react";
import {
  CreditCard, Zap, TrendingUp, Crown, CheckCircle2, XCircle,
  Loader2, Star, AlertTriangle, RefreshCw, ChevronRight,
  Users, BarChart2, Mail, Shield,
} from "lucide-react";
import { usePlan, usePlanPlans, planLabel, planBadgeStyle, formatLimit, type PlanInfo } from "@/hooks/usePlan";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise(resolve => {
    if (document.getElementById("razorpay-script")) { resolve(true); return; }
    const script = document.createElement("script");
    script.id = "razorpay-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function UsageMeter({
  label, icon: Icon, used, max, color,
}: { label: string; icon: React.ElementType; used: number; max: number; color: string }) {
  const isUnlimited = max === -1;
  const pct = isUnlimited ? 0 : Math.min(100, Math.round((used / max) * 100));
  const isWarning = !isUnlimited && pct >= 80;
  const barColor = isWarning ? "#EF4444" : color;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" style={{ color }} />
          <span className="text-xs font-semibold text-gray-700">{label}</span>
        </div>
        <span className="text-xs font-bold tabular-nums" style={{ color: isWarning ? "#EF4444" : "#374151" }}>
          {isUnlimited ? "Unlimited" : `${used.toLocaleString()} / ${max.toLocaleString()}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>
      )}
    </div>
  );
}

const PLAN_ICONS: Record<string, React.ElementType> = {
  solo:   Zap,
  growth: TrendingUp,
  agency: Crown,
};

const PLAN_COLORS: Record<string, { main: string; bg: string; gradient: string }> = {
  solo:   { main: "#3B82F6", bg: "#EFF6FF", gradient: "linear-gradient(135deg,#1D4ED8,#3B82F6)" },
  growth: { main: "#7C3AED", bg: "#F5F3FF", gradient: "linear-gradient(135deg,#4F35A8,#7C3AED)" },
  agency: { main: "#C2410C", bg: "#FFF7ED", gradient: "linear-gradient(135deg,#9A3412,#EA580C)" },
};

function PlanCard({
  plan,
  isCurrent,
  isDowngrade,
  onUpgrade,
  upgrading,
  interval,
  currency,
}: {
  plan: PlanInfo;
  isCurrent: boolean;
  isDowngrade: boolean;
  onUpgrade: (plan: PlanInfo) => void;
  upgrading: boolean;
  interval: "monthly" | "yearly";
  currency: "INR" | "USD";
}) {
  const colors = PLAN_COLORS[plan.key] ?? PLAN_COLORS.solo;
  const Icon = PLAN_ICONS[plan.key] ?? Zap;

  const features = [
    { label: `${formatLimit(plan.leads_max)} leads / month`, enabled: true },
    { label: `${formatLimit(plan.audits_max)} brand audits / month`, enabled: true },
    { label: `${formatLimit(plan.emails_max)} outreach emails / month`, enabled: true },
    { label: `${plan.features.users_max} user seat${plan.features.users_max !== 1 ? "s" : ""}`, enabled: true },
    { label: "AI Scout + Sales agents", enabled: plan.features.sales_brain },
    { label: "WhatsApp API integration", enabled: plan.features.whatsapp_api },
    { label: "HubSpot CRM sync", enabled: plan.features.hubspot_sync },
    { label: "Web data fetch (Apollo)", enabled: plan.features.data_fetch },
    { label: "White-label reports", enabled: plan.features.white_label },
  ];

  const monthlyINR = interval === "yearly" ? Math.round(plan.priceINRYearly / 12) : plan.priceINR;
  const monthlyUSD = Math.round(monthlyINR / 84);

  return (
    <div
      className="rounded-2xl border overflow-hidden relative flex flex-col"
      style={{
        borderColor: plan.highlight ? colors.main : "hsl(220 13% 91%)",
        boxShadow: plan.highlight ? `0 0 0 1.5px ${colors.main}40` : undefined,
      }}
    >
      {plan.highlight && (
        <div className="text-center py-1.5 text-[11px] font-bold text-white" style={{ background: colors.gradient }}>
          ★ Most Popular
        </div>
      )}

      <div className={`p-6 flex-1 flex flex-col`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: colors.bg }}>
            <Icon className="w-4 h-4" style={{ color: colors.main }} />
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm">{plan.name}</div>
            <div className="text-[11px] text-gray-500">{plan.tagline}</div>
          </div>
        </div>

        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-3xl font-black text-gray-900">
            {currency === "USD" ? `$${monthlyUSD}` : `₹${monthlyINR.toLocaleString("en-IN")}`}
          </span>
          <span className="text-sm text-gray-400">/month</span>
        </div>
        <div className="text-[11px] text-gray-400 mb-4">
          {currency === "USD"
            ? <span className="text-blue-500 font-medium">USD pricing — contact us to subscribe</span>
            : interval === "yearly"
            ? <>₹{plan.priceINRYearly.toLocaleString("en-IN")}/year · <span className="text-green-600 font-bold">20% off</span></>
            : <>Or ₹{plan.priceINRYearly.toLocaleString("en-IN")}/year · save 20%</>
          }
        </div>

        <div className="space-y-2 flex-1 mb-5">
          {features.map(f => (
            <div key={f.label} className="flex items-center gap-2">
              {f.enabled
                ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: colors.main }} />
                : <XCircle   className="w-3.5 h-3.5 flex-shrink-0 text-gray-300" />
              }
              <span className={`text-xs ${f.enabled ? "text-gray-600" : "text-gray-400 line-through"}`}>
                {f.label}
              </span>
            </div>
          ))}
        </div>

        {isCurrent ? (
          <div
            className="w-full py-2.5 rounded-xl text-sm font-bold text-center"
            style={{ background: colors.bg, color: colors.main }}
          >
            ✓ Current Plan
          </div>
        ) : isDowngrade ? (
          <button
            disabled
            className="w-full py-2.5 rounded-xl text-sm font-bold text-gray-400 cursor-not-allowed"
            style={{ background: "#F3F4F6" }}
          >
            Downgrade — contact support
          </button>
        ) : currency === "USD" ? (
          <a
            href={`mailto:sales@mysaai.in?subject=${encodeURIComponent(`MysaAI ${plan.name} Plan — USD Pricing`)}&body=${encodeURIComponent(`Hi,\n\nI'd like to subscribe to the MysaAI ${plan.name} plan with USD pricing.\n\nPlease share payment details.\n\nThanks`)}`}
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 flex items-center justify-center gap-2 text-white no-underline"
            style={{ background: colors.gradient, display: "flex" }}
          >
            Contact Us for USD
          </a>
        ) : (
          <button
            onClick={() => onUpgrade(plan)}
            disabled={upgrading}
            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2 text-white"
            style={{ background: colors.gradient }}
          >
            {upgrading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {upgrading ? "Processing…" : `Upgrade to ${plan.name}`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Billing() {
  const { data: planData, isLoading: planLoading, refetch: refetchPlan } = usePlan();
  const { data: plansData, isLoading: plansLoading } = usePlanPlans();
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [currency, setCurrency] = useState<"INR" | "USD">(() => (localStorage.getItem("mysaai_currency") as "INR" | "USD") ?? "INR");
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  useEffect(() => { localStorage.setItem("mysaai_currency", currency); }, [currency]);

  const currentPlanKey = planData?.plan ?? "trial";
  const PLAN_ORDER = ["trial", "solo", "growth", "agency"];

  async function handleUpgrade(plan: PlanInfo) {
    setErrorMsg(null);
    setSuccessMsg(null);
    setUpgrading(plan.key);

    try {
      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error("Failed to load Razorpay checkout. Please check your internet connection.");

      const razorpayKeyId = plansData?.razorpayKeyId;
      if (!razorpayKeyId) {
        setErrorMsg("Razorpay is not configured yet. Please contact support.");
        setUpgrading(null);
        return;
      }

      const orderRes = await fetch(`${BASE}/api/billing/razorpay/create-order`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey: plan.key, interval: billingInterval }),
      });

      const order = await orderRes.json() as { id?: string; amount?: number; currency?: string; error?: string };
      if (!orderRes.ok || order.error) throw new Error(order.error ?? "Failed to create order");

      await new Promise<void>((resolve, reject) => {
        const rzp = new window.Razorpay({
          key: razorpayKeyId,
          amount: order.amount,
          currency: order.currency ?? "INR",
          name: "MysaAI",
          description: `${plan.name} Plan — ${billingInterval === "yearly" ? "Annual" : "Monthly"}`,
          order_id: order.id,
          theme: { color: "#7C3AED" },
          prefill: {},
          handler: async (response: Record<string, string>) => {
            try {
              const verifyRes = await fetch(`${BASE}/api/billing/razorpay/verify`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  orderId:   response["razorpay_order_id"],
                  paymentId: response["razorpay_payment_id"],
                  signature: response["razorpay_signature"],
                  planKey:   plan.key,
                }),
              });
              const verifyData = await verifyRes.json() as { success?: boolean; error?: string };
              if (!verifyRes.ok || !verifyData.success) throw new Error(verifyData.error ?? "Payment verification failed");

              await qc.invalidateQueries({ queryKey: ["billing-current-plan"] });
              setSuccessMsg(`🎉 You're now on the ${plan.name} plan! Redirecting…`);
              setTimeout(() => navigate("/?upgraded=true"), 1800);
              resolve();
            } catch (err) {
              reject(err);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("dismissed")),
          },
        });
        rzp.open();
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== "dismissed") setErrorMsg(msg);
    } finally {
      setUpgrading(null);
    }
  }

  const planBadge = planBadgeStyle(currentPlanKey);
  const trialDaysLeft = planData?.trialDaysLeft ?? 0;
  const isTrialExpired = planData?.trialExpired ?? false;
  const isTrialPlan = currentPlanKey === "trial";

  const plans = plansData?.plans ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#4F35A8,#7C3AED)" }}>
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Billing & Subscription</h1>
        </div>
        <p className="text-sm text-gray-500 ml-11.5">Manage your MysaAI plan, usage, and payments.</p>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-sm font-medium text-green-800">{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="text-sm font-medium text-red-800">{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Current plan + usage */}
      {planLoading ? (
        <div className="rounded-2xl border p-6 flex items-center gap-3" style={{ borderColor: "hsl(220 13% 91%)" }}>
          <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
          <span className="text-sm text-gray-500">Loading plan details…</span>
        </div>
      ) : planData ? (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(220 13% 91%)" }}>
          <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "hsl(220 13% 91%)" }}>
            <div className="flex items-center gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">Current Plan</span>
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: planBadge.bg, color: planBadge.text, border: `1px solid ${planBadge.border}` }}
                  >
                    {planLabel(currentPlanKey)}
                  </span>
                </div>
                {isTrialPlan && !isTrialExpired && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    {trialDaysLeft > 0 ? `${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""} remaining in your free trial` : "Trial ends today"}
                  </p>
                )}
                {isTrialExpired && (
                  <p className="text-xs text-red-600 font-medium mt-0.5">Your trial has expired — upgrade to continue</p>
                )}
                {!isTrialPlan && planData.currentPeriodEnd && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Renews {new Date(planData.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={() => { void refetchPlan(); }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="px-6 py-5">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">This Month's Usage</div>
            <div className="space-y-4">
              <UsageMeter label="Leads" icon={Users} used={planData.usage.leads.used} max={planData.usage.leads.max} color="#3B82F6" />
              <UsageMeter label="Brand Audits" icon={BarChart2} used={planData.usage.audits.used} max={planData.usage.audits.max} color="#7C3AED" />
              <UsageMeter label="Outreach Emails" icon={Mail} used={planData.usage.emails.used} max={planData.usage.emails.max} color="#10B981" />
            </div>
          </div>
        </div>
      ) : null}

      {isTrialExpired && (
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "linear-gradient(135deg, #FEF3C7, #FFFBEB)", border: "1px solid #FDE68A" }}
        >
          <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-bold text-amber-900">Your trial has ended</div>
            <p className="text-xs text-amber-700 mt-0.5">Choose a plan below to continue using MysaAI. All your data is still safe.</p>
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="text-sm font-bold text-gray-900">Choose a Plan</div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#F3F4F6" }}>
              <button
                onClick={() => setCurrency("INR")}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={currency === "INR"
                  ? { background: "#fff", color: "#1F2937", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#6B7280" }}
              >
                ₹ INR
              </button>
              <button
                onClick={() => setCurrency("USD")}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={currency === "USD"
                  ? { background: "#fff", color: "#1F2937", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#6B7280" }}
              >
                $ USD
              </button>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#F3F4F6" }}>
              <button
                onClick={() => setBillingInterval("monthly")}
                className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                style={billingInterval === "monthly"
                  ? { background: "#fff", color: "#1F2937", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#6B7280" }}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval("yearly")}
                className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5"
                style={billingInterval === "yearly"
                  ? { background: "#fff", color: "#1F2937", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#6B7280" }}
              >
                Annual <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full">Save 20%</span>
              </button>
            </div>
          </div>
        </div>
        {plansLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading plans…
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {plans.map(plan => {
              const currentIdx = PLAN_ORDER.indexOf(currentPlanKey);
              const planIdx    = PLAN_ORDER.indexOf(plan.key);
              return (
                <PlanCard
                  key={plan.key}
                  plan={plan}
                  isCurrent={plan.key === currentPlanKey && !isTrialPlan}
                  isDowngrade={planIdx < currentIdx && !isTrialPlan}
                  onUpgrade={handleUpgrade}
                  upgrading={upgrading === plan.key}
                  interval={billingInterval}
                  currency={currency}
                />
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-gray-400">
        All prices are in Indian Rupees (₹) and exclusive of GST (18%). Payments are processed securely via Razorpay.
        Annual billing saves 20%. Contact{" "}
        <a href="mailto:support@mysaai.in" className="underline hover:text-gray-600">support@mysaai.in</a>{" "}
        to switch plans or for invoicing.
      </p>

      <div className="rounded-2xl overflow-hidden" style={{ background: "linear-gradient(135deg, #0A0818 0%, #1A1040 100%)", border: "1px solid #2D1F5E" }}>
        <div className="p-6">
          <div className="text-sm font-bold text-white mb-1 flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-400" />
            Included in every plan
          </div>
          <p className="text-[12px] mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>
            Every MysaAI subscriber gets these core features out of the box.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              "AI Brand Audit Engine",
              "BANT + Belief Lead Scoring",
              "AI Outreach Email Generator",
              "Pipeline Management",
              "Daily Sales Reports (08:30 IST)",
              "Brevo Email Delivery",
              "WhatsApp Conversation Tracking",
              "SSL + SOC2-ready infrastructure",
              "7-day free trial, no card needed",
            ].map(f => (
              <div key={f} className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.65)" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <Shield className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Payments are encrypted and processed by Razorpay. MysaAI never stores your card details.</span>
      </div>
    </div>
  );
}
