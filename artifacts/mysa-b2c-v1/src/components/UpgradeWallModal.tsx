import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { PlanLimitDetail } from "@/lib/fetchGuard";

const RESOURCE_LABELS: Record<string, string> = {
  leads: "Leads",
  audits: "Brand Audits",
  emails: "Outreach Emails",
};

const RESOURCE_ICONS: Record<string, string> = {
  leads: "👥",
  audits: "🔍",
  emails: "✉️",
};

function resourceLabel(detail: PlanLimitDetail): string {
  if (detail.resource) return RESOURCE_LABELS[detail.resource] ?? detail.resource;
  if (detail.feature) return detail.feature.replace(/_/g, " ");
  return "this feature";
}

function resourceIcon(detail: PlanLimitDetail): string {
  if (detail.resource) return RESOURCE_ICONS[detail.resource] ?? "🚫";
  return "⚡";
}

function isTrialExpired(detail: PlanLimitDetail): boolean {
  return detail.errorCode === "TRIAL_EXPIRED";
}

function sessionKey(detail: PlanLimitDetail): string {
  return `upgrade-wall-seen:${detail.resource ?? detail.feature ?? detail.errorCode}`;
}

function hasSeenWall(detail: PlanLimitDetail): boolean {
  try {
    return sessionStorage.getItem(sessionKey(detail)) === "1";
  } catch {
    return false;
  }
}

function markWallSeen(detail: PlanLimitDetail): void {
  try {
    sessionStorage.setItem(sessionKey(detail), "1");
  } catch {
    // sessionStorage unavailable — degrade gracefully
  }
}

export function UpgradeWallModal() {
  const [detail, setDetail] = useState<PlanLimitDetail | null>(null);
  const [toast, setToast] = useState<PlanLimitDetail | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [location, navigate] = useLocation();

  useEffect(() => {
    function handler(e: CustomEvent<PlanLimitDetail>) {
      if (location === "/billing") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (hasSeenWall(e.detail)) {
        // Already showed the full modal this session — use a toast instead
        setToast(e.detail);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 5000);
        return;
      }

      setDetail(e.detail);
    }

    window.addEventListener("plan-limit-hit", handler);
    return () => {
      window.removeEventListener("plan-limit-hit", handler);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, [location]);

  function dismiss() {
    if (detail) markWallSeen(detail);
    setDetail(null);
  }

  function goToBilling() {
    if (detail) markWallSeen(detail);
    setDetail(null);
    navigate("/billing");
  }

  function dismissToast() {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  }

  function goToBillingFromToast() {
    setToast(null);
    navigate("/billing");
  }

  return (
    <>
      {/* Lightweight repeat-attempt toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 10001,
            background: "#1F2937",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            maxWidth: 360,
            animation: "slideUp 0.2s ease",
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>{resourceIcon(toast)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
              {isTrialExpired(toast)
                ? "Trial has ended"
                : `${resourceLabel(toast)} limit reached`}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>
              {toast.message}
            </p>
          </div>
          <button
            onClick={goToBillingFromToast}
            style={{
              flexShrink: 0,
              background: "#0D9488",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Upgrade
          </button>
          <button
            onClick={dismissToast}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Full-screen upgrade wall modal (first time per resource per session) */}
      {detail && (
        <div
          onClick={dismiss}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 20,
              width: "100%",
              maxWidth: 460,
              boxShadow: "0 32px 80px rgba(0,0,0,0.24)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                background: isTrialExpired(detail)
                  ? "linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)"
                  : "linear-gradient(135deg, #7f1d1d 0%, #dc2626 100%)",
                padding: "24px 24px 20px",
                position: "relative",
              }}
            >
              <button
                onClick={dismiss}
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  background: "rgba(255,255,255,0.15)",
                  border: "none",
                  borderRadius: "50%",
                  width: 28,
                  height: 28,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: "#fff",
                  fontSize: 16,
                  lineHeight: 1,
                }}
                aria-label="Dismiss"
              >
                ×
              </button>

              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  marginBottom: 12,
                }}
              >
                {resourceIcon(detail)}
              </div>

              <h2
                style={{
                  color: "#fff",
                  fontSize: 20,
                  fontWeight: 800,
                  margin: "0 0 6px",
                  lineHeight: 1.2,
                }}
              >
                {isTrialExpired(detail) ? "Your free trial has ended" : `${resourceLabel(detail)} limit reached`}
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 13,
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {isTrialExpired(detail)
                  ? "Your 7-day free trial has expired. Upgrade to a paid plan to continue using MysaAI."
                  : `You've used all your ${resourceLabel(detail).toLowerCase()} for this billing period.`}
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: "20px 24px 24px" }}>
              {/* What was blocked */}
              <div
                style={{
                  background: "#FEF2F2",
                  border: "1.5px solid #FECACA",
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 20,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 16, marginTop: 1 }}>🛑</span>
                <div>
                  <p style={{ fontSize: 13, color: "#991B1B", fontWeight: 600, margin: "0 0 2px" }}>
                    Action blocked
                  </p>
                  <p style={{ fontSize: 12, color: "#B91C1C", margin: 0, lineHeight: 1.5 }}>
                    {detail.message}
                  </p>
                </div>
              </div>

              {/* What they get on upgrade */}
              <div
                style={{
                  background: "#F0FDF4",
                  border: "1.5px solid #BBF7D0",
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 20,
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#166534",
                    margin: "0 0 8px",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Upgrading gives you
                </p>
                {[
                  "Higher monthly limits for leads, audits & emails",
                  "Access to autopilot agents and WhatsApp integration",
                  "Priority support and advanced analytics",
                ].map(item => (
                  <div
                    key={item}
                    style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                  >
                    <div
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        background: "#16A34A",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#15803D" }}>{item}</span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={goToBilling}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #1A3D2B 0%, #0D9488 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "13px 20px",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: "pointer",
                  letterSpacing: "-0.01em",
                  marginBottom: 10,
                }}
              >
                View Plans &amp; Upgrade →
              </button>

              <button
                onClick={dismiss}
                style={{
                  width: "100%",
                  background: "transparent",
                  color: "#6B7280",
                  border: "1.5px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "11px 20px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
