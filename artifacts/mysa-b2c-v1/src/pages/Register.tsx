import { useState, useEffect, useRef, type FormEvent } from "react";
import { ArrowRight, ChevronLeft, Phone } from "lucide-react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { getFirebaseAuth, firebaseConfigured } from "../lib/firebase";

interface RegisterProps {
  onSuccess: () => void;
  onLoginClick: () => void;
}

type Step = "idle" | "phone" | "otp";

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

const TEAM_SIZES = ["Just me", "2–5", "6–10", "11–25", "26–50", "51–100", "100+"];

export default function Register({ onSuccess, onLoginClick }: RegisterProps) {
  const [step,          setStep]          = useState<Step>("idle");
  const [countryCode,   setCountryCode]   = useState("+91");
  const [phoneNumber,   setPhoneNumber]   = useState("");
  const [otpCode,       setOtpCode]       = useState("");
  const [phoneLoading,  setPhoneLoading]  = useState(false);
  const [phoneError,    setPhoneError]    = useState("");
  const [resendSecs,    setResendSecs]    = useState(0);
  const [otpEnabled,    setOtpEnabled]    = useState(false);
  const [verifiedPhone, setVerifiedPhone] = useState("");

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profFirstName,    setProfFirstName]    = useState("");
  const [profLastName,     setProfLastName]     = useState("");
  const [profEmail,        setProfEmail]        = useState("");
  const [profCity,         setProfCity]         = useState("");
  const [profCompany,      setProfCompany]      = useState("");
  const [profDesignation,  setProfDesignation]  = useState("");
  const [profTeamSize,     setProfTeamSize]     = useState("");
  const [profLoading,      setProfLoading]      = useState(false);
  const [profError,        setProfError]        = useState("");
  const [profEmailSent,    setProfEmailSent]    = useState(false);

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
  }, []);

  useEffect(() => {
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
        recaptchaRef.current = new RecaptchaVerifier(auth, "recaptcha-container-reg", { size: "invisible" });
      }
      const confirmation = await signInWithPhoneNumber(auth, fullPhone, recaptchaRef.current);
      confirmationRef.current = confirmation;
      setStep("otp");
      startResendTimer();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const msg  = (err as { message?: string }).message ?? "";
      if (code === "auth/invalid-phone-number" || msg.includes("invalid-phone-number")) {
        setPhoneError("Invalid phone number. Check the country code and digits.");
      } else if (code === "auth/too-many-requests" || msg.includes("too-many-requests")) {
        setPhoneError("Too many attempts. Please wait a few minutes.");
      } else if (code === "auth/unauthorized-domain" || msg.includes("unauthorized-domain")) {
        setPhoneError("This domain is not authorised for phone sign-in.");
      } else {
        setPhoneError("Failed to send OTP. Please try again.");
      }
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
      const res = await fetch("/api/auth/otp/firebase-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setPhoneError((body as { error?: string }).error ?? "Verification failed. Please try again.");
        return;
      }
      const body = await res.json().catch(() => ({})) as { isNewUser?: boolean };
      setVerifiedPhone(`${countryCode}${phoneNumber.replace(/\D/g, "")}`);
      if (body.isNewUser) { setShowProfileModal(true); } else { onSuccess(); }
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("invalid-verification-code")) setPhoneError("Wrong code. Please check and try again.");
      else if (msg.includes("code-expired")) setPhoneError("Code expired. Request a new one.");
      else setPhoneError("Verification failed. Please try again.");
    } finally {
      setPhoneLoading(false);
    }
  }

  async function handleProfileSave(e: FormEvent) {
    e.preventDefault();
    setProfError("");
    if (!profFirstName.trim()) { setProfError("First name is required."); return; }
    setProfLoading(true);
    try {
      const body: Record<string, string> = { firstName: profFirstName.trim() };
      if (profLastName.trim())    body.lastName    = profLastName.trim();
      if (profEmail.trim())       body.email       = profEmail.trim();
      if (profCity.trim())        body.city        = profCity.trim();
      if (profCompany.trim())     body.companyName = profCompany.trim();
      if (profDesignation.trim()) body.designation = profDesignation.trim();
      if (profTeamSize)           body.teamSize    = profTeamSize;
      const res = await fetch("/api/users/me", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setProfError((data as { error?: string }).error ?? "Couldn't save your profile.");
        return;
      }
      const data = await res.json().catch(() => ({})) as { verificationEmailSent?: boolean };
      if (data.verificationEmailSent) { setProfEmailSent(true); } else { onSuccess(); }
    } catch { setProfError("Connection error. Please try again."); }
    finally { setProfLoading(false); }
  }

  function resetPhoneFlow() {
    setStep("idle"); setPhoneNumber(""); setOtpCode(""); setPhoneError(""); setResendSecs(0);
    confirmationRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    recaptchaRef.current?.clear(); recaptchaRef.current = null;
  }

  const inputBase = "w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all border bg-white text-gray-900 placeholder-gray-400 focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/10";
  const inputSm   = "w-full px-3 py-2.5 rounded-xl text-[13px] outline-none transition-all border bg-white text-gray-900 placeholder-gray-400 focus:border-[#7C3AED] focus:ring-2 focus:ring-[#7C3AED]/10";

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden"
      style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: "linear-gradient(150deg, #050210 0%, #0D0425 25%, #1E0A3C 55%, #2D1B69 80%, #4C1D95 100%)" }}
    >
      {/* ── Full-screen background decorations (mobile only) ── */}
      <div className="lg:hidden absolute inset-0 pointer-events-none">
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.045) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }} />
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse 380px 300px at 15% 20%, rgba(167,139,250,0.22) 0%, transparent 70%), radial-gradient(ellipse 280px 220px at 85% 75%, rgba(109,40,217,0.28) 0%, transparent 70%)",
        }} />
        {/* Floating orbs */}
        <div style={{
          position: "absolute", top: "8%", right: "10%",
          width: 120, height: 120, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)",
          filter: "blur(20px)",
        }} />
        <div style={{
          position: "absolute", bottom: "20%", left: "5%",
          width: 160, height: 160, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)",
          filter: "blur(24px)",
        }} />
      </div>

      {/* ── Desktop left panel ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[460px] flex-shrink-0 px-12 py-12 relative overflow-hidden"
        style={{ background: "linear-gradient(150deg, #050210 0%, #0D0425 25%, #1E0A3C 55%, #2D1B69 80%, #4C1D95 100%)" }}
      >
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 500px 400px at 20% 80%, rgba(167,139,250,0.14) 0%, transparent 65%), radial-gradient(ellipse 350px 300px at 85% 15%, rgba(124,58,237,0.18) 0%, transparent 65%)" }} />
        <div className="flex items-center gap-3 relative z-10">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-base" style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(196,181,253,0.25)" }}>⚡</div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "white", letterSpacing: "-0.025em" }}>Mysa AI</span>
        </div>
        <div className="relative z-10">
          <div style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "#A78BFA", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.2)", padding: "5px 14px", borderRadius: 100, marginBottom: 24 }}>AI Sales Automation</div>
          <h2 style={{ fontSize: "clamp(26px,2.2vw,34px)", fontWeight: 800, color: "white", lineHeight: 1.18, letterSpacing: "-0.025em", marginBottom: 16 }}>
            The AI sales platform for smarter,{" "}
            <span style={{ color: "#C4B5FD", textShadow: "0 0 40px rgba(167,139,250,0.4)" }}>faster revenue growth.</span>
          </h2>
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "rgba(255,255,255,0.55)", marginBottom: 40 }}>
            Build pipeline smarter, close deals faster, and simplify your tech stack with a unified platform built for modern sales teams.
          </p>
          <div className="space-y-3">
            {["AI-powered lead scoring & qualification", "Automated outreach via email & WhatsApp", "Real-time pipeline & deal tracking", "HubSpot, Google Calendar integrations"].map(f => (
              <div key={f} className="flex items-center gap-3">
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(167,139,250,0.2)", border: "1px solid rgba(167,139,250,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#A78BFA" }} />
                </div>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.75)" }}>{f}</span>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.22)", position: "relative", zIndex: 10 }}>© {new Date().getFullYear()} Dreamsdesign · Mysa AI</p>
      </div>

      {/* ── Right / mobile panel ── */}
      <div className="flex-1 flex flex-col lg:bg-[#F5F3FF] relative z-10">

        {/* Mobile hero — visible only on mobile, only when idle */}
        {step === "idle" && (
          <div className="lg:hidden flex flex-col items-center text-center px-6 pt-16 pb-8">
            {/* Logo icon with glow */}
            <div className="relative mb-5">
              <div style={{ width: 68, height: 68, borderRadius: 22, background: "linear-gradient(135deg, rgba(109,40,217,0.5), rgba(167,139,250,0.25))", border: "1px solid rgba(196,181,253,0.35)", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
                <span style={{ fontSize: 30 }}>⚡</span>
              </div>
              <div style={{ position: "absolute", inset: -12, borderRadius: 34, background: "radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%)", pointerEvents: "none" }} />
            </div>

            {/* Brand */}
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "rgba(167,139,250,0.7)", marginBottom: 6 }}>Mysa AI</div>

            {/* Badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#A78BFA", background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", padding: "4px 12px", borderRadius: 100, marginBottom: 20 }}>
              AI Sales Automation
            </div>

            {/* Headline */}
            <h1 style={{ fontSize: 32, fontWeight: 900, color: "white", lineHeight: 1.12, letterSpacing: "-0.035em", marginBottom: 12 }}>
              Your AI sales brain<br />
              <span style={{ color: "#C4B5FD", textShadow: "0 0 30px rgba(167,139,250,0.35)" }}>starts here.</span>
            </h1>

            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.65, maxWidth: 270, marginBottom: 24 }}>
              Score leads, write outreach, and close deals faster — free forever.
            </p>

            {/* Stats chips */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {[{ val: "3×", label: "Pipeline growth" }, { val: "68%", label: "Faster outreach" }, { val: "41%", label: "More deals" }].map(({ val, label }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(196,181,253,0.15)", borderRadius: 100, padding: "5px 13px" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "white" }}>{val}</span>
                  <span style={{ fontSize: 11, color: "rgba(167,139,250,0.65)", fontWeight: 500 }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Form area */}
        <div className={`flex-1 flex flex-col items-center ${step === "idle" ? "justify-start lg:justify-center" : "justify-center"} px-5 pb-10 lg:py-12`}>

          {/* Desktop-only title */}
          {step === "idle" && (
            <div className="hidden lg:block w-full max-w-[400px] mb-8">
              <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111827", letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: 6 }}>Sign up for Mysa AI</h1>
              <p style={{ fontSize: 14, color: "#6B7280", lineHeight: 1.6 }}>Score leads, write outreach, and close deals faster — free to start.</p>
            </div>
          )}

          {/* ── Card: white card on mobile, plain on desktop ── */}
          <div
            className="w-full max-w-[400px] lg:bg-transparent lg:shadow-none lg:rounded-none lg:p-0"
            style={{
              background: "white",
              borderRadius: 24,
              boxShadow: "0 8px 48px rgba(0,0,0,0.28), 0 2px 12px rgba(0,0,0,0.12)",
              padding: "28px 22px",
            }}
          >
            {/* ── Phone OTP steps ── */}
            {step !== "idle" ? (
              <div>
                <button type="button" onClick={resetPhoneFlow}
                  className="flex items-center gap-1.5 mb-5"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#6B7280", fontSize: 13, fontWeight: 500, padding: 0 }}>
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>

                {step === "phone" && (
                  <>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.025em", lineHeight: 1.2, marginBottom: 5 }}>Enter your phone</h2>
                    <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 22 }}>We'll send a 6-digit SMS code to verify your number.</p>
                    <form onSubmit={handleSendOtp} className="space-y-4">
                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 6, color: "#374151" }}>Phone number</label>
                        <div className="flex gap-2">
                          <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
                            style={{ border: "1.5px solid #EDE9FE", borderRadius: 12, padding: "12px 10px", fontSize: 13, fontWeight: 600, color: "#374151", background: "white", outline: "none", cursor: "pointer", flexShrink: 0 }}>
                            {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                          </select>
                          <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                            placeholder="9876543210" autoFocus className={inputBase} style={{ border: "1.5px solid #EDE9FE" }} />
                        </div>
                      </div>
                      {phoneError && <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 12, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>{phoneError}</div>}
                      <button type="submit" disabled={phoneLoading} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
                        style={{ fontSize: 14, fontWeight: 700, color: "white", border: "none", background: phoneLoading ? "#9CA3AF" : "linear-gradient(135deg, #2D1B69, #7C3AED)", cursor: phoneLoading ? "not-allowed" : "pointer", boxShadow: phoneLoading ? "none" : "0 4px 14px rgba(109,40,217,0.3)" }}>
                        {phoneLoading ? "Sending…" : <><span>Send code</span><ArrowRight className="w-4 h-4" /></>}
                      </button>
                    </form>
                  </>
                )}

                {step === "otp" && (
                  <>
                    <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.025em", lineHeight: 1.2, marginBottom: 5 }}>Enter your code</h2>
                    <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 22 }}>
                      Sent to <strong>{countryCode}{phoneNumber}</strong>.
                    </p>
                    <form onSubmit={handleVerifyOtp} className="space-y-4">
                      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                        value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="123456" autoFocus className={inputBase}
                        style={{ border: "1.5px solid #EDE9FE", letterSpacing: "0.4em", textAlign: "center", fontSize: 24, fontWeight: 800 }} />
                      {phoneError && <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 12, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>{phoneError}</div>}
                      <button type="submit" disabled={phoneLoading || otpCode.length !== 6}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
                        style={{ fontSize: 14, fontWeight: 700, color: "white", border: "none", background: (phoneLoading || otpCode.length !== 6) ? "#9CA3AF" : "linear-gradient(135deg, #2D1B69, #7C3AED)", cursor: (phoneLoading || otpCode.length !== 6) ? "not-allowed" : "pointer", boxShadow: (phoneLoading || otpCode.length !== 6) ? "none" : "0 4px 14px rgba(109,40,217,0.3)" }}>
                        {phoneLoading ? "Verifying…" : <><span>Verify &amp; continue</span><ArrowRight className="w-4 h-4" /></>}
                      </button>
                      <div style={{ textAlign: "center", fontSize: 13, color: "#6B7280", paddingTop: 2 }}>
                        {resendSecs > 0 ? <span>Resend in {resendSecs}s</span> : (
                          <button type="button" onClick={() => { setStep("phone"); setOtpCode(""); setPhoneError(""); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "#6D28D9", fontWeight: 600, fontSize: 13 }}>Resend code</button>
                        )}
                      </div>
                    </form>
                  </>
                )}

                <div id="recaptcha-container-reg" />
              </div>
            ) : (
              /* ── Idle: 3 signup options ── */
              <div className="space-y-3">
                {/* Mobile-only label inside card */}
                <p className="lg:hidden text-center text-xs text-gray-400 font-medium pb-1">Choose how to get started</p>

                {/* Continue with Mobile — primary */}
                <button type="button"
                  onClick={() => {
                    if (otpEnabled) { setStep("phone"); setPhoneError(""); setOtpCode(""); }
                    else setPhoneError("Phone sign-in is not enabled on this server.");
                  }}
                  className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl transition-all"
                  style={{ fontSize: 15, fontWeight: 700, color: "white", border: "none", background: "linear-gradient(135deg, #2D1B69, #7C3AED)", cursor: "pointer", boxShadow: "0 4px 18px rgba(109,40,217,0.38)" }}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 22px rgba(109,40,217,0.5)")}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 4px 18px rgba(109,40,217,0.38)")}
                >
                  <Phone className="w-5 h-5" />
                  Continue with Mobile
                </button>

                {phoneError && step === "idle" && (
                  <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 12, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>{phoneError}</div>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px" style={{ background: "#F0EDFF" }} />
                  <span style={{ fontSize: 11, color: "#9CA3AF", fontWeight: 500 }}>or</span>
                  <div className="flex-1 h-px" style={{ background: "#F0EDFF" }} />
                </div>

                {/* Sign up with Google */}
                <button type="button" onClick={() => window.location.href = "/api/auth/google"}
                  className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl transition-all"
                  style={{ fontSize: 14, fontWeight: 600, color: "#374151", border: "1.5px solid #E9E7F3", background: "white", cursor: "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#C4B5FD"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(124,58,237,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#E9E7F3"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <svg width="19" height="19" viewBox="0 0 18 18">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/>
                  </svg>
                  Sign up with Google
                </button>

                {/* Sign up with Microsoft */}
                <button type="button" onClick={() => window.location.href = "/api/auth/microsoft"}
                  className="w-full flex items-center justify-center gap-3 py-3 rounded-2xl transition-all"
                  style={{ fontSize: 14, fontWeight: 600, color: "#374151", border: "1.5px solid #E9E7F3", background: "white", cursor: "pointer" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#C4B5FD"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(124,58,237,0.08)"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#E9E7F3"; e.currentTarget.style.boxShadow = "none"; }}
                >
                  <svg width="18" height="18" viewBox="0 0 22 22">
                    <rect fill="#F35325" x="0" y="0" width="10" height="10"/>
                    <rect fill="#81BC06" x="11" y="0" width="10" height="10"/>
                    <rect fill="#05A6F0" x="0" y="11" width="10" height="10"/>
                    <rect fill="#FFBA08" x="11" y="11" width="10" height="10"/>
                  </svg>
                  Sign up with Microsoft
                </button>
              </div>
            )}
          </div>

          {/* Sign in + terms — below card, on mobile they're on dark bg */}
          {step === "idle" && (
            <div className="mt-6 text-center w-full max-w-[400px]">
              <p style={{ fontSize: 13, marginBottom: 12 }}>
                <span className="text-white/60 lg:text-gray-500">Already have an account? </span>
                <button type="button" onClick={onLoginClick}
                  className="font-bold text-purple-300 lg:text-purple-700"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
                >Sign in</button>
              </p>
              <p style={{ fontSize: 11, lineHeight: 1.7 }}>
                <span className="text-white/30 lg:text-gray-400">By signing up, you agree to our </span>
                <a href="#" className="text-white/40 lg:text-gray-400" style={{ textDecoration: "underline" }}>Terms of Service</a>
                <span className="text-white/30 lg:text-gray-400"> and </span>
                <a href="#" className="text-white/40 lg:text-gray-400" style={{ textDecoration: "underline" }}>Privacy Policy</a>.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Complete your profile modal ── */}
      {showProfileModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
          <div style={{ background: "white", borderRadius: 24, padding: "32px 28px", width: "100%", maxWidth: 480, margin: "auto", boxShadow: "0 24px 64px rgba(0,0,0,0.28)" }}>
            {!profEmailSent ? (
              <>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div style={{ width: 54, height: 54, borderRadius: 15, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #2D1B69, #7C3AED)" }}>
                    <span style={{ fontSize: 26 }}>👤</span>
                  </div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: "-0.025em", margin: 0 }}>Complete your profile</h2>
                  <p style={{ fontSize: 13, color: "#6B7280", marginTop: 6, marginBottom: 0, lineHeight: 1.5 }}>Help us personalise your experience.</p>
                </div>
                <form onSubmit={handleProfileSave} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>First name <span style={{ color: "#7C3AED" }}>*</span></label>
                      <input type="text" value={profFirstName} onChange={e => setProfFirstName(e.target.value)} placeholder="Alex" autoFocus required className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Last name</label>
                      <input type="text" value={profLastName} onChange={e => setProfLastName(e.target.value)} placeholder="Smith" className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Work email</label>
                      <input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} placeholder="you@company.com" className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Phone no</label>
                      <input type="text" value={verifiedPhone} readOnly className={inputSm} style={{ border: "1.5px solid #EDE9FE", background: "#F9F8FF", color: "#6B7280", cursor: "default" }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>City</label>
                      <input type="text" value={profCity} onChange={e => setProfCity(e.target.value)} placeholder="Mumbai" className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Company name</label>
                      <input type="text" value={profCompany} onChange={e => setProfCompany(e.target.value)} placeholder="Acme Inc." className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Designation</label>
                      <input type="text" value={profDesignation} onChange={e => setProfDesignation(e.target.value)} placeholder="Sales Manager" className={inputSm} style={{ border: "1.5px solid #EDE9FE" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#374151" }}>Team members</label>
                      <select value={profTeamSize} onChange={e => setProfTeamSize(e.target.value)} className={inputSm}
                        style={{ border: "1.5px solid #EDE9FE", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center", paddingRight: 30 }}>
                        <option value="">Select…</option>
                        {TEAM_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  {profEmail && <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: -4 }}>A verification link will be sent to your email.</p>}
                  {profError && <div style={{ fontSize: 12, padding: "10px 14px", borderRadius: 12, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>{profError}</div>}
                  <button type="submit" disabled={profLoading} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl transition-all"
                    style={{ fontSize: 14, fontWeight: 700, color: "white", border: "none", background: profLoading ? "#9CA3AF" : "linear-gradient(135deg, #2D1B69, #7C3AED)", cursor: profLoading ? "not-allowed" : "pointer", boxShadow: profLoading ? "none" : "0 4px 14px rgba(109,40,217,0.3)", marginTop: 4 }}>
                    {profLoading ? "Saving…" : <><span>Get started</span><ArrowRight className="w-4 h-4" /></>}
                  </button>
                </form>
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <div style={{ width: 54, height: 54, borderRadius: 15, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #2D1B69, #7C3AED)" }}>
                  <span style={{ fontSize: 26 }}>✉️</span>
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginBottom: 8 }}>Check your inbox</h2>
                <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, marginBottom: 20 }}>
                  We sent a verification link to <strong style={{ color: "#6D28D9" }}>{profEmail}</strong>.<br />
                  Click it to confirm your email and access your account.
                </p>
                <button type="button" onClick={onSuccess} className="w-full py-3 rounded-xl transition-all"
                  style={{ fontSize: 14, fontWeight: 700, color: "white", border: "none", background: "linear-gradient(135deg, #2D1B69, #7C3AED)", cursor: "pointer", boxShadow: "0 4px 14px rgba(109,40,217,0.3)" }}>
                  Go to dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
