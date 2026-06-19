import { useState, useEffect, useRef } from "react";
import { useGetBrandingSettings, useUpdateBrandingSettings, useGetSmtpSettings } from "@workspace/api-client-react";
import { Mail, CheckCircle, XCircle, Loader2, Save, Palette, Upload, X, Send, Eye, Smartphone, ExternalLink } from "lucide-react";

export default function Settings() {
  const { data: brandingData, isLoading: brandingLoading } = useGetBrandingSettings();
  const { data: smtpData } = useGetSmtpSettings();

  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testPending, setTestPending] = useState(false);

  const [brandCompanyName, setBrandCompanyName] = useState("");
  const [brandTagline, setBrandTagline] = useState("");
  const [brandContactInfo, setBrandContactInfo] = useState("");
  const [brandColor, setBrandColor] = useState("#5C1A8C");
  const [brandLogoBase64, setBrandLogoBase64] = useState<string | null>(null);
  const [brandSaveSuccess, setBrandSaveSuccess] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [firebaseEnabled, setFirebaseEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/otp/available")
      .then((r): Promise<{ enabled: boolean } | null> => r.ok ? r.json() : Promise.resolve(null))
      .then((d) => setFirebaseEnabled(d?.enabled ?? false))
      .catch(() => setFirebaseEnabled(false));
  }, []);

  useEffect(() => {
    if (brandingData) {
      setBrandCompanyName(brandingData.companyName ?? "");
      setBrandTagline(brandingData.tagline ?? "");
      setBrandContactInfo(brandingData.contactInfo ?? "");
      setBrandColor(brandingData.brandColor ?? "#5C1A8C");
      setBrandLogoBase64(brandingData.logoBase64 ?? null);
    }
  }, [brandingData]);

  useEffect(() => {
    if (smtpData && !testEmail) {
      const prefill = smtpData.fromAddress ?? smtpData.user ?? "";
      if (prefill) setTestEmail(prefill);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smtpData]);

  const handleTestEmail = async () => {
    if (!testEmail) return;
    setTestPending(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/settings/smtp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: testEmail }),
      });
      const data = await resp.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: "Network error — could not reach the server." });
    } finally {
      setTestPending(false);
    }
  };

  const updateBranding = useUpdateBrandingSettings({
    mutation: {
      onSuccess: () => {
        setBrandSaveSuccess(true);
        setTimeout(() => setBrandSaveSuccess(false), 3000);
      },
    },
  });

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setBrandLogoBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleBrandSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateBranding.mutate({
      data: {
        companyName: brandCompanyName,
        tagline: brandTagline,
        contactInfo: brandContactInfo,
        brandColor: brandColor,
        logoBase64: brandLogoBase64 ?? "",
      },
    });
  };

  const inputClass = "w-full text-xs rounded-lg border border-gray-200 bg-white text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-colors";
  const labelClass = "block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5";

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your email sender and other preferences</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#F0FDF4" }}>
            <Mail className="w-4 h-4" style={{ color: "#1A7A45" }} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Email Delivery</div>
            <div className="text-[11px] text-muted-foreground">Powered by Brevo transactional email API</div>
          </div>
          <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
            <CheckCircle className="w-3 h-3" /> Active
          </span>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 text-[11px] text-green-800 flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-600" />
            <span>All outreach emails, proposals, and booking confirmations are sent via <strong>Brevo</strong> from <strong>info@dreamsdesign.ca</strong> with a BCC to sales@dreamsdesign.co.</span>
          </div>

          <div>
            <label className={labelClass}>Send a Test Email</label>
            <div className="flex gap-2">
              <input
                type="email"
                className={inputClass}
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="recipient@example.com"
              />
              <button
                type="button"
                onClick={handleTestEmail}
                disabled={testPending || !testEmail}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white whitespace-nowrap disabled:opacity-50 transition-colors"
                style={{ background: "#1A7A45" }}
              >
                {testPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Send className="w-3.5 h-3.5" />}
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
      </div>

      {/* ── Phone OTP / Firebase ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#FFF7ED" }}>
            <Smartphone className="w-4 h-4" style={{ color: "#C2410C" }} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Phone OTP / Firebase</div>
            <div className="text-[11px] text-muted-foreground">Allows users to sign in with a one-time SMS code</div>
          </div>
          {firebaseEnabled === null ? (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : firebaseEnabled ? (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              <CheckCircle className="w-3 h-3" /> Active
            </span>
          ) : (
            <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              <XCircle className="w-3 h-3" /> Not configured
            </span>
          )}
        </div>

        <div className="px-5 py-5 space-y-4">
          {firebaseEnabled ? (
            <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 text-[11px] text-green-800 flex items-start gap-2">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-green-600" />
              <span>All 6 Firebase environment variables are set. Phone sign-in is active for users on the login page.</span>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 flex items-start gap-2">
              <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-amber-600" />
              <span>
                Phone sign-in is built and ready but requires 6 environment variables to activate.
                Add them in your hosting platform's Secrets / Environment Variables panel, then restart the server.
              </span>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Backend secrets (server-side)</p>
            {[
              {
                name: "FIREBASE_PROJECT_ID",
                desc: "Your Firebase project ID",
                where: "Firebase Console → Project Settings → General → Project ID",
              },
              {
                name: "FIREBASE_CLIENT_EMAIL",
                desc: "Service account email address",
                where: "Project Settings → Service accounts → Generate new private key → client_email",
              },
              {
                name: "FIREBASE_PRIVATE_KEY",
                desc: "Service account private key (keep \\n escape sequences)",
                where: "Same JSON download → private_key field",
              },
            ].map(({ name, desc, where }) => (
              <div key={name} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <code className="text-[10px] font-mono font-semibold text-orange-700 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5">{name}</code>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-800 font-medium">{desc}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">📍 {where}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Frontend variables (client-side)</p>
            {[
              {
                name: "VITE_FIREBASE_API_KEY",
                desc: "Web API key for the Firebase client SDK",
                where: "Firebase Console → Project Settings → General → Web API Key",
              },
              {
                name: "VITE_FIREBASE_PROJECT_ID",
                desc: "Same project ID as above (needed by the client SDK)",
                where: "Project Settings → General → Project ID",
              },
              {
                name: "VITE_FIREBASE_APP_ID",
                desc: "Your web app's Firebase App ID",
                where: "Project Settings → General → Your apps → App ID",
              },
            ].map(({ name, desc, where }) => (
              <div key={name} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <code className="text-[10px] font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded whitespace-nowrap mt-0.5">{name}</code>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-800 font-medium">{desc}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">📍 {where}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-[11px] text-gray-600 space-y-1">
            <p className="font-semibold text-gray-700">Setup steps</p>
            <ol className="list-decimal list-inside space-y-1 text-[10px]">
              <li>Go to the <strong>Firebase Console</strong> and create or open your project.</li>
              <li>Enable <strong>Phone</strong> as a sign-in provider under Authentication → Sign-in method.</li>
              <li>Generate a service account key (Project Settings → Service accounts) and copy the three backend values above.</li>
              <li>Register a <strong>Web app</strong> in Project Settings → General and copy the three frontend values above.</li>
              <li>Add all 6 variables to your secrets panel and restart the API server.</li>
            </ol>
          </div>

          {/* ── Production domain ── */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-[11px] text-blue-800 space-y-1.5">
            <p className="font-semibold text-blue-900">Production domain (required before publishing)</p>
            <p className="text-[10px]">
              Firebase blocks phone sign-in on any domain not explicitly whitelisted.
              After you publish the app, add your live domain to Firebase Console:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[10px] text-blue-700">
              <li>Open Firebase Console → <strong>Authentication</strong> → <strong>Settings</strong> → <strong>Authorized domains</strong></li>
              <li>Click <strong>Add domain</strong> and enter your published <code className="bg-blue-100 px-1 rounded font-mono">*.replit.app</code> URL (e.g. <code className="bg-blue-100 px-1 rounded font-mono">mysa-ai.replit.app</code>)</li>
              <li>Save — phone OTP will work instantly on that domain with no code changes</li>
            </ol>
          </div>

          <a
            href="https://console.firebase.google.com/project/mysaai-aaf3f/authentication/settings"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open Firebase Authorized Domains
          </a>
        </div>
      </div>

      {/* ── Branding Settings ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#F5F3FF" }}>
            <Palette className="w-4 h-4" style={{ color: "#5C1A8C" }} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">PDF Report Branding</div>
            <div className="text-[11px] text-muted-foreground">Customize the logo, colors, and footer shown on exported audit PDFs</div>
          </div>
        </div>

        {brandingLoading ? (
          <div className="px-5 py-8 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form onSubmit={handleBrandSave} className="px-5 py-5 space-y-4">
            <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2.5 text-[11px] text-purple-700">
              These settings appear in the header and footer of exported audit PDF reports.
            </div>

            {/* Logo upload */}
            <div>
              <label className={labelClass}>Company Logo</label>
              <div className="flex items-center gap-3">
                {brandLogoBase64 ? (
                  <div className="relative flex-shrink-0">
                    <img
                      src={brandLogoBase64}
                      alt="Logo preview"
                      className="h-10 max-w-[120px] object-contain rounded border border-gray-200 bg-gray-50 p-1"
                    />
                    <button
                      type="button"
                      onClick={() => { setBrandLogoBase64(null); if (logoInputRef.current) logoInputRef.current.value = ""; }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ) : (
                  <div className="w-16 h-10 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-gray-300">
                    <Upload className="w-4 h-4" />
                  </div>
                )}
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                    id="logo-upload"
                  />
                  <label
                    htmlFor="logo-upload"
                    className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {brandLogoBase64 ? "Replace Logo" : "Upload Logo"}
                  </label>
                  <p className="mt-1 text-[10px] text-muted-foreground">PNG, JPG, or WebP. Displayed in the PDF header.</p>
                </div>
              </div>
            </div>

            {/* Company name */}
            <div>
              <label className={labelClass}>Company Name</label>
              <input
                type="text"
                className={inputClass}
                value={brandCompanyName}
                onChange={(e) => setBrandCompanyName(e.target.value)}
                placeholder="Acme Corp"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Shown in the PDF footer alongside your contact info</p>
            </div>

            {/* Tagline */}
            <div>
              <label className={labelClass}>Tagline</label>
              <input
                type="text"
                className={inputClass}
                value={brandTagline}
                onChange={(e) => setBrandTagline(e.target.value)}
                placeholder="Your Trusted Growth Partner"
              />
            </div>

            {/* Contact info */}
            <div>
              <label className={labelClass}>Contact Info / Footer Text</label>
              <input
                type="text"
                className={inputClass}
                value={brandContactInfo}
                onChange={(e) => setBrandContactInfo(e.target.value)}
                placeholder="hello@yourcompany.com  ·  +1 555 123 4567"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Shown at the bottom of every PDF page</p>
            </div>

            {/* Brand color */}
            <div>
              <label className={labelClass}>Brand Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="w-10 h-8 rounded border border-gray-200 cursor-pointer p-0.5 bg-white"
                />
                <input
                  type="text"
                  className={inputClass + " w-32 font-mono"}
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#5C1A8C"
                  maxLength={7}
                />
                <div
                  className="w-8 h-8 rounded-lg border border-gray-200 flex-shrink-0"
                  style={{ background: brandColor }}
                />
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Used for the PDF header and footer background</p>
            </div>

            {brandSaveSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 flex items-center gap-2 text-xs text-green-700">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                Branding saved successfully.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={updateBranding.isPending}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-colors"
                style={{ background: "#5C1A8C" }}
              >
                {updateBranding.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                Save Branding
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── PDF Header & Footer Preview ── */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#F5F3FF" }}>
            <Eye className="w-4 h-4" style={{ color: "#5C1A8C" }} />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">PDF Header & Footer Preview</div>
            <div className="text-[11px] text-muted-foreground">Updates live as you edit the fields above — no need to export to check</div>
          </div>
        </div>

        <div className="px-5 py-5">
          <div
            className="rounded-lg border border-gray-200 overflow-hidden bg-white"
            style={{ boxShadow: "inset 0 1px 4px rgba(0,0,0,0.06)" }}
          >
            {/* ── Mini Header ── */}
            <div style={{ background: brandColor, padding: "10px 16px 0 16px", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 9 }}>
                {brandLogoBase64 ? (
                  <img
                    src={brandLogoBase64}
                    alt="Logo"
                    style={{ height: 30, maxWidth: 90, objectFit: "contain", flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 30,
                      background: "rgba(255,255,255,0.18)",
                      borderRadius: 4,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 9, fontWeight: 600, letterSpacing: "0.05em" }}>LOGO</span>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 13, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {brandCompanyName || <span style={{ opacity: 0.45 }}>Company Name</span>}
                  </div>
                  {brandTagline && (
                    <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 9, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {brandTagline}
                    </div>
                  )}
                </div>
                {/* Decorative magenta blob */}
                <div style={{ position: "absolute", right: 12, top: 6, width: 44, height: 30, borderRadius: "50%", background: "#E91E8C", opacity: 0.28, filter: "blur(7px)", pointerEvents: "none" }} />
              </div>
              {/* Magenta accent bar */}
              <div style={{ height: 3, background: "#E91E8C", margin: "0 -16px" }} />
            </div>

            {/* Sub-info row */}
            <div style={{ background: "#F9FAFB", padding: "5px 16px", display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid #E5E7EB" }}>
              <span style={{ fontSize: 9, color: "#6B7280" }}>Brand Audit Report</span>
              <span style={{ marginLeft: "auto", fontSize: 9, color: "#E91E8C", fontWeight: 600 }}>example.com</span>
              <span style={{ fontSize: 9, color: "#9CA3AF" }}>
                · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>

            {/* Page body placeholder */}
            <div style={{ padding: "14px 16px 14px", background: "#FAFAFA" }}>
              <div style={{ height: 9, background: "#E5E7EB", borderRadius: 4, marginBottom: 7, width: "65%" }} />
              <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, marginBottom: 5, width: "90%" }} />
              <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, marginBottom: 5, width: "82%" }} />
              <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, marginBottom: 5, width: "74%" }} />
              <div style={{ height: 6, background: "#F3F4F6", borderRadius: 3, width: "55%" }} />
            </div>

            {/* ── Mini Footer ── */}
            <div style={{ background: brandColor, position: "relative" }}>
              {/* Magenta accent on top edge */}
              <div style={{ height: 2, background: "#E91E8C" }} />
              <div style={{ padding: "6px 16px 7px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, textAlign: "center", overflow: "hidden" }}>
                  <span style={{ color: "rgba(255,255,255,0.78)", fontSize: 8, whiteSpace: "nowrap" }}>
                    {[brandCompanyName, brandTagline, brandContactInfo].filter(Boolean).join(" · ") || "Generated by Sales War Machine"}
                  </span>
                </div>
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 8, flexShrink: 0 }}>Page 1</span>
              </div>
            </div>
          </div>

          <p className="mt-2.5 text-[10px] text-muted-foreground text-center">
            This is a scaled preview — save your settings to apply these styles to all exported PDF reports.
          </p>
        </div>
      </div>

    </div>
  );
}
