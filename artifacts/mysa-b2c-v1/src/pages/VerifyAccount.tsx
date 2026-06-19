import { useState, useEffect, useRef, type FormEvent } from "react";
import { CheckCircle2, Mail, Phone, LogOut, RefreshCw } from "lucide-react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { getFirebaseAuth, firebaseConfigured } from "../lib/firebase";
import { useAuthUser } from "@/contexts/AuthContext";

interface VerifyAccountProps {
  onVerified: () => void;
}

const COUNTRY_CODES = [
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

export default function VerifyAccount({ onVerified }: VerifyAccountProps) {
  const user = useAuthUser();

  const isSyntheticEmail = user?.email?.endsWith("@otp.mysa.internal") ?? false;
  const emailVerified    = !!(user?.isVerified && !isSyntheticEmail);
  const phoneVerified    = !!(user?.phoneVerified);

  // ── Email section state ───────────────────────────────────────────────────
  const [emailInput,    setEmailInput]    = useState("");
  const [emailLoading,  setEmailLoading]  = useState(false);
  const [emailError,    setEmailError]    = useState("");
  const [emailSent,     setEmailSent]     = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const resendTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Phone section state ───────────────────────────────────────────────────
  type PhoneStep = "phone" | "otp";
  const [phoneStep,    setPhoneStep]    = useState<PhoneStep>("phone");
  const [countryCode,  setCountryCode]  = useState("+91");
  const [phoneNumber,  setPhoneNumber]  = useState("");
  const [otpCode,      setOtpCode]      = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError,   setPhoneError]   = useState("");
  const [otpSendSecs,  setOtpSendSecs]  = useState(0);
  const [phoneDone,    setPhoneDone]    = useState(false);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef    = useRef<RecaptchaVerifier | null>(null);
  const otpTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-check verification status every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => { onVerified(); }, 8000);
    return () => clearInterval(interval);
  }, [onVerified]);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
      if (otpTimerRef.current)    clearInterval(otpTimerRef.current);
      recaptchaRef.current?.clear();
    };
  }, []);

  // ── Email helpers ─────────────────────────────────────────────────────────
  function startResendCooldown() {
    setResendSeconds(60);
    resendTimerRef.current = setInterval(() => {
      setResendSeconds(s => { if (s <= 1) { clearInterval(resendTimerRef.current!); return 0; } return s - 1; });
    }, 1000);
  }

  async function handleSubmitEmail(e: FormEvent) {
    e.preventDefault();
    setEmailError("");
    const val = emailInput.trim().toLowerCase();
    if (!val || !val.includes("@")) { setEmailError("Enter a valid email address."); return; }
    setEmailLoading(true);
    try {
      const res = await fetch("/api/users/me", {
        method:      "PATCH",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ email: val }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setEmailError(body.error ?? "Failed to save email."); return; }
      setEmailSent(true);
      startResendCooldown();
    } catch {
      setEmailError("Network error. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  }

  async function handleResendEmail() {
    if (resendSeconds > 0) return;
    setEmailError("");
    setEmailLoading(true);
    const emailToResend = user?.pendingEmail ?? user?.email ?? emailInput.trim();
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ email: emailToResend }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setEmailError(body.error ?? "Failed to resend email."); return; }
      setEmailSent(true);
      startResendCooldown();
    } catch {
      setEmailError("Network error. Please try again.");
    } finally {
      setEmailLoading(false);
    }
  }

  // ── Phone helpers ─────────────────────────────────────────────────────────
  function startOtpCooldown() {
    setOtpSendSecs(60);
    otpTimerRef.current = setInterval(() => {
      setOtpSendSecs(s => { if (s <= 1) { clearInterval(otpTimerRef.current!); return 0; } return s - 1; });
    }, 1000);
  }

  async function handleSendOtp(e?: FormEvent) {
    e?.preventDefault();
    setPhoneError("");
    const digits = phoneNumber.replace(/\D/g, "");
    if (!digits || digits.length < 7) { setPhoneError("Enter a valid phone number."); return; }
    const fullPhone = `${countryCode}${digits}`;
    setPhoneLoading(true);
    try {
      const auth = getFirebaseAuth();
      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, "recaptcha-container-verify", { size: "invisible" });
      }
      const confirmation = await signInWithPhoneNumber(auth, fullPhone, recaptchaRef.current);
      confirmationRef.current = confirmation;
      setPhoneStep("otp");
      startOtpCooldown();
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("invalid-phone-number")) setPhoneError("Invalid phone number.");
      else if (msg.includes("too-many-requests")) setPhoneError("Too many attempts. Wait a few minutes.");
      else setPhoneError("Failed to send OTP. Please try again.");
      recaptchaRef.current?.clear();
      recaptchaRef.current = null;
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    if (!confirmationRef.current) return;
    setPhoneError("");
    setPhoneLoading(true);
    try {
      const result  = await confirmationRef.current.confirm(otpCode);
      const idToken = await result.user.getIdToken();
      const res = await fetch("/api/auth/otp/link-phone", {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body:        JSON.stringify({ idToken }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setPhoneError(body.error ?? "Verification failed."); return; }
      setPhoneDone(true);
      // Short delay then re-check full verification status
      setTimeout(() => onVerified(), 800);
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("invalid-verification-code")) setPhoneError("Wrong code. Try again.");
      else if (msg.includes("code-expired")) setPhoneError("Code expired. Request a new one.");
      else setPhoneError("Verification failed. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.reload();
  }

  const emailDisplayAddress = user?.pendingEmail ?? (isSyntheticEmail ? "" : user?.email ?? "");
  const showEmailInput       = isSyntheticEmail && !emailSent && !user?.pendingEmail;
  const showEmailPending     = !emailVerified && (emailSent || !!user?.pendingEmail);
  const showEmailVerified    = emailVerified;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
         style={{ background: "linear-gradient(135deg, #0d2318 0%, #1A3D2B 45%, #12502e 100%)" }}>

      {/* reCAPTCHA anchor */}
      <div id="recaptcha-container-verify" />

      {/* Header */}
      <div className="mb-8 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
               style={{ background: "rgba(255,255,255,0.15)" }}>
            <span className="text-xl">⚡</span>
          </div>
          <span className="text-white font-bold text-xl">Mysa AI</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Verify your email</h1>
        <p className="text-sm mt-1" style={{ color: "rgba(255,255,255,0.65)" }}>
          Click the link we sent to your inbox to activate your account.
        </p>
      </div>

      <div className="w-full max-w-md space-y-4">

        {/* ── Email Card ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div className="flex items-center gap-3 mb-4">
            {showEmailVerified
              ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
              : <Mail className="w-5 h-5 shrink-0" style={{ color: "rgba(255,255,255,0.7)" }} />}
            <div>
              <p className="font-semibold text-white text-sm">Email verification</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {showEmailVerified ? "Verified ✓" : "Click the link we send to your inbox"}
              </p>
            </div>
          </div>

          {showEmailVerified && (
            <p className="text-sm text-green-400 font-medium">{user?.email}</p>
          )}

          {showEmailInput && (
            <form onSubmit={handleSubmitEmail} className="space-y-3">
              <input
                type="email"
                placeholder="you@example.com"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff" }}
              />
              {emailError && <p className="text-red-400 text-xs">{emailError}</p>}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full py-2.5 rounded-xl font-semibold text-sm transition-opacity disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #4F35A8, #7C3AED)", color: "#fff" }}
              >
                {emailLoading ? "Sending…" : "Send verification email"}
              </button>
            </form>
          )}

          {showEmailPending && (
            <div className="space-y-3">
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                Verification link sent to <span className="font-semibold text-white">{emailDisplayAddress}</span>.
                Check your inbox and click the link.
              </p>
              {emailError && <p className="text-red-400 text-xs">{emailError}</p>}
              <button
                onClick={handleResendEmail}
                disabled={resendSeconds > 0 || emailLoading}
                className="text-sm font-medium disabled:opacity-50 transition-opacity"
                style={{ color: "#a78bfa" }}
              >
                {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend verification email"}
              </button>
            </div>
          )}
        </div>

        {/* ── Phone Card ─────────────────────────────────────────────────── */}
        <div className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div className="flex items-center gap-3 mb-4">
            {(phoneVerified || phoneDone)
              ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
              : <Phone className="w-5 h-5 shrink-0" style={{ color: "rgba(255,255,255,0.7)" }} />}
            <div>
              <p className="font-semibold text-white text-sm">Phone verification</p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {(phoneVerified || phoneDone) ? "Verified ✓" : "We'll send a 6-digit OTP via SMS"}
              </p>
            </div>
          </div>

          {(phoneVerified || phoneDone) && (
            <p className="text-sm text-green-400 font-medium">{user?.phone ?? "Phone verified"}</p>
          )}

          {!phoneVerified && !phoneDone && firebaseConfigured && (
            <>
              {phoneStep === "phone" && (
                <form onSubmit={handleSendOtp} className="space-y-3">
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={e => setCountryCode(e.target.value)}
                      className="px-3 py-2.5 rounded-xl text-sm outline-none shrink-0"
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff" }}
                    >
                      {COUNTRY_CODES.map(c => (
                        <option key={c.code} value={c.code} style={{ background: "#1a1a2e" }}>
                          {c.flag} {c.code}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={phoneNumber}
                      onChange={e => setPhoneNumber(e.target.value)}
                      className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff" }}
                    />
                  </div>
                  {phoneError && <p className="text-red-400 text-xs">{phoneError}</p>}
                  <button
                    type="submit"
                    disabled={phoneLoading}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm transition-opacity disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #4F35A8, #7C3AED)", color: "#fff" }}
                  >
                    {phoneLoading ? "Sending…" : "Send OTP"}
                  </button>
                </form>
              )}

              {phoneStep === "otp" && (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  <p className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
                    OTP sent to <span className="font-semibold text-white">{countryCode}{phoneNumber}</span>
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full px-4 py-2.5 rounded-xl text-sm tracking-[0.3em] text-center outline-none"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff" }}
                    autoFocus
                  />
                  {phoneError && <p className="text-red-400 text-xs">{phoneError}</p>}
                  <button
                    type="submit"
                    disabled={phoneLoading || otpCode.length < 6}
                    className="w-full py-2.5 rounded-xl font-semibold text-sm transition-opacity disabled:opacity-60"
                    style={{ background: "linear-gradient(135deg, #4F35A8, #7C3AED)", color: "#fff" }}
                  >
                    {phoneLoading ? "Verifying…" : "Verify & continue"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPhoneStep("phone"); setOtpCode(""); setPhoneError(""); }}
                    disabled={otpSendSecs > 0}
                    className="w-full text-sm disabled:opacity-50"
                    style={{ color: "#a78bfa" }}
                  >
                    {otpSendSecs > 0 ? `Resend in ${otpSendSecs}s` : "← Change number"}
                  </button>
                </form>
              )}
            </>
          )}

          {!phoneVerified && !phoneDone && !firebaseConfigured && (
            <p className="text-sm text-yellow-400">Phone verification is not configured. Contact support.</p>
          )}
        </div>

        {/* ── Status / refresh ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={onVerified}
            className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            I've verified my email — check again
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-80"
            style={{ color: "rgba(255,255,255,0.45)" }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
