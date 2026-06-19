import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Loader2, CheckCircle, XCircle, Users, Eye, EyeOff } from "lucide-react";

interface InviteInfo {
  email:   string;
  role:    string;
  orgName: string;
}

export default function AcceptInvite() {
  const params = useParams<{ token: string }>();
  const token  = params.token ?? "";
  const [, navigate] = useLocation();

  const [loading,     setLoading]     = useState(true);
  const [inviteInfo,  setInviteInfo]  = useState<InviteInfo | null>(null);
  const [inviteError, setInviteError] = useState("");

  const [firstName,  setFirstName]  = useState("");
  const [lastName,   setLastName]   = useState("");
  const [password,   setPassword]   = useState("");
  const [confirmPw,  setConfirmPw]  = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState("");
  const [done,       setDone]       = useState(false);

  useEffect(() => {
    if (!token) { setInviteError("Invalid invitation link"); setLoading(false); return; }
    fetch(`/api/team/invite/${token}`)
      .then(async r => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({})) as { error?: string };
          setInviteError(d.error ?? "Invalid or expired invitation");
        } else {
          setInviteInfo(await r.json() as InviteInfo);
        }
      })
      .catch(() => setInviteError("Could not load invitation"))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitErr("");
    if (password.length < 8) { setSubmitErr("Password must be at least 8 characters"); return; }
    if (password !== confirmPw) { setSubmitErr("Passwords do not match"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/team/accept-invite", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, firstName: firstName.trim(), lastName: lastName.trim(), password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setSubmitErr(d.error ?? "Failed to create account");
      } else {
        setDone(true);
        setTimeout(() => navigate("/"), 2000);
      }
    } catch { setSubmitErr("Network error"); }
    finally { setSubmitting(false); }
  }

  const inputClass = "w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors";
  const labelClass = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(135deg, #0d2318 0%, #1A3D2B 45%, #12502e 100%)" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ background: "rgba(255,255,255,0.12)" }}>
            <Users className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Join your team</h1>
          <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.6)" }}>
            Create your account to get started
          </p>
        </div>

        <div className="rounded-2xl bg-white shadow-xl p-8">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <p className="text-sm text-gray-400">Verifying invitation…</p>
            </div>
          )}

          {!loading && inviteError && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <XCircle className="w-10 h-10 text-red-400" />
              <p className="text-sm font-medium text-gray-900">{inviteError}</p>
              <p className="text-xs text-gray-400">
                Ask your team to send a new invitation, or{" "}
                <a href="/" className="text-teal-600 hover:underline">log in</a> if you already have an account.
              </p>
            </div>
          )}

          {!loading && done && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-500" />
              <p className="text-sm font-semibold text-gray-900">Account created!</p>
              <p className="text-xs text-gray-400">Redirecting to your dashboard…</p>
            </div>
          )}

          {!loading && inviteInfo && !done && (
            <>
              <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3 mb-6">
                <p className="text-xs text-teal-800">
                  You've been invited to join <strong>{inviteInfo.orgName}</strong> as a{" "}
                  <strong className="capitalize">{inviteInfo.role}</strong>.
                </p>
                <p className="text-[11px] text-teal-600 mt-0.5">{inviteInfo.email}</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>First name</label>
                    <input
                      type="text" className={inputClass} required
                      value={firstName} onChange={e => setFirstName(e.target.value)}
                      placeholder="Jane" autoFocus
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Last name</label>
                    <input
                      type="text" className={inputClass} required
                      value={lastName} onChange={e => setLastName(e.target.value)}
                      placeholder="Smith"
                    />
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Email address</label>
                  <input
                    type="email" value={inviteInfo.email} readOnly disabled
                    className={inputClass + " bg-gray-50 cursor-not-allowed opacity-70"}
                  />
                </div>

                <div>
                  <label className={labelClass}>Password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      className={inputClass + " pr-9"}
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Confirm password</label>
                  <input
                    type={showPw ? "text" : "password"}
                    className={inputClass}
                    required
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    style={{ borderColor: confirmPw && confirmPw !== password ? "#EF4444" : undefined }}
                  />
                  {confirmPw && confirmPw !== password && (
                    <p className="mt-1 text-[11px] text-red-500">Passwords do not match</p>
                  )}
                </div>

                {submitErr && (
                  <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {submitErr}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-colors"
                  style={{ background: "#1A3D2B" }}
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  {submitting ? "Creating account…" : "Accept invitation"}
                </button>

                <p className="text-center text-[11px] text-gray-400">
                  Already have an account?{" "}
                  <a href="/" className="text-teal-600 hover:underline">Log in</a>
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
