import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, XCircle, AlertCircle, Globe, Zap } from "lucide-react";
import { healthScoreColor } from "@/lib/utils";
import { parseIntelReport, generateReportHtml } from "@/components/IntelReport";

const API_BASE = "/api";

interface SignalResult {
  signalId: number;
  signalName: string;
  status: "present" | "missing" | "warning";
  severity: "critical" | "high" | "medium";
  categorySlug: string;
  categoryName: string;
  explanation?: string;
}

interface ShareData {
  id: number;
  company: string;
  website: string | null;
  healthScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  pageSpeedScore: number | null;
  aiReport: string | null;
  signals: SignalResult[];
  createdAt: string;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function SignalIcon({ status, severity }: { status: string; severity: string }) {
  if (status === "present") return <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />;
  if (severity === "critical") return <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />;
  if (severity === "high") return <XCircle className="w-4 h-4 text-orange-500 flex-shrink-0" />;
  return <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />;
}

function StatusBadge({ status, severity }: { status: string; severity: string }) {
  if (status === "present")
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">pass</span>;
  if (status === "warning")
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 font-medium">warning</span>;
  if (severity === "critical")
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">fail</span>;
  if (severity === "high")
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">fail</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 font-medium">fail</span>;
}

export default function AuditShare() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportHtmlUrl, setReportHtmlUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/audit/share/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("This link is invalid or has expired.");
        return res.json() as Promise<ShareData>;
      })
      .then((json) => {
        setData(json);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message ?? "Failed to load report.");
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    if (!data) return;
    const reportData = parseIntelReport(data.aiReport);
    if (!reportData) return;
    const dateLabel = new Date(data.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const html = generateReportHtml(reportData, dateLabel);
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setReportHtmlUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3 text-gray-500">
          <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading audit report…</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-sm px-4">
          <XCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h1 className="text-base font-semibold text-gray-800 mb-1">Report Not Found</h1>
          <p className="text-sm text-gray-500">{error ?? "This link is invalid or has expired."}</p>
        </div>
      </div>
    );
  }

  if (reportHtmlUrl) {
    return (
      <iframe
        src={reportHtmlUrl}
        style={{ width: "100vw", height: "100vh", border: "none", display: "block" }}
        title={`Brand Audit Report — ${data.company}`}
        sandbox="allow-same-origin allow-popups"
      />
    );
  }

  const groupedSignals = data.signals.reduce<Record<string, SignalResult[]>>((acc, sig) => {
    const key = sig.categorySlug;
    if (!acc[key]) acc[key] = [];
    acc[key].push(sig);
    return acc;
  }, {});

  const categories = Object.entries(groupedSignals).map(([slug, signals]) => ({
    slug,
    name: signals[0]?.categoryName ?? slug,
    signals,
  }));

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <style>{`
        @media print {
          body { font-size: 12px; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">

        {/* Header */}
        <div className="rounded-2xl overflow-hidden shadow-sm border border-gray-200 bg-white">
          <div className="px-6 py-5" style={{ background: "linear-gradient(135deg, #0D1B12 0%, #1a3d2b 100%)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5" style={{ color: "#34D399" }} />
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#34D399" }}>Brand Audit Report</span>
            </div>
            <h1 className="text-2xl font-black text-white">{data.company}</h1>
            {data.website && (
              <a
                href={data.website.startsWith("http") ? data.website : `https://${data.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 mt-1 text-sm hover:underline"
                style={{ color: "#6ee7b7" }}
              >
                <Globe className="w-3.5 h-3.5" />
                {data.website}
              </a>
            )}
            <div className="text-xs mt-2" style={{ color: "#6ee7b7" }}>Audited {formatDate(data.createdAt)}</div>
          </div>

          <div className="grid grid-cols-4 divide-x divide-gray-100">
            <div className="p-4 flex flex-col items-center">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Health Score</div>
              <div className="text-4xl font-black" style={{ color: healthScoreColor(data.healthScore) }}>{data.healthScore}</div>
              <div className="text-xs text-gray-400">/ 100</div>
              {data.pageSpeedScore !== null && (
                <div className="text-[10px] text-gray-400 mt-1">PageSpeed: {data.pageSpeedScore}</div>
              )}
            </div>
            {[
              { label: "Critical", count: data.criticalCount, color: "#ef4444" },
              { label: "High", count: data.highCount, color: "#f97316" },
              { label: "Medium", count: data.mediumCount, color: "#eab308" },
            ].map((item) => (
              <div key={item.label} className="p-4 flex flex-col items-center">
                <div className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">{item.label} Issues</div>
                <div className="text-3xl font-black" style={{ color: item.color }}>{item.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Report — fallback plain text for old-format reports */}
        {data.aiReport && (
          <div className="rounded-xl border border-gray-200 p-5 bg-white shadow-sm">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">AI Brand Report</div>
            <div className="space-y-3">
              {data.aiReport.split("\n\n").map((para, i) => (
                <p key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{para}</p>
              ))}
            </div>
          </div>
        )}

        {/* Signal categories */}
        {categories.map((cat) => {
          const missingCount = cat.signals.filter((s) => s.status !== "present").length;
          return (
            <div key={cat.slug} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">{cat.name}</span>
                {missingCount > 0
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-medium">{missingCount} issue{missingCount !== 1 ? "s" : ""}</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">all clear</span>
                }
              </div>
              <div className="divide-y divide-gray-50">
                {cat.signals.map((sig, idx) => (
                  <div key={sig.signalId} className={`flex items-start gap-3 px-4 py-3 ${idx % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                    <SignalIcon status={sig.status} severity={sig.severity} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-800">{sig.signalName}</span>
                        <StatusBadge status={sig.status} severity={sig.severity} />
                      </div>
                      {sig.explanation && (
                        <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{sig.explanation}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        <div className="text-center text-xs text-gray-400 pb-4">
          This is a read-only audit report. Generated by MysaAI.
        </div>
      </div>
    </div>
  );
}
