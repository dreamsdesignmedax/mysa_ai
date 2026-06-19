import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LoginProps {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: LoginProps) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || "Invalid email or password");
      } else {
        onSuccess();
      }
    } catch {
      setError("Connection error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "linear-gradient(135deg, #0d2318 0%, #1A3D2B 45%, #12502e 100%)" }}
    >
      {/* Card */}
      <div
        className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "#ffffff" }}
      >
        {/* Header */}
        <div
          className="px-8 py-8 text-center"
          style={{ background: "linear-gradient(135deg, #1A3D2B, #12502e)" }}
        >
          {/* Logo mark */}
          <div className="flex justify-center mb-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              <Zap className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-[22px] font-bold text-white leading-tight">Mysa AI</h1>
          <p className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.65)" }}>
            Sales Automation Platform
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-4">
          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 rounded-lg text-[14px] outline-none transition-all"
              style={{
                border: "1.5px solid #D1D5DB",
                color: "#111827",
                background: "#F9FAFB",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "#1A3D2B")}
              onBlur={e  => (e.currentTarget.style.borderColor = "#D1D5DB")}
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold mb-1.5" style={{ color: "#374151" }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 pr-10 rounded-lg text-[14px] outline-none transition-all"
                style={{
                  border: "1.5px solid #D1D5DB",
                  color: "#111827",
                  background: "#F9FAFB",
                }}
                onFocus={e => (e.currentTarget.style.borderColor = "#1A3D2B")}
                onBlur={e  => (e.currentTarget.style.borderColor = "#D1D5DB")}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: "#9CA3AF" }}
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div
              className="text-[12px] px-3 py-2 rounded-lg"
              style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-[14px] font-semibold text-white transition-all mt-1"
            style={{
              background: loading ? "#6B7280" : "#1A3D2B",
              cursor: loading ? "not-allowed" : "pointer",
            }}
            onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#12502e"; }}
            onMouseLeave={e => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = "#1A3D2B"; }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Footer */}
        <div
          className="px-8 pb-6 text-center text-[11px]"
          style={{ color: "#9CA3AF" }}
        >
          Dreamsdesign · Mysa AI v1.0
        </div>
      </div>

      <p className="mt-6 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
        Secure access — authorised users only
      </p>
    </div>
  );
}
