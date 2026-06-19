import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle, XCircle, Clock, Lock } from "lucide-react";

const GRAD = "linear-gradient(135deg, #1A3D2B 0%, #5C1A8C 100%)";

interface VerifyProps {
  onSuccess: () => void;
}

export default function Verify({ onSuccess }: VerifyProps) {
  const [status, setStatus]         = useState<"checking" | "success" | "error" | "expired">("checking");
  const [errorMsg, setErrorMsg]     = useState("");
  const [userEmail, setUserEmail]   = useState("");
  const [resent, setResent]         = useState(false);
  const [resending, setResending]   = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get("token");

    if (!token) {
      setStatus("error");
      setErrorMsg("No verification token found. Please check your email and click the link again.");
      return;
    }

    fetch("/api/auth/verify-email", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ token }),
    })
      .then(async res => {
        const data = await res.json() as {
          ok?: boolean; error?: string; expired?: boolean; email?: string; needsPassword?: boolean;
        };
        if (res.ok) {
          setStatus("success");
          if (data.needsPassword) {
            setNeedsPassword(true);
            setTimeout(() => { onSuccess(); navigate("/settings?tab=profile"); }, 2800);
          } else {
            setTimeout(() => { onSuccess(); navigate("/"); }, 1800);
          }
        } else if (res.status === 410 || data.expired) {
          setStatus("expired");
          setUserEmail(data.email ?? "");
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Verification failed. Please request a new link.");
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg("Connection error. Please check your internet and try again.");
      });
  }, []);

  async function handleResend() {
    if (!userEmail || resent) return;
    setResending(true);
    try {
      await fetch(`/api/auth/trigger-resend?email=${encodeURIComponent(userEmail)}`);
    } catch {
      // ignore
    } finally {
      setResent(true);
      setResending(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#F5F3FF", fontFamily: "'Inter', -apple-system, sans-serif" }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-base"
            style={{ background: GRAD }}
          >
            ⚡
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.025em" }}>
            Mysa AI
          </span>
        </div>

        <div className="rounded-2xl p-8 shadow-sm" style={{ background: "#fff", border: "1px solid #EDE9FE" }}>

          {status === "checking" && (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#F5F3FF" }}>
                <Loader2 className="w-7 h-7 animate-spin" style={{ color: "#7C3AED" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
                Verifying your email…
              </h1>
              <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
                Please wait while we verify your account.
              </p>
            </>
          )}

          {status === "success" && !needsPassword && (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#D1FAE5" }}>
                <CheckCircle className="w-7 h-7" style={{ color: "#059669" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
                Email verified!
              </h1>
              <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>
                Your account is active. Taking you to the dashboard…
              </p>
            </>
          )}

          {status === "success" && needsPassword && (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#D1FAE5" }}>
                <CheckCircle className="w-7 h-7" style={{ color: "#059669" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
                Email verified!
              </h1>
              <div
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  background: "#F0FDF4", border: "1px solid #BBF7D0",
                  borderRadius: 12, padding: "12px 14px", marginBottom: 16, textAlign: "left",
                }}
              >
                <Lock size={16} style={{ color: "#16a34a", flexShrink: 0, marginTop: 2 }} />
                <p style={{ fontSize: 13, color: "#15803d", lineHeight: 1.6, margin: 0 }}>
                  <strong>One more step:</strong> set a password so you can also sign in with your email. Taking you to Settings…
                </p>
              </div>
            </>
          )}

          {status === "expired" && (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#FEF3C7" }}>
                <Clock className="w-7 h-7" style={{ color: "#D97706" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
                Link expired
              </h1>
              <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6, marginBottom: 24 }}>
                This link is only valid for 24 hours. Click below to get a fresh one sent to your inbox.
              </p>
              {resent ? (
                <div style={{ fontSize: 13, color: "#059669", background: "#D1FAE5", padding: "10px 16px", borderRadius: 12, fontWeight: 600 }}>
                  Fresh link sent! Check your inbox.
                </div>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 12, border: "none",
                    background: resending ? "#9CA3AF" : GRAD,
                    color: "white", fontSize: 14, fontWeight: 700,
                    cursor: resending ? "not-allowed" : "pointer",
                  }}
                >
                  {resending ? "Sending…" : "Send a new link"}
                </button>
              )}
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#FEE2E2" }}>
                <XCircle className="w-7 h-7" style={{ color: "#DC2626" }} />
              </div>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>
                Verification failed
              </h1>
              <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6, marginBottom: 24 }}>
                {errorMsg}
              </p>
              <button
                onClick={() => navigate("/")}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 12, border: "none",
                  background: GRAD, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
