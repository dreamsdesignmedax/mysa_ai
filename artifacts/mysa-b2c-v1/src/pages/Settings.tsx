import { useState, useEffect, useRef, type FormEvent } from "react";
import { useGetBrandingSettings } from "@workspace/api-client-react";
import {
  User, Building2, Mail, MessageCircle, Link2,
  CheckCircle, XCircle, Loader2, Save, Palette, Upload, X, Send, Eye,
  Lock, Globe, Phone, Smartphone, AlertCircle, ExternalLink,
  Users, UserPlus, Shield, UserX, Trash2, MoreVertical, ChevronDown,
  ChevronLeft, Zap, Brain,
} from "lucide-react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { getFirebaseAuth, firebaseConfigured } from "../lib/firebase";
import { useAuthUser, useUpdateUser, useRefreshUser } from "@/contexts/AuthContext";

type Tab = "profile" | "company" | "email" | "whatsapp" | "integrations" | "team" | "ai";

const ALL_TABS: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean; ownerOnly?: boolean }[] = [
  { id: "profile",      label: "Profile",      icon: User },
  { id: "company",      label: "Company",      icon: Building2 },
  { id: "email",        label: "Email",        icon: Mail,          adminOnly: true },
  { id: "whatsapp",     label: "WhatsApp",     icon: MessageCircle, adminOnly: true },
  { id: "integrations", label: "Integrations", icon: Link2 },
  { id: "team",         label: "Team",         icon: Users },
  { id: "ai",           label: "AI Models",    icon: Brain,         ownerOnly: true },
];

const inputClass = "w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors";
const labelClass = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

function useExpiryCountdown(expiresAt: string | null | undefined): { expired: boolean; label: string | null } {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!expiresAt) return;
    const expiry = new Date(expiresAt);
    if (expiry <= new Date()) return;
    const id = setInterval(() => {
      const current = new Date();
      setNow(current);
      if (current >= expiry) clearInterval(id);
    }, 30_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (!expiresAt) return { expired: false, label: null };

  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) return { expired: true, label: null };

  const totalMinutes = Math.ceil(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return { expired: false, label };
}

function SectionCard({ title, subtitle, icon: Icon, iconBg, iconColor, children }: {
  title: string; subtitle?: string; icon: React.ElementType; iconBg: string; iconColor: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          <Icon className="w-4 h-4" style={{ color: iconColor }} />
        </div>
        <div>
          <div className="text-sm font-semibold text-gray-900">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-400">{subtitle}</div>}
        </div>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function SaveButton({ pending, success, label = "Save changes" }: { pending: boolean; success?: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
      style={{ background: success ? "#16a34a" : "#1A3D2B" }}
    >
      {pending
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : success
          ? <CheckCircle className="w-3.5 h-3.5" />
          : <Save className="w-3.5 h-3.5" />}
      {success ? "Saved!" : label}
    </button>
  );
}

// ── Profile Name Form ──────────────────────────────────────────────────────────
function ProfileNameForm() {
  const authUser    = useAuthUser();
  const updateUser  = useUpdateUser();
  const refreshUser = useRefreshUser();

  const isPhoneUser = (authUser?.email ?? "").endsWith("@otp.mysa.internal");

  const [firstName,       setFirstName]       = useState(authUser?.firstName ?? "");
  const [lastName,        setLastName]        = useState(authUser?.lastName ?? "");
  const [newEmail,        setNewEmail]        = useState("");
  const [profileSave,     setProfileSave]     = useState(false);
  const [profileErr,      setProfileErr]      = useState("");
  const [profilePend,     setProfilePend]     = useState(false);
  const [emailSentNotice, setEmailSentNotice] = useState("");
  const [resendPend,      setResendPend]      = useState(false);
  const [resendMsg,       setResendMsg]       = useState("");
  const [resendErr,       setResendErr]       = useState("");
  const [resendCooldown,  setResendCooldown]  = useState(0);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { expired: linkExpired, label: expiryLabel } = useExpiryCountdown(authUser?.pendingEmailTokenExpiresAt);

  const committedFirst = useRef(authUser?.firstName ?? "");
  const committedLast  = useRef(authUser?.lastName ?? "");

  useEffect(() => {
    const newFirst = authUser?.firstName ?? "";
    const newLast  = authUser?.lastName ?? "";
    if (firstName === committedFirst.current && newFirst !== committedFirst.current) {
      setFirstName(newFirst);
    }
    if (lastName === committedLast.current && newLast !== committedLast.current) {
      setLastName(newLast);
    }
    committedFirst.current = newFirst;
    committedLast.current  = newLast;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.firstName, authUser?.lastName]);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  function startResendCooldown(seconds: number) {
    setResendCooldown(seconds);
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    resendTimerRef.current = setInterval(() => {
      setResendCooldown(s => {
        if (s <= 1) { clearInterval(resendTimerRef.current!); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  async function handleResendPendingEmail(e: React.MouseEvent) {
    e.preventDefault();
    setResendErr(""); setResendMsg(""); setResendPend(true);
    try {
      const res = await fetch("/api/auth/resend-pending-email", {
        method: "POST",
        credentials: "include",
      });
      const d = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; secondsLeft?: number };
      if (!res.ok) {
        setResendErr(d.error || "Failed to resend. Please try again.");
        if (res.status === 429 && d.secondsLeft) startResendCooldown(d.secondsLeft);
      } else {
        setResendMsg("Verification email resent! Check your inbox.");
        startResendCooldown(60);
        await refreshUser();
      }
    } catch { setResendErr("Network error. Please try again."); }
    finally { setResendPend(false); }
  }

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setProfileErr(""); setProfileSave(false); setEmailSentNotice(""); setProfilePend(true);
    const trimmedFirst = firstName.trim();
    const trimmedLast  = lastName.trim();
    const trimmedEmail = newEmail.trim();

    const body: Record<string, string> = { firstName: trimmedFirst, lastName: trimmedLast };
    if (isPhoneUser && trimmedEmail) body.email = trimmedEmail;

    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setProfileErr((d as { error?: string }).error || "Failed to save");
      } else {
        const d = await res.json().catch(() => ({})) as { verificationEmailSent?: boolean; pendingEmail?: string | null };
        committedFirst.current = trimmedFirst;
        committedLast.current  = trimmedLast;
        if (d.verificationEmailSent) {
          setNewEmail("");
          updateUser({ firstName: trimmedFirst, lastName: trimmedLast, pendingEmail: d.pendingEmail ?? trimmedEmail });
          setEmailSentNotice(`Verification email sent to ${d.pendingEmail ?? trimmedEmail}. Check your inbox to confirm it.`);
        } else {
          updateUser({ firstName: trimmedFirst, lastName: trimmedLast });
          setProfileSave(true);
          setTimeout(() => setProfileSave(false), 3000);
        }
      }
    } catch { setProfileErr("Network error"); }
    finally { setProfilePend(false); }
  }

  const avatarInitials = ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || (authUser?.email?.[0]?.toUpperCase() ?? "?");

  return (
    <SectionCard title="Personal Information" subtitle="Update your name and profile details" icon={User} iconBg="#F0FDF4" iconColor="#1A7A45">
      <form onSubmit={handleProfileSave} className="space-y-4">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #1A3D2B, #5C1A8C)" }}
          >
            {avatarInitials}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {firstName || lastName ? `${firstName} ${lastName}`.trim() : authUser?.email}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 capitalize">{authUser?.role ?? "member"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>First name</label>
            <input type="text" className={inputClass} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Jane" />
          </div>
          <div>
            <label className={labelClass}>Last name</label>
            <input type="text" className={inputClass} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Smith" />
          </div>
        </div>

        {isPhoneUser ? (
          <div>
            <label className={labelClass}>Email address</label>
            {authUser?.pendingEmail ? (
              <div>
                <div className={`rounded-lg border px-3 py-2 mb-2 ${linkExpired ? "border-red-200 bg-red-50" : "border-amber-100 bg-amber-50"}`}>
                      <div className={`flex items-start gap-2 text-xs ${linkExpired ? "text-red-700" : "text-amber-700"}`}>
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          {linkExpired ? (
                            <div>
                              <strong className="block">Verification link expired</strong>
                              <span className="text-[11px] opacity-80">{authUser.pendingEmail} — send a new link to confirm this address.</span>
                            </div>
                          ) : (
                            <span>
                              <strong>{authUser.pendingEmail}</strong> — verification email sent. Check your inbox to confirm it.
                              {expiryLabel && (
                                <span className="ml-1 text-[11px] opacity-70">(Link expires in {expiryLabel})</span>
                              )}
                            </span>
                          )}
                          <div className="mt-1.5">
                            {resendMsg ? (
                              <span className="flex items-center gap-1 text-teal-700">
                                <CheckCircle className="w-3 h-3 flex-shrink-0" /> {resendMsg}
                              </span>
                            ) : resendErr ? (
                              <span className="text-red-600">{resendErr}</span>
                            ) : null}
                            <button
                              type="button"
                              onClick={handleResendPendingEmail}
                              disabled={resendPend || resendCooldown > 0}
                              className={`mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed transition-colors ${linkExpired ? "text-red-800 hover:text-red-900" : "text-amber-800 hover:text-amber-900"}`}
                            >
                              {resendPend
                                ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                                : resendCooldown > 0
                                  ? linkExpired ? <>Send a new link in {resendCooldown}s</> : <>Resend link in {resendCooldown}s</>
                                  : linkExpired
                                    ? <><Send className="w-3 h-3" /> Send a new link</>
                                    : <><Send className="w-3 h-3" /> Resend link</>}
                            </button>
                          </div>
                        </div>
                      </div>
                </div>
                <input
                  type="email"
                  className={inputClass}
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="Change to a different address"
                />
                <p className="mt-1 text-[10px] text-gray-400">
                  Enter a different address above to resend to that address instead.
                </p>
              </div>
            ) : (
              <div>
                <input
                  type="email"
                  className={inputClass}
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="you@example.com"
                />
                <p className="mt-1 text-[10px] text-gray-400">
                  Add your email to receive notifications and sign in without your phone.
                  We'll send a verification link to confirm it.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className={labelClass}>Email address</label>
            <input
              type="email" className={inputClass + " bg-gray-50 cursor-not-allowed opacity-70"}
              value={authUser?.email ?? ""} disabled readOnly
            />
            <p className="mt-1 text-[10px] text-gray-400">Contact support to change your email address</p>
            {authUser?.pendingEmail && (
                <div className={`rounded-lg border px-3 py-2 mt-2 ${linkExpired ? "border-red-200 bg-red-50" : "border-amber-100 bg-amber-50"}`}>
                  <div className={`flex items-start gap-2 text-xs ${linkExpired ? "text-red-700" : "text-amber-700"}`}>
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      {linkExpired ? (
                        <div>
                          <strong className="block">Verification link expired</strong>
                          <span className="text-[11px] opacity-80">{authUser.pendingEmail} — send a new link to confirm this address.</span>
                        </div>
                      ) : (
                        <span>
                          <strong>{authUser.pendingEmail}</strong> — verification email sent. Check your inbox to confirm it.
                          {expiryLabel && (
                            <span className="ml-1 text-[11px] opacity-70">(Link expires in {expiryLabel})</span>
                          )}
                        </span>
                      )}
                      <div className="mt-1.5">
                        {resendMsg ? (
                          <span className="flex items-center gap-1 text-teal-700">
                            <CheckCircle className="w-3 h-3 flex-shrink-0" /> {resendMsg}
                          </span>
                        ) : resendErr ? (
                          <span className="text-red-600">{resendErr}</span>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleResendPendingEmail}
                          disabled={resendPend || resendCooldown > 0}
                          className={`mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed transition-colors ${linkExpired ? "text-red-800 hover:text-red-900" : "text-amber-800 hover:text-amber-900"}`}
                        >
                          {resendPend
                            ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                            : resendCooldown > 0
                              ? linkExpired ? <>Send a new link in {resendCooldown}s</> : <>Resend link in {resendCooldown}s</>
                              : linkExpired
                                ? <><Send className="w-3 h-3" /> Send a new link</>
                                : <><Send className="w-3 h-3" /> Resend link</>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </div>
        )}

        {emailSentNotice && (
          <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2 border border-teal-100">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> {emailSentNotice}
          </div>
        )}

        {profileErr && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {profileErr}
          </div>
        )}
        <SaveButton pending={profilePend} success={profileSave} />
      </form>
    </SectionCard>
  );
}

// ── Change Password Form ───────────────────────────────────────────────────────
function ChangePasswordForm() {
  const authUser    = useAuthUser();
  const refreshUser = useRefreshUser();
  const hasPassword = authUser?.hasPassword ?? true;

  const [curPw,     setCurPw]     = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSave,    setPwSave]    = useState(false);
  const [pwErr,     setPwErr]     = useState("");
  const [pwPend,    setPwPend]    = useState(false);

  async function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(""); setPwSave(false);
    if (newPw.length < 8) { setPwErr("New password must be at least 8 characters"); return; }
    if (newPw !== confirmPw) { setPwErr("Passwords do not match"); return; }
    setPwPend(true);
    try {
      const body: Record<string, string> = { newPassword: newPw };
      if (hasPassword) body.currentPassword = curPw;
      const res = await fetch("/api/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPwErr((d as { error?: string }).error || "Failed to update password");
      } else {
        setPwSave(true);
        setCurPw(""); setNewPw(""); setConfirmPw("");
        setTimeout(() => setPwSave(false), 3000);
        await refreshUser();
      }
    } catch { setPwErr("Network error"); }
    finally { setPwPend(false); }
  }

  return (
    <SectionCard
      title={hasPassword ? "Change Password" : "Set a Password"}
      subtitle={hasPassword ? "Keep your account secure" : "Add a password so you can sign in with your email"}
      icon={Lock}
      iconBg="#FEF3C7"
      iconColor="#D97706"
    >
      {!hasPassword && (
        <div className="flex items-start gap-2 text-xs text-teal-700 bg-teal-50 rounded-lg px-3 py-2 border border-teal-100 mb-4">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Your email is verified! Set a password below to sign in with email &amp; password in addition to your phone.</span>
        </div>
      )}
      <form onSubmit={handlePasswordSave} className="space-y-4">
        {hasPassword && (
          <div>
            <label className={labelClass}>Current password</label>
            <input type="password" className={inputClass} value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
          </div>
        )}
        <div>
          <label className={labelClass}>{hasPassword ? "New password" : "Password"}</label>
          <input type="password" className={inputClass} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" required />
        </div>
        <div>
          <label className={labelClass}>Confirm password</label>
          <input
            type="password" className={inputClass} value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)} placeholder="••••••••"
            autoComplete="new-password" required
            style={{ borderColor: confirmPw && confirmPw !== newPw ? "#EF4444" : undefined }}
          />
          {confirmPw && confirmPw !== newPw && (
            <p className="mt-1 text-[11px] text-red-500">Passwords do not match</p>
          )}
        </div>
        {pwErr && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {pwErr}
          </div>
        )}
        <SaveButton pending={pwPend} success={pwSave} label={hasPassword ? "Update password" : "Set password"} />
      </form>
    </SectionCard>
  );
}

// ── Phone Number Form ──────────────────────────────────────────────────────────
const PHONE_COUNTRY_CODES = [
  { code: "+91",  flag: "🇮🇳", name: "India" },
  { code: "+1",   flag: "🇺🇸", name: "USA / Canada" },
  { code: "+44",  flag: "🇬🇧", name: "UK" },
  { code: "+61",  flag: "🇦🇺", name: "Australia" },
  { code: "+971", flag: "🇦🇪", name: "UAE" },
  { code: "+65",  flag: "🇸🇬", name: "Singapore" },
  { code: "+60",  flag: "🇲🇾", name: "Malaysia" },
  { code: "+49",  flag: "🇩🇪", name: "Germany" },
  { code: "+33",  flag: "🇫🇷", name: "France" },
  { code: "+81",  flag: "🇯🇵", name: "Japan" },
];

type OtpStep = "idle" | "phone" | "otp";

function PhoneNumberForm() {
  const authUser     = useAuthUser();
  const refreshUser  = useRefreshUser();

  const [otpEnabled,   setOtpEnabled]   = useState(false);
  const [step,         setStep]         = useState<OtpStep>("idle");
  const [countryCode,  setCountryCode]  = useState("+91");
  const [phoneNumber,  setPhoneNumber]  = useState("");
  const [otpCode,      setOtpCode]      = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [success,      setSuccess]      = useState("");
  const [resendSecs,   setResendSecs]   = useState(0);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef    = useRef<RecaptchaVerifier | null>(null);
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (firebaseConfigured) {
      fetch("/api/auth/otp/available", { credentials: "include" })
        .then(r => r.json())
        .then((d: { enabled?: boolean }) => setOtpEnabled(d.enabled ?? false))
        .catch(() => setOtpEnabled(false));
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recaptchaRef.current?.clear();
    };
  }, []);

  function startResendTimer() {
    setResendSecs(60);
    timerRef.current = setInterval(() => {
      setResendSecs(s => {
        if (s <= 1) { clearInterval(timerRef.current!); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  async function sendOtp() {
    setError("");
    const digits = phoneNumber.replace(/\D/g, "");
    if (!digits || digits.length < 7) {
      setError("Enter a valid phone number.");
      return;
    }
    const fullPhone = `${countryCode}${digits}`;
    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, "phone-recaptcha-container", { size: "invisible" });
      }
      const confirmation = await signInWithPhoneNumber(auth, fullPhone, recaptchaRef.current);
      confirmationRef.current = confirmation;
      setStep("otp");
      startResendTimer();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("invalid-phone-number")) {
        setError("Invalid phone number. Check the country code and digits.");
      } else if (msg.includes("too-many-requests")) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        setError("Failed to send OTP. Please try again.");
      }
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    } finally {
      setLoading(false);
    }
  }

  function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    void sendOtp();
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!confirmationRef.current) return;
    setError("");
    setLoading(true);
    try {
      const result  = await confirmationRef.current.confirm(otpCode);
      const idToken = await result.user.getIdToken();

      const res = await fetch("/api/auth/otp/link-phone", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Failed to link phone. Please try again.");
        return;
      }

      await refreshUser();
      setStep("idle");
      setPhoneNumber("");
      setOtpCode("");
      setSuccess("Phone number linked successfully!");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("invalid-verification-code")) {
        setError("Wrong code. Please check and try again.");
      } else if (msg.includes("code-expired")) {
        setError("Code expired. Request a new one.");
      } else {
        setError("Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  function resetFlow() {
    setStep("idle");
    setPhoneNumber("");
    setOtpCode("");
    setError("");
    setResendSecs(0);
    confirmationRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    recaptchaRef.current?.clear();
    recaptchaRef.current = null;
  }

  async function handleResend(e: React.MouseEvent) {
    e.preventDefault();
    setStep("phone");
    await sendOtp();
  }

  const currentPhone = authUser?.phone;
  const isPhoneVerified = authUser?.phoneVerified;

  if (!otpEnabled) return null;

  return (
    <SectionCard title="Phone Number" subtitle="Link your phone to sign in via OTP" icon={Smartphone} iconBg="#F0F9FF" iconColor="#0369A1">
      <div id="phone-recaptcha-container" />

      {currentPhone && step === "idle" && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-gray-50 border border-gray-100">
          <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">{currentPhone}</div>
            <div className={`text-[11px] mt-0.5 ${isPhoneVerified ? "text-green-600" : "text-amber-500"}`}>
              {isPhoneVerified ? "Verified" : "Not verified"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setStep("phone"); setError(""); }}
            className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 transition-colors"
          >
            Change
          </button>
        </div>
      )}

      {success && step === "idle" && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-100 mb-4">
          <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> {success}
        </div>
      )}

      {step === "idle" && (
        <button
          type="button"
          onClick={() => { setStep("phone"); setError(""); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-colors"
          style={{ background: "#1A3D2B" }}
        >
          <Phone className="w-3.5 h-3.5" />
          {currentPhone ? "Change phone number" : "Add phone number"}
        </button>
      )}

      {step === "phone" && (
        <form onSubmit={handleSendOtp} className="space-y-3">
          <div>
            <label className={labelClass}>Phone number</label>
            <div className="flex gap-2">
              <select
                className="text-sm rounded-lg border border-gray-200 bg-white text-gray-900 px-2 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
                value={countryCode}
                onChange={e => setCountryCode(e.target.value)}
              >
                {PHONE_COUNTRY_CODES.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                ))}
              </select>
              <input
                type="tel"
                className={inputClass}
                value={phoneNumber}
                onChange={e => setPhoneNumber(e.target.value)}
                placeholder="9876543210"
                autoFocus
              />
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: "#1A3D2B" }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send code
            </button>
            <button
              type="button"
              onClick={resetFlow}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={handleVerifyOtp} className="space-y-3">
          <p className="text-xs text-gray-500">
            Enter the 6-digit code sent to <span className="font-semibold text-gray-700">{countryCode}{phoneNumber}</span>
          </p>
          <div>
            <label className={labelClass}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className={inputClass}
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              autoFocus
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-2 items-center flex-wrap">
            <button
              type="submit"
              disabled={loading || otpCode.length < 6}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: "#1A3D2B" }}
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
              Verify
            </button>
            <button
              type="button"
              onClick={resetFlow}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Cancel
            </button>
            {resendSecs > 0 ? (
              <span className="text-[11px] text-gray-400">Resend in {resendSecs}s</span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                className="text-[11px] text-teal-700 hover:text-teal-900 font-semibold transition-colors"
              >
                Resend code
              </button>
            )}
          </div>
        </form>
      )}
    </SectionCard>
  );
}

// ── Business WHY Form ──────────────────────────────────────────────────────────
function BusinessWhyForm() {
  const authUser   = useAuthUser();
  const updateUser = useUpdateUser();
  const [why,    setWhy]    = useState(authUser?.businessWhy ?? "");
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState("");

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setSaved(false); setSaving(true);
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ businessWhy: why }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr((d as { error?: string }).error || "Failed to save");
      } else {
        updateUser({ businessWhy: why });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch { setErr("Network error"); }
    finally { setSaving(false); }
  }

  return (
    <SectionCard
      title="Your Business WHY"
      subtitle="Injected into every AI-generated email to make outreach feel human"
      icon={MessageCircle}
      iconBg="#F0FDFA"
      iconColor="#0D9488"
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div
          className="rounded-lg px-3 py-2.5 text-[11px] italic border-l-2"
          style={{ background: "#F0FDFA", borderColor: "#0D9488", color: "#0F766E" }}
        >
          "We believe every B2B founder deserves a sales engine that works as hard as they do."
        </div>
        <div>
          <label className={labelClass}>Your Business WHY</label>
          <textarea
            className={inputClass}
            rows={4}
            maxLength={500}
            value={why}
            onChange={e => setWhy(e.target.value)}
            placeholder="Why did you start this business? What do you believe about your customers that others don't?"
            style={{ resize: "vertical" }}
          />
          <div className="flex justify-between mt-1">
            <p className="text-[10px] text-gray-400">
              This is injected into every AI-generated email to make your outreach feel human and authentic.
            </p>
            <span className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{why.length}/500</span>
          </div>
        </div>
        {err && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {err}
          </div>
        )}
        <SaveButton pending={saving} success={saved} label="Save Your WHY" />
      </form>
    </SectionCard>
  );
}

// ── Profile Tab ────────────────────────────────────────────────────────────────
function ProfileTab() {
  return (
    <div className="space-y-6">
      <BusinessWhyForm />
      <ProfileNameForm />
      <PhoneNumberForm />
      <ChangePasswordForm />
    </div>
  );
}

// ── Company Tab ─────────────────────────────────────────────────────────────
function CompanyTab() {
  const { data: brandingData, isLoading } = useGetBrandingSettings();

  const [companyName,  setCompanyName]  = useState("");
  const [website,      setWebsite]      = useState("");
  const [phone,        setPhone]        = useState("");
  const [tagline,      setTagline]      = useState("");
  const [contactInfo,  setContactInfo]  = useState("");
  const [brandColor,   setBrandColor]   = useState("#5C1A8C");
  const [logoBase64,   setLogoBase64]   = useState<string | null>(null);
  const [brandSaveOk,  setBrandSaveOk]  = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (brandingData) {
      setCompanyName(brandingData.companyName ?? "");
      setWebsite(((brandingData as unknown) as Record<string, string | null | undefined>).website ?? "");
      setPhone(((brandingData as unknown) as Record<string, string | null | undefined>).phone ?? "");
      setTagline(brandingData.tagline ?? "");
      setContactInfo(brandingData.contactInfo ?? "");
      setBrandColor(brandingData.brandColor ?? "#5C1A8C");
      setLogoBase64(brandingData.logoBase64 ?? null);
    }
  }, [brandingData]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setLogoBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const [brandSavePend, setBrandSavePend] = useState(false);

  async function handleBrandSave(e: React.FormEvent) {
    e.preventDefault();
    setBrandSaveOk(false); setBrandSavePend(true);
    try {
      const res = await fetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ companyName, tagline, contactInfo, website: website || null, phone: phone || null, brandColor, logoBase64: logoBase64 ?? null }),
      });
      if (res.ok) {
        setBrandSaveOk(true);
        setTimeout(() => setBrandSaveOk(false), 3000);
      }
    } catch { /* silently ignore */ }
    finally { setBrandSavePend(false); }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Company Branding" subtitle="Company info, logo, and PDF report styling — all in one place" icon={Palette} iconBg="#F5F3FF" iconColor="#5C1A8C">
        <form onSubmit={handleBrandSave} className="space-y-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-800">
            These settings appear in the header and footer of exported audit PDF reports.
          </div>

          {/* Core company info */}
          <div>
            <label className={labelClass}>Company / Brand Name</label>
            <input type="text" className={inputClass} value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}><Globe className="w-3 h-3 inline mr-1" />Website</label>
              <input type="url" className={inputClass} value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://yourcompany.com" />
            </div>
            <div>
              <label className={labelClass}><Phone className="w-3 h-3 inline mr-1" />Phone</label>
              <input type="tel" className={inputClass} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
            </div>
          </div>
          <div>
            <label className={labelClass}>Tagline</label>
            <input type="text" className={inputClass} value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Your Trusted Growth Partner" />
          </div>
          <div>
            <label className={labelClass}>Footer Contact Info (PDF)</label>
            <input type="text" className={inputClass} value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="hello@yourcompany.com  ·  +1 555 123 4567" />
            <p className="mt-1 text-[10px] text-gray-400">Shown at the bottom of every exported PDF page</p>
          </div>

          {/* Logo */}
          <div>
            <label className={labelClass}>Company Logo</label>
            <div className="flex items-center gap-3">
              {logoBase64 ? (
                <div className="relative flex-shrink-0">
                  <img src={logoBase64} alt="Logo preview" className="h-10 max-w-[120px] object-contain rounded border border-gray-200 bg-gray-50 p-1" />
                  <button type="button" onClick={() => { setLogoBase64(null); if (logoInputRef.current) logoInputRef.current.value = ""; }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ) : (
                <div className="w-16 h-10 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300">
                  <Upload className="w-4 h-4" />
                </div>
              )}
              <div>
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" id="logo-upload" />
                <label htmlFor="logo-upload" className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  {logoBase64 ? "Replace Logo" : "Upload Logo"}
                </label>
                <p className="mt-1 text-[10px] text-gray-400">PNG, JPG, or WebP. Shown in PDF header.</p>
              </div>
            </div>
          </div>

          {/* Brand Color */}
          <div>
            <label className={labelClass}>Brand Color</label>
            <div className="flex items-center gap-3">
              <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)} className="w-10 h-8 rounded border border-gray-200 cursor-pointer p-0.5 bg-white" />
              <input type="text" className={inputClass + " w-32 font-mono"} value={brandColor} onChange={e => setBrandColor(e.target.value)} placeholder="#5C1A8C" maxLength={7} />
              <div className="w-8 h-8 rounded-lg border border-gray-200 flex-shrink-0" style={{ background: brandColor }} />
            </div>
          </div>

          {brandSaveOk && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 flex items-center gap-2 text-xs text-green-700">
              <CheckCircle className="w-4 h-4 flex-shrink-0" /> Branding saved successfully.
            </div>
          )}
          <SaveButton pending={brandSavePend} success={brandSaveOk} label="Save Company Branding" />
        </form>
      </SectionCard>

      {/* PDF Preview */}
      <SectionCard title="PDF Preview" subtitle="Updates live as you edit — no export needed" icon={Eye} iconBg="#F5F3FF" iconColor="#5C1A8C">
        <div className="rounded-lg border border-gray-200 overflow-hidden bg-white" style={{ boxShadow: "inset 0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ background: brandColor, padding: "10px 16px 0 16px", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 9 }}>
              {logoBase64 ? (
                <img src={logoBase64} alt="Logo" style={{ height: 30, maxWidth: 90, objectFit: "contain", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 64, height: 30, background: "rgba(255,255,255,0.18)", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 9, fontWeight: 600 }}>LOGO</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {companyName || <span style={{ opacity: 0.45 }}>Company Name</span>}
                </div>
                {tagline && <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 9, marginTop: 2 }}>{tagline}</div>}
              </div>
              <div style={{ position: "absolute", right: 12, top: 6, width: 44, height: 30, borderRadius: "50%", background: "#E91E8C", opacity: 0.28, filter: "blur(7px)", pointerEvents: "none" }} />
            </div>
            <div style={{ height: 3, background: "#E91E8C", margin: "0 -16px" }} />
          </div>
          <div style={{ background: "#F9FAFB", padding: "5px 16px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid #E5E7EB" }}>
            <span style={{ fontSize: 9, color: "#6B7280" }}>Brand Audit Report</span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: "#E91E8C", fontWeight: 600 }}>{website || "example.com"}</span>
            <span style={{ fontSize: 9, color: "#9CA3AF" }}>· {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
          <div style={{ padding: "14px 16px", background: "#FAFAFA" }}>
            {[65, 90, 82, 74, 55].map((w, i) => (
              <div key={i} style={{ height: i === 0 ? 9 : 6, background: i === 0 ? "#E5E7EB" : "#F3F4F6", borderRadius: i === 0 ? 4 : 3, marginBottom: 5, width: `${w}%` }} />
            ))}
          </div>
          <div style={{ background: brandColor, position: "relative" }}>
            <div style={{ height: 2, background: "#E91E8C" }} />
            <div style={{ padding: "6px 16px 7px", display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1, textAlign: "center" }}>
                <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 8 }}>
                  {[companyName, tagline, contactInfo || phone || website].filter(Boolean).join(" · ") || "Generated by Sales War Machine"}
                </span>
              </div>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 8, flexShrink: 0 }}>Page 1</span>
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[10px] text-gray-400 text-center">Scaled preview — save to apply to all PDF exports.</p>
      </SectionCard>
    </div>
  );
}

// ── Email Tab ──────────────────────────────────────────────────────────────────
function EmailTab() {
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);
  const [saveErr,    setSaveErr]    = useState("");

  const [host,        setHost]        = useState("");
  const [port,        setPort]        = useState("587");
  const [user,        setUser]        = useState("");
  const [password,    setPassword]    = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [secure,      setSecure]      = useState(false);

  const [testEmail,  setTestEmail]  = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testPend,   setTestPend]   = useState(false);

  useEffect(() => {
    fetch("/api/settings/smtp", { credentials: "include" })
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        setHost((d.host as string) ?? "");
        setPort(String(d.port ?? 587));
        setUser((d.user as string) ?? "");
        setFromAddress((d.fromAddress as string) ?? "");
        setSecure(Boolean(d.secure));
        const prefill = (d.fromAddress as string) ?? (d.user as string) ?? "";
        if (prefill) setTestEmail(prefill);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(""); setSaveOk(false); setSaving(true);
    try {
      const body: Record<string, unknown> = {
        host: host.trim() || null,
        port: Number(port) || 587,
        user: user.trim() || null,
        fromAddress: fromAddress.trim() || null,
        secure,
      };
      if (password) body.password = password;
      const res = await fetch("/api/settings/smtp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSaveErr((d as { error?: string }).error || "Failed to save");
      } else {
        setPassword("");
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      }
    } catch { setSaveErr("Network error"); }
    finally { setSaving(false); }
  }

  async function handleTest() {
    if (!testEmail) return;
    setTestPend(true); setTestResult(null);
    try {
      const res = await fetch("/api/settings/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ toEmail: testEmail }),
      });
      setTestResult(await res.json());
    } catch { setTestResult({ success: false, message: "Network error — could not reach the server." }); }
    finally { setTestPend(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-6">
      <SectionCard title="SMTP Configuration" subtitle="Configure your outgoing email server" icon={Mail} iconBg="#F0FDF4" iconColor="#1A7A45">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 text-[11px] text-green-800 flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-600" />
            <span>Platform emails (outreach, proposals, confirmations) are sent via <strong>Brevo</strong> from <strong>info@dreamsdesign.ca</strong>. Custom SMTP settings below are for additional mail flows.</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>SMTP Host</label>
              <input type="text" className={inputClass} value={host} onChange={e => setHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label className={labelClass}>Port</label>
              <input type="number" className={inputClass} value={port} onChange={e => setPort(e.target.value)} placeholder="587" min={1} max={65535} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Username</label>
              <input type="text" className={inputClass} value={user} onChange={e => setUser(e.target.value)} placeholder="user@example.com" autoComplete="off" />
            </div>
            <div>
              <label className={labelClass}>Password</label>
              <input type="password" className={inputClass} value={password} onChange={e => setPassword(e.target.value)} placeholder="Leave blank to keep existing" autoComplete="new-password" />
            </div>
          </div>

          <div>
            <label className={labelClass}>From Address</label>
            <input type="email" className={inputClass} value={fromAddress} onChange={e => setFromAddress(e.target.value)} placeholder="hello@example.com" />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox" id="smtp-secure" checked={secure}
              onChange={e => setSecure(e.target.checked)}
              className="rounded border-gray-300"
            />
            <label htmlFor="smtp-secure" className="text-xs text-gray-700 cursor-pointer">Use TLS/SSL (port 465)</label>
          </div>

          {saveErr && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {saveErr}
            </div>
          )}
          <SaveButton pending={saving} success={saveOk} label="Save SMTP Settings" />
        </form>
      </SectionCard>

      <SectionCard title="Send Test Email" subtitle="Verify your email delivery is working" icon={Send} iconBg="#F0FDF4" iconColor="#1A7A45">
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Recipient Email</label>
            <div className="flex gap-2">
              <input
                type="email" className={inputClass} value={testEmail}
                onChange={e => setTestEmail(e.target.value)} placeholder="recipient@example.com"
              />
              <button
                type="button" onClick={handleTest} disabled={testPend || !testEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white whitespace-nowrap disabled:opacity-50 transition-colors"
                style={{ background: "#1A7A45" }}
              >
                {testPend ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send Test
              </button>
            </div>
          </div>

          {testResult && (
            <div
              className="rounded-lg border px-3 py-2.5 flex items-start gap-2 text-xs"
              style={{
                background: testResult.success ? "rgba(22,163,74,0.05)" : "rgba(239,68,68,0.05)",
                borderColor: testResult.success ? "#bbf7d0" : "#fecaca",
              }}
            >
              {testResult.success
                ? <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />}
              <span style={{ color: testResult.success ? "#15803d" : "#dc2626" }}>{testResult.message}</span>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

// ── WhatsApp Tab ───────────────────────────────────────────────────────────────
function WhatsAppTab() {
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [saveOk,     setSaveOk]     = useState(false);
  const [saveErr,    setSaveErr]    = useState("");

  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [hasAppSecret,   setHasAppSecret]   = useState(false);
  const [accessToken,    setAccessToken]    = useState("");
  const [appSecret,      setAppSecret]      = useState("");
  const [phoneNumberId,      setPhoneNumberId]      = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [bookingUrl,         setBookingUrl]         = useState("");
  const [consultantName,     setConsultantName]     = useState("");
  const [portfolioUrl,       setPortfolioUrl]       = useState("");
  const [caseStudyUrl,       setCaseStudyUrl]       = useState("");
  const [companyProfileUrl,  setCompanyProfileUrl]  = useState("");
  const [hookTemplateName,   setHookTemplateName]   = useState("");
  const [hookTemplateLang,   setHookTemplateLang]   = useState("en_US");
  const [n8nWebhookUrl,      setN8nWebhookUrl]      = useState("");

  useEffect(() => {
    fetch("/api/settings/whatsapp", { credentials: "include" })
      .then(r => r.json())
      .then((d: Record<string, unknown>) => {
        setHasAccessToken(Boolean(d.hasAccessToken));
        setHasAppSecret(Boolean(d.hasAppSecret));
        setPhoneNumberId((d.phoneNumberId as string) ?? "");
        setWebhookVerifyToken((d.webhookVerifyToken as string) ?? "");
        setBookingUrl((d.bookingUrl as string) ?? "");
        setConsultantName((d.consultantName as string) ?? "");
        setPortfolioUrl((d.portfolioUrl as string) ?? "");
        setCaseStudyUrl((d.caseStudyUrl as string) ?? "");
        setCompanyProfileUrl((d.companyProfileUrl as string) ?? "");
        setHookTemplateName((d.hookTemplateName as string) ?? "");
        setHookTemplateLang((d.hookTemplateLang as string) ?? "en_US");
        setN8nWebhookUrl((d.n8nWebhookUrl as string) ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(""); setSaveOk(false); setSaving(true);
    try {
      const body: Record<string, unknown> = {
        phoneNumberId, webhookVerifyToken, bookingUrl, consultantName,
        portfolioUrl, caseStudyUrl, companyProfileUrl, hookTemplateName, hookTemplateLang,
        n8nWebhookUrl: n8nWebhookUrl || null,
      };
      if (accessToken) body.accessToken = accessToken;
      if (appSecret)   body.appSecret   = appSecret;
      const res = await fetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSaveErr((d as { error?: string }).error || "Failed to save");
      } else {
        if (accessToken) { setHasAccessToken(true); setAccessToken(""); }
        if (appSecret)   { setHasAppSecret(true);   setAppSecret(""); }
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      }
    } catch { setSaveErr("Network error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-6">
      <SectionCard title="WhatsApp Business API" subtitle="Configure your Meta WhatsApp integration" icon={Smartphone} iconBg="#F0FDF4" iconColor="#25D366">
        <form onSubmit={handleSave} className="space-y-4">
          <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 text-[11px] text-green-800">
            Credentials from your <strong>Meta Business Manager</strong> / <strong>WhatsApp Business Platform</strong>.
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Access Token</label>
              <input
                type="password" className={inputClass + " font-mono"}
                value={accessToken} onChange={e => setAccessToken(e.target.value)}
                placeholder={hasAccessToken ? "••••••  (set — enter new value to change)" : "EAAx…"}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>App Secret</label>
              <input
                type="password" className={inputClass + " font-mono"}
                value={appSecret} onChange={e => setAppSecret(e.target.value)}
                placeholder={hasAppSecret ? "••••••  (set — enter new value to change)" : "a1b2c3…"}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelClass}>Phone Number ID</label>
              <input type="text" className={inputClass + " font-mono"} value={phoneNumberId} onChange={e => setPhoneNumberId(e.target.value)} placeholder="123456789012345" />
            </div>
            <div>
              <label className={labelClass}>Webhook Verify Token</label>
              <input type="text" className={inputClass + " font-mono"} value={webhookVerifyToken} onChange={e => setWebhookVerifyToken(e.target.value)} placeholder="my-verify-token" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Consultant Profile</div>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Consultant Name</label>
                <input type="text" className={inputClass} value={consultantName} onChange={e => setConsultantName(e.target.value)} placeholder="Jane Smith" />
              </div>
              <div>
                <label className={labelClass}>Booking URL</label>
                <input type="url" className={inputClass} value={bookingUrl} onChange={e => setBookingUrl(e.target.value)} placeholder="https://calendly.com/jane" />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Portfolio Links</div>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Portfolio URL</label>
                <input type="url" className={inputClass} value={portfolioUrl} onChange={e => setPortfolioUrl(e.target.value)} placeholder="https://yoursite.com/portfolio" />
              </div>
              <div>
                <label className={labelClass}>Case Study URL</label>
                <input type="url" className={inputClass} value={caseStudyUrl} onChange={e => setCaseStudyUrl(e.target.value)} placeholder="https://yoursite.com/case-study" />
              </div>
              <div>
                <label className={labelClass}>Company Profile URL</label>
                <input type="url" className={inputClass} value={companyProfileUrl} onChange={e => setCompanyProfileUrl(e.target.value)} placeholder="https://yoursite.com/about" />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Hook Template</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Template Name</label>
                <input type="text" className={inputClass} value={hookTemplateName} onChange={e => setHookTemplateName(e.target.value)} placeholder="sales_hook_v1" />
              </div>
              <div>
                <label className={labelClass}>Template Language</label>
                <input type="text" className={inputClass} value={hookTemplateLang} onChange={e => setHookTemplateLang(e.target.value)} placeholder="en_US" />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Automation (n8n)</div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-800 mb-3">
              When set, every inbound WhatsApp message will be forwarded to this n8n webhook URL for automation processing.
            </div>
            <div>
              <label className={labelClass}>n8n Webhook URL</label>
              <input type="url" className={inputClass + " font-mono"} value={n8nWebhookUrl} onChange={e => setN8nWebhookUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/..." />
            </div>
          </div>

          {saveErr && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {saveErr}
            </div>
          )}
          <SaveButton pending={saving} success={saveOk} label="Save WhatsApp Settings" />
        </form>
      </SectionCard>
    </div>
  );
}

// ── Disconnect Button Component ───────────────────────────────────────────────
function DisconnectButton({ href, onDisconnected }: { href: string; onDisconnected: () => void }) {
  const [pending,  setPending]  = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [message,  setMessage]  = useState("");

  async function handleDisconnect() {
    setPending(true);
    try {
      const res = await fetch(href, { method: "DELETE", credentials: "include" });
      const data = await res.json() as { ok?: boolean; message?: string };
      setMessage(data.message ?? (data.ok ? "Disconnected." : "Could not disconnect automatically."));
      setShowInfo(true);
      setTimeout(() => { setShowInfo(false); onDisconnected(); }, 5000);
    } catch {
      setMessage("Network error.");
      setShowInfo(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleDisconnect}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
        style={{ color: "#DC2626", borderColor: "#FECACA", background: "#FEF2F2" }}
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
        Disconnect
      </button>
      {showInfo && (
        <div className="absolute top-8 left-0 z-10 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-[11px] text-gray-600">
          {message}
        </div>
      )}
    </div>
  );
}

// ── Integrations Tab ───────────────────────────────────────────────────────────
type IntegrationStatus = { connected: boolean; loading: boolean; error?: string };

interface IntegrationRow {
  name: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  status: IntegrationStatus;
  managedBy?: string;
  connectHref?: string;
  manageHref?: string;
}

function IntegrationsTab({ onSwitchTab }: { onSwitchTab: (tab: Tab) => void }) {
  const [googleStatus,   setGoogleStatus]   = useState<IntegrationStatus>({ connected: false, loading: true });
  const [hubspotStatus,  setHubspotStatus]  = useState<IntegrationStatus>({ connected: false, loading: true });
  const [whatsappStatus, setWhatsappStatus] = useState<IntegrationStatus>({ connected: false, loading: true });

  function refreshStatuses() {
    setGoogleStatus(s  => ({ ...s, loading: true }));
    setHubspotStatus(s => ({ ...s, loading: true }));
    setWhatsappStatus(s => ({ ...s, loading: true }));

    fetch("/api/integrations/google/status", { credentials: "include" })
      .then(r => r.json())
      .then((d: { connected?: boolean }) => setGoogleStatus({ connected: Boolean(d.connected), loading: false }))
      .catch(() => setGoogleStatus({ connected: false, loading: false, error: "Failed to check status" }));

    fetch("/api/integrations/hubspot/status", { credentials: "include" })
      .then(r => r.json())
      .then((d: { connected?: boolean }) => setHubspotStatus({ connected: Boolean(d.connected), loading: false }))
      .catch(() => setHubspotStatus({ connected: false, loading: false, error: "Failed to check status" }));

    fetch("/api/settings/whatsapp", { credentials: "include" })
      .then(r => r.json())
      .then((d: { phoneNumberId?: string | null }) => setWhatsappStatus({ connected: Boolean(d.phoneNumberId), loading: false }))
      .catch(() => setWhatsappStatus({ connected: false, loading: false }));
  }

  useEffect(() => { refreshStatuses(); }, []);

  function StatusBadge({ status }: { status: IntegrationStatus }) {
    if (status.loading) return <Loader2 className="w-4 h-4 animate-spin text-gray-400" />;
    if (status.connected) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
          <CheckCircle className="w-3 h-3" /> Connected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200">
        <AlertCircle className="w-3 h-3" /> Not connected
      </span>
    );
  }

  const integrations: IntegrationRow[] = [
    {
      name: "HubSpot CRM",
      description: "Two-way sync of leads, contacts, and deals.",
      icon: Building2, iconBg: "#FFF0EB", iconColor: "#FF7A59",
      status: hubspotStatus,
      managedBy: "Replit connector",
      connectHref: "/hubspot",
      manageHref:  "/hubspot",
    },
    {
      name: "Google Calendar",
      description: "Sync meetings and appointments automatically.",
      icon: Globe, iconBg: "#EFF6FF", iconColor: "#3B82F6",
      status: googleStatus,
      managedBy: "Replit connector",
      connectHref: "/meetings",
      manageHref:  "/meetings",
    },
    {
      name: "WhatsApp Business",
      description: "Automated outreach via Meta WhatsApp Business API.",
      icon: MessageCircle, iconBg: "#F0FDF4", iconColor: "#25D366",
      status: whatsappStatus,
      connectHref: "#",
      manageHref:  "#",
    },
    {
      name: "Apollo.io",
      description: "Lead enrichment with company data, emails, and phone numbers.",
      icon: Phone, iconBg: "#F5F3FF", iconColor: "#7C3AED",
      status: { connected: true, loading: false },
      managedBy: "API key",
      manageHref: "/leads",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-800 flex items-center gap-2">
        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
        <span>HubSpot and Google Calendar are managed via <strong>Replit integrations</strong>. Use the Connect button to set up or verify the integration, then refresh the status.</span>
      </div>

      {integrations.map(({ name, description, icon: Icon, iconBg, iconColor, status, managedBy, connectHref, manageHref }) => (
        <div key={name} className="rounded-xl border border-gray-200 bg-white shadow-sm p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
              <Icon className="w-5 h-5" style={{ color: iconColor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{name}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">{description}</div>
                  {managedBy && (
                    <div className="text-[10px] text-gray-300 mt-0.5">Managed by: {managedBy}</div>
                  )}
                </div>
                <StatusBadge status={status} />
              </div>

              <div className="flex items-center gap-2 mt-3">
                {status.connected ? (
                  <>
                    {manageHref && manageHref !== "#" && (
                      <a
                        href={manageHref}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                        style={{ background: "#F0FDF4", color: "#1A7A45", borderColor: "#BBF7D0" }}
                      >
                        <CheckCircle className="w-3 h-3" />
                        Manage
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    )}
                    {manageHref === "#" && (
                      <button
                        type="button"
                        onClick={() => onSwitchTab("whatsapp")}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                        style={{ background: "#F0FDF4", color: "#1A7A45", borderColor: "#BBF7D0" }}
                      >
                        <CheckCircle className="w-3 h-3" />
                        Configure
                      </button>
                    )}
                    {manageHref && manageHref !== "#" && (
                      <DisconnectButton href={`/api/integrations/${name.toLowerCase().includes("hubspot") ? "hubspot" : "google"}/disconnect`} onDisconnected={refreshStatuses} />
                    )}
                  </>
                ) : (
                  <>
                    {connectHref && connectHref !== "#" && (
                      <a
                        href={connectHref}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                        style={{ background: "#1A3D2B", color: "#fff", borderColor: "#1A3D2B" }}
                      >
                        <Link2 className="w-3 h-3" />
                        Connect
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    )}
                    {connectHref === "#" && (
                      <button
                        type="button"
                        onClick={() => onSwitchTab("whatsapp")}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                        style={{ background: "#1A3D2B", color: "#fff", borderColor: "#1A3D2B" }}
                      >
                        <Link2 className="w-3 h-3" />
                        Configure
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={refreshStatuses}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors text-gray-500 hover:text-gray-700 border-gray-200 hover:border-gray-300"
                  title="Refresh status"
                >
                  <Loader2 className={`w-3 h-3 ${status.loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Team Tab ──────────────────────────────────────────────────────────────────
interface TeamMember {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface PendingInvite {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  owner:  { bg: "#FEF3C7", color: "#D97706" },
  admin:  { bg: "#EDE9FE", color: "#7C3AED" },
  member: { bg: "#F0FDF4", color: "#1A7A45" },
};

function RoleBadge({ role }: { role: string }) {
  const c = ROLE_COLORS[role] ?? { bg: "#F3F4F6", color: "#6B7280" };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold capitalize"
      style={{ background: c.bg, color: c.color }}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function MemberRow({
  member,
  canManage,
  canDelete,
  onRoleChange,
  onToggleActive,
  onRemove,
}: {
  member: TeamMember;
  canManage: boolean;
  canDelete: boolean;
  onRoleChange: (id: number, role: string) => void;
  onToggleActive: (id: number, active: boolean) => void;
  onRemove: (id: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (((member.firstName?.[0] ?? "") + (member.lastName?.[0] ?? "")).toUpperCase()) || (member.email[0]?.toUpperCase() ?? "?");

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
        style={{ background: "linear-gradient(135deg, #1A3D2B, #5C1A8C)", opacity: member.isActive ? 1 : 0.45 }}>
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium truncate ${member.isActive ? "text-gray-900" : "text-gray-400 line-through"}`}>
            {member.firstName || member.lastName ? `${member.firstName} ${member.lastName}`.trim() : member.email}
          </span>
          <RoleBadge role={member.role} />
          {!member.isActive && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Deactivated</span>
          )}
        </div>
        {(member.firstName || member.lastName) && (
          <div className="text-[11px] text-gray-400 truncate">{member.email}</div>
        )}
      </div>

      {canManage && member.role !== "owner" && (
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-20 bg-white rounded-xl shadow-lg border border-gray-200 py-1 min-w-[150px]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {member.role !== "admin" && (
                <button
                  type="button"
                  onClick={() => { onRoleChange(member.id, "admin"); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5 text-purple-400" /> Make Admin
                </button>
              )}
              {member.role !== "member" && (
                <button
                  type="button"
                  onClick={() => { onRoleChange(member.id, "member"); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                >
                  <User className="w-3.5 h-3.5 text-teal-500" /> Make Member
                </button>
              )}
              <button
                type="button"
                onClick={() => { onToggleActive(member.id, !member.isActive); setMenuOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <UserX className="w-3.5 h-3.5 text-amber-500" />
                {member.isActive ? "Deactivate" : "Reactivate"}
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => { onRemove(member.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove from team
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamTab() {
  const authUser = useAuthUser();
  const canManage = authUser?.role === "owner" || authUser?.role === "admin";
  const canDelete = authUser?.role === "owner";

  const [members,       setMembers]       = useState<TeamMember[]>([]);
  const [pendingInvites,setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading,       setLoading]       = useState(true);

  const [inviteEmail,   setInviteEmail]   = useState("");
  const [inviteRole,    setInviteRole]    = useState("member");
  const [inviting,      setInviting]      = useState(false);
  const [inviteOk,      setInviteOk]      = useState("");
  const [inviteErr,     setInviteErr]     = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch("/api/team/members",         { credentials: "include" }),
        fetch("/api/team/pending-invites", { credentials: "include" }),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json() as TeamMember[]);
      if (invitesRes.ok) setPendingInvites(await invitesRes.json() as PendingInvite[]);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadAll(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(""); setInviteOk(""); setInviting(true);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const d = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setInviteErr(d.error ?? "Failed to send invite");
      } else {
        setInviteOk(`Invitation sent to ${inviteEmail.trim()}`);
        setInviteEmail("");
        setTimeout(() => setInviteOk(""), 5000);
        await loadAll();
      }
    } catch { setInviteErr("Network error"); }
    finally { setInviting(false); }
  }

  async function handleRoleChange(id: number, role: string) {
    await fetch(`/api/team/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role }),
    });
    await loadAll();
  }

  async function handleToggleActive(id: number, isActive: boolean) {
    await fetch(`/api/team/members/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive }),
    });
    await loadAll();
  }

  async function handleRemove(id: number) {
    if (!confirm("Remove this person from your team? This cannot be undone.")) return;
    await fetch(`/api/team/members/${id}`, { method: "DELETE", credentials: "include" });
    await loadAll();
  }

  async function handleRevokeInvite(id: number) {
    await fetch(`/api/team/pending-invites/${id}`, { method: "DELETE", credentials: "include" });
    await loadAll();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Current members */}
      <SectionCard title="Team Members" subtitle={`${members.length} member${members.length !== 1 ? "s" : ""} in your workspace`} icon={Users} iconBg="#F0FDF4" iconColor="#1A7A45">
        {members.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No members yet.</p>
        ) : (
          <div>
            {members.map(m => (
              <MemberRow
                key={m.id}
                member={m}
                canManage={canManage && m.id !== authUser?.id}
                canDelete={canDelete && m.id !== authUser?.id}
                onRoleChange={handleRoleChange}
                onToggleActive={handleToggleActive}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Invite form (owner/admin only) */}
      {canManage && (
        <SectionCard title="Invite a Team Member" subtitle="They'll receive an email to set up their account" icon={UserPlus} iconBg="#EDE9FE" iconColor="#7C3AED">
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className={labelClass}>Email address</label>
                <input
                  type="email" className={inputClass} required
                  value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                />
              </div>
              <div className="w-36">
                <label className={labelClass}>Role</label>
                <div className="relative">
                  <select
                    value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    className={inputClass + " pr-7 appearance-none"}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
            </div>

            {inviteErr && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
                <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {inviteErr}
              </div>
            )}
            {inviteOk && (
              <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> {inviteOk}
              </div>
            )}

            <button
              type="submit"
              disabled={inviting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 transition-colors"
              style={{ background: "#1A3D2B" }}
            >
              {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {inviting ? "Sending…" : "Send Invitation"}
            </button>
          </form>
        </SectionCard>
      )}

      {/* Pending invites */}
      {canManage && pendingInvites.length > 0 && (
        <SectionCard title="Pending Invitations" subtitle="Invites awaiting acceptance" icon={Mail} iconBg="#FEF3C7" iconColor="#D97706">
          <div>
            {pendingInvites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-700 truncate">{inv.email}</span>
                    <RoleBadge role={inv.role} />
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Expires {new Date(inv.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeInvite(inv.id)}
                  className="flex-shrink-0 text-[11px] font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ── AI Spend Threshold Widget ──────────────────────────────────────────────────
function AiSpendThresholdSection() {
  const [limitInput,    setLimitInput]    = useState("");
  const [todaySpend,    setTodaySpend]    = useState<number | null>(null);
  const [currentLimit,  setCurrentLimit]  = useState<number | null>(null);
  const [alertSentAt,   setAlertSentAt]   = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [saveOk,        setSaveOk]        = useState(false);
  const [saveErr,       setSaveErr]       = useState("");

  useEffect(() => {
    fetch("/api/settings/ai-spend-threshold", { credentials: "include" })
      .then(r => r.json())
      .then((d: { limitUsd?: number | null; todaySpendUsd?: number; alertSentAt?: string | null }) => {
        setCurrentLimit(d.limitUsd ?? null);
        setLimitInput(d.limitUsd != null ? String(d.limitUsd) : "");
        setTodaySpend(d.todaySpendUsd ?? 0);
        setAlertSentAt(d.alertSentAt ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSaveThreshold(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(""); setSaveOk(false); setSaving(true);
    try {
      const limitUsd = limitInput.trim() === "" ? null : Number(limitInput);
      if (limitUsd !== null && (Number.isNaN(limitUsd) || limitUsd < 0)) {
        setSaveErr("Enter a valid positive number or leave blank to disable"); return;
      }
      const res = await fetch("/api/settings/ai-spend-threshold", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ limitUsd }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSaveErr((d as { error?: string }).error || "Failed to save");
      } else {
        setCurrentLimit(limitUsd);
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      }
    } catch { setSaveErr("Network error"); }
    finally { setSaving(false); }
  }

  const pct = currentLimit && todaySpend !== null
    ? Math.min(100, (todaySpend / currentLimit) * 100)
    : 0;
  const isOver    = currentLimit !== null && todaySpend !== null && todaySpend >= currentLimit;
  const isWarning = !isOver && pct >= 80;

  if (loading) return (
    <div className="flex items-center justify-center py-8">
      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Today's meter */}
      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Today's AI Spend</span>
          {isOver && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-600">Limit Exceeded</span>
          )}
          {isWarning && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Nearing Limit</span>
          )}
        </div>
        <div className="flex items-end gap-3">
          <span className="text-2xl font-bold text-gray-900">
            ${todaySpend !== null ? todaySpend.toFixed(4) : "0.0000"}
          </span>
          {currentLimit !== null && (
            <span className="text-sm text-gray-400 mb-0.5">
              / ${currentLimit.toFixed(2)} daily limit
            </span>
          )}
        </div>

        {currentLimit !== null && (
          <div className="mt-3">
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: isOver ? "#DC2626" : isWarning ? "#F59E0B" : "#10B981",
                }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-400">$0</span>
              <span className="text-[10px] text-gray-400">${currentLimit.toFixed(2)}</span>
            </div>
          </div>
        )}

        {alertSentAt && isOver && (
          <div className="mt-2 text-[11px] text-red-500 flex items-center gap-1">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            Alert sent {new Date(alertSentAt).toLocaleString()}
          </div>
        )}

        {currentLimit === null && (
          <p className="mt-2 text-[11px] text-gray-400">Set a daily limit below to enable threshold alerts.</p>
        )}
      </div>

      {/* Threshold config form */}
      <form onSubmit={handleSaveThreshold} className="space-y-4">
        <div>
          <label className={labelClass}>Daily Spend Limit (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={limitInput}
              onChange={e => setLimitInput(e.target.value)}
              placeholder="e.g. 5.00 — leave blank to disable"
              className="w-full text-sm rounded-lg border border-gray-200 bg-white text-gray-900 pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            An email alert fires to your admin address each day the limit is exceeded. Clear the field to disable alerts.
          </p>
        </div>

        {saveErr && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
            <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {saveErr}
          </div>
        )}

        {saveOk && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-100">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> Threshold saved
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-60"
          style={{ background: "#1A3D2B" }}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : "Save Threshold"}
        </button>
      </form>
    </div>
  );
}

// ── Model Intelligence Tab ─────────────────────────────────────────────────────
type ModelTier = "FAST" | "SMART";

const OPERATION_DESCRIPTIONS: Record<string, string> = {
  bantb_scoring:      "Scores leads using BANT + Belief criteria",
  belief_scoring:     "Assesses prospect belief alignment",
  followup_email:     "Writes follow-up email content",
  whatsapp_message:   "Generates WhatsApp conversation replies",
  icp_suggestions:    "Suggests ideal customer profiles",
  lead_routing:       "Decides which rep/sequence a lead goes to",
  brand_audit_report: "Produces full brand audit reports",
  outreach_email:     "Writes cold and warm outreach emails",
  sales_brain_query:  "Powers the Sales Brain chat assistant",
};

function TierPill({ tier, active, onClick }: { tier: ModelTier; active: boolean; onClick: () => void }) {
  const isFast = tier === "FAST";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all border"
      style={active ? {
        background: isFast ? "#F0FDF4" : "#F5F3FF",
        color:      isFast ? "#1A7A45" : "#5C1A8C",
        borderColor: isFast ? "#BBF7D0" : "#DDD6FE",
      } : {
        background: "#F9FAFB",
        color:      "#9CA3AF",
        borderColor: "#E5E7EB",
      }}
    >
      {isFast ? <Zap className="w-3 h-3" /> : <Brain className="w-3 h-3" />}
      {isFast ? "Fast" : "Smart"}
    </button>
  );
}

function ModelIntelligenceTab() {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saveOk,   setSaveOk]   = useState(false);
  const [saveErr,  setSaveErr]  = useState("");

  const [defaults,        setDefaults]        = useState<Record<string, ModelTier>>({});
  const [overrides,       setOverrides]       = useState<Record<string, ModelTier>>({});
  const [operationLabels, setOperationLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/settings/model-routing", { credentials: "include" })
      .then(r => r.json())
      .then((d: { defaults?: Record<string, ModelTier>; overrides?: Record<string, ModelTier>; operationLabels?: Record<string, string> }) => {
        setDefaults(d.defaults ?? {});
        setOverrides(d.overrides ?? {});
        setOperationLabels(d.operationLabels ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function getEffectiveTier(op: string): ModelTier {
    return overrides[op] ?? defaults[op] ?? "FAST";
  }

  function toggleTier(op: string, tier: ModelTier) {
    setOverrides(prev => ({ ...prev, [op]: tier }));
  }

  function resetToDefault(op: string) {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[op];
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveErr(""); setSaveOk(false); setSaving(true);
    try {
      const res = await fetch("/api/settings/model-routing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ overrides }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSaveErr((d as { error?: string }).error || "Failed to save");
      } else {
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 3000);
      }
    } catch { setSaveErr("Network error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>;

  const ops = Object.keys(defaults);
  const hasOverrides = ops.some(op => overrides[op] !== undefined);

  return (
    <div className="space-y-6">
      <SectionCard
        title="Daily AI Spend Alert"
        subtitle="Get an email if your workspace crosses a daily AI cost threshold"
        icon={AlertCircle}
        iconBg="#FEF2F2"
        iconColor="#DC2626"
      >
        <AiSpendThresholdSection />
      </SectionCard>

      <SectionCard
        title="Model Intelligence"
        subtitle="Override AI model tier per operation — Fast cuts cost, Smart boosts quality"
        icon={Brain}
        iconBg="#F5F3FF"
        iconColor="#5C1A8C"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2.5 text-[11px] text-purple-800 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <strong>Fast</strong> uses <span className="font-mono">claude-haiku</span> for speed and lower cost.{" "}
              <strong>Smart</strong> uses <span className="font-mono">claude-sonnet</span> for higher accuracy.
              Changes apply to all new AI calls for this workspace.
            </span>
          </div>

          <div className="divide-y divide-gray-100">
            {ops.map(op => {
              const effective = getEffectiveTier(op);
              const defaultTier = defaults[op] ?? "FAST";
              const isOverridden = overrides[op] !== undefined;
              const label = operationLabels[op] ?? op;
              const desc = OPERATION_DESCRIPTIONS[op] ?? "";

              return (
                <div key={op} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{label}</span>
                        {isOverridden ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Overridden</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">Default</span>
                        )}
                      </div>
                      {desc && <div className="text-[11px] text-gray-400 mt-0.5">{desc}</div>}
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => resetToDefault(op)}
                          className="mt-1 text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                        >
                          Reset to default ({defaultTier === "FAST" ? "Fast" : "Smart"})
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <TierPill tier="FAST"  active={effective === "FAST"}  onClick={() => toggleTier(op, "FAST")} />
                      <TierPill tier="SMART" active={effective === "SMART"} onClick={() => toggleTier(op, "SMART")} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {hasOverrides && (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              {Object.keys(overrides).filter(op => overrides[op] !== undefined).length} operation{Object.keys(overrides).filter(op => overrides[op] !== undefined).length !== 1 ? "s" : ""} overriding the global default.
            </div>
          )}

          {saveErr && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-100">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> {saveErr}
            </div>
          )}
          <SaveButton pending={saving} success={saveOk} label="Save Model Settings" />
        </form>
      </SectionCard>
    </div>
  );
}

// ── Main Settings Page ──────────────────────────────────────────────────────────
export default function Settings() {
  const authUser = useAuthUser();
  const isOwner      = authUser?.role === "owner";
  const isPrivileged = authUser?.role === "owner" || authUser?.role === "admin";
  const TABS = ALL_TABS.filter(t => {
    if (t.ownerOnly) return isOwner;
    if (t.adminOnly) return isPrivileged;
    return true;
  });

  const initialTab = (): Tab => {
    const param = new URLSearchParams(window.location.search).get("tab");
    const allowed = TABS.some((t) => t.id === param);
    return (allowed ? param : "profile") as Tab;
  };
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  const handleSetTab = (id: Tab) => {
    const allowed = TABS.some(t => t.id === id);
    setActiveTab(allowed ? id : "profile");
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-gray-900">Settings</h1>
        <p className="text-xs text-gray-400 mt-0.5">Manage your account, company branding, and integrations</p>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleSetTab(id)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
            style={activeTab === id
              ? { background: "#fff", color: "#111827", boxShadow: "0 1px 3px rgba(0,0,0,0.10)" }
              : { color: "#6B7280" }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className={activeTab === "profile"      ? undefined : "hidden"}><ProfileTab /></div>
      <div className={activeTab === "company"      ? undefined : "hidden"}><CompanyTab /></div>
      {isPrivileged && <div className={activeTab === "email"    ? undefined : "hidden"}><EmailTab /></div>}
      {isPrivileged && <div className={activeTab === "whatsapp" ? undefined : "hidden"}><WhatsAppTab /></div>}
      <div className={activeTab === "integrations" ? undefined : "hidden"}><IntegrationsTab onSwitchTab={handleSetTab} /></div>
      <div className={activeTab === "team"         ? undefined : "hidden"}><TeamTab /></div>
      {isOwner && <div className={activeTab === "ai" ? undefined : "hidden"}><ModelIntelligenceTab /></div>}
    </div>
  );
}
