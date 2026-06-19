import { useState, useRef, useEffect } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  useListAuditCategories,
  useGetAudit,
  useListLeads,
  useGetAuditHistory,
  useGetAuditRun,
  useUpdateAudit,
  useUpdateAuditRun,
  useListAuditBank,
  useDeleteAuditRun,
  useClearAuditHistory,
  useGetBrandingSettings,
} from "@workspace/api-client-react";
import {
  getListAuditCategoriesQueryKey,
  getGetAuditQueryKey,
  getListLeadsQueryKey,
  getGetAuditHistoryQueryKey,
  getGetAuditRunQueryKey,
  getListAuditBankQueryKey,
} from "@workspace/api-client-react";
import type { Lead, AuditRunSummary, AuditSignalResult, AuditBankEntry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Search,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  Loader2,
  Info,
  History,
  ChevronRight,
  Clock,
  Download,
  Database,
  Building2,
  Globe,
  TrendingUp,
  Trash2,
  Link,
  Check,
  MapPin,
} from "lucide-react";
import { auditScoreHex, auditScoreLabel, auditScoreRgb } from "@/lib/utils";

const API_BASE = "/api";

interface CategoryResult {
  categorySlug: string;
  categoryName: string;
  signals: AuditSignalResult[];
}

interface AuditSummary {
  healthScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  pageSpeedScore: number | null;
  aiReport: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const SCAN_SIGNALS = [
  "Google Business Profile", "Website SSL", "Meta Title & Description", "Schema Markup",
  "Social Media Presence", "LinkedIn Profile", "Mobile Responsiveness", "PageSpeed Score",
  "Backlink Profile", "Brand Consistency", "Review Signals", "Content Quality",
  "HTTPS Redirect", "XML Sitemap", "Robots.txt", "Core Web Vitals",
  "Facebook Page", "Instagram Handle", "Twitter/X Profile", "YouTube Channel",
];

function GeneratingAnimation({ statusMsg }: { statusMsg: string }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [checkedCount, setCheckedCount] = useState(0);

  useEffect(() => {
    const showTimer = setInterval(() => {
      setVisibleCount((c) => (c < SCAN_SIGNALS.length ? c + 1 : c));
    }, 260);
    const checkTimer = setInterval(() => {
      setCheckedCount((c) => (c < SCAN_SIGNALS.length ? c + 1 : c));
    }, 380);
    return () => { clearInterval(showTimer); clearInterval(checkTimer); };
  }, []);

  return (
    <div className="p-8 flex flex-col items-center gap-6" style={{ background: "linear-gradient(135deg, #0D1B12 0%, #0f2218 100%)" }}>
      <style>{`
        @keyframes radar-ring { 0%{transform:scale(0.3);opacity:0.8} 100%{transform:scale(1.8);opacity:0} }
        @keyframes scan-beam  { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
        @keyframes blink-dot  { 0%,100%{opacity:1} 50%{opacity:0.2} }
        .radar-ring-1 { animation: radar-ring 2s ease-out infinite; }
        .radar-ring-2 { animation: radar-ring 2s ease-out 0.66s infinite; }
        .radar-ring-3 { animation: radar-ring 2s ease-out 1.33s infinite; }
        .scan-beam    { animation: scan-beam 2s linear infinite; }
        .blink-dot    { animation: blink-dot 1.2s ease-in-out infinite; }
      `}</style>

      {/* Radar animation */}
      <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
        {/* Rings */}
        {[1,2,3].map((n) => (
          <div
            key={n}
            className={`radar-ring-${n} absolute rounded-full border`}
            style={{ width: 88, height: 88, borderColor: "#34D39960", borderWidth: 1.5, top: 4, left: 4 }}
          />
        ))}
        {/* Radar circle base */}
        <div className="absolute rounded-full" style={{ width: 80, height: 80, top: 8, left: 8, background: "radial-gradient(circle, #1a3d2b 0%, #0d1b12 100%)", border: "1.5px solid #34D39940" }} />
        {/* Scan beam */}
        <div className="scan-beam absolute" style={{ width: 40, height: 40, top: 28, left: 48 }}>
          <div style={{ width: "100%", height: 2, background: "linear-gradient(to right, transparent, #34D399)", borderRadius: 1, transformOrigin: "0 1px" }} />
        </div>
        {/* Center dot */}
        <div className="blink-dot absolute rounded-full" style={{ width: 8, height: 8, background: "#34D399", boxShadow: "0 0 8px #34D399" }} />
      </div>

      {/* Text */}
      <div className="text-center">
        <div className="text-sm font-bold text-white tracking-wide mb-1">Scanning Brand Signals</div>
        <div className="text-xs" style={{ color: "#34D399" }}>
          {statusMsg || "Initialising AI audit engine..."}
        </div>
      </div>

      {/* Animated signal list */}
      <div className="w-full max-w-sm grid grid-cols-2 gap-1">
        {SCAN_SIGNALS.slice(0, visibleCount).map((sig, i) => {
          const isChecked = i < checkedCount;
          return (
            <div
              key={sig}
              className="flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: isChecked ? "#34D39915" : "#ffffff08", transition: "background 0.3s" }}
            >
              {isChecked
                ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: "#34D399" }} />
                : <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin" style={{ color: "#34D39960" }} />
              }
              <span className="text-[10px] truncate" style={{ color: isChecked ? "#34D399" : "#9CA3AF" }}>{sig}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BrandAudit() {
  const qc = useQueryClient();
  const { data: categories = [] } = useListAuditCategories({ query: { queryKey: getListAuditCategoriesQueryKey() } });
  const { data: leadsPage } = useListLeads({ limit: 10000 }, { query: { queryKey: getListLeadsQueryKey({ limit: 10000 }) } });
  const leads: Lead[] = leadsPage?.leads ?? [];
  const { data: branding } = useGetBrandingSettings();

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadDropdownOpen, setLeadDropdownOpen] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [streamedCategories, setStreamedCategories] = useState<CategoryResult[]>([]);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [mainTab, setMainTab] = useState<"engine" | "bank">("engine");
  const [bankSearch, setBankSearch] = useState("");
  const [lastRunId, setLastRunId] = useState<number | null>(null);
  const [copyingLink, setCopyingLink] = useState(false);
  const [copyLinkDone, setCopyLinkDone] = useState(false);
  const [copyLinkError, setCopyLinkError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const updateAuditMutation = useUpdateAudit();
  const updateAuditRunMutation = useUpdateAuditRun();
  const deleteAuditRunMutation = useDeleteAuditRun();
  const clearAuditHistoryMutation = useClearAuditHistory();
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState<number | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [trendRange, setTrendRange] = useState<"30d" | "90d" | "all">("all");
  const [highlightedCategory, setHighlightedCategory] = useState<string | null>(null);
  const [compareRunId, setCompareRunId] = useState<number | null>(null);
  const signalsPanelRef = useRef<HTMLDivElement>(null);

  const { data: savedAudit, isPending: savedAuditLoading } = useGetAudit(selectedLeadId!, {
    query: {
      enabled: !!selectedLeadId && !running && streamedCategories.length === 0,
      queryKey: getGetAuditQueryKey(selectedLeadId!),
    },
  });

  const { data: auditHistory = [] } = useGetAuditHistory(selectedLeadId!, {
    query: {
      enabled: !!selectedLeadId,
      queryKey: getGetAuditHistoryQueryKey(selectedLeadId!),
    },
  });

  const { data: selectedRun } = useGetAuditRun(selectedRunId!, {
    query: {
      enabled: !!selectedRunId,
      queryKey: getGetAuditRunQueryKey(selectedRunId!),
    },
  });

  const { data: compareRun } = useGetAuditRun(compareRunId!, {
    query: {
      enabled: !!compareRunId,
      queryKey: getGetAuditRunQueryKey(compareRunId!),
    },
  });

  const { data: auditBankRaw = [] } = useListAuditBank({
    query: { queryKey: getListAuditBankQueryKey(), refetchOnWindowFocus: true },
  });

  const auditBank: AuditBankEntry[] = auditBankRaw;

  const filteredBank = bankSearch.trim()
    ? auditBank.filter((e) => {
        const q = bankSearch.toLowerCase();
        return (
          e.company.toLowerCase().includes(q) ||
          `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
          (e.website ?? "").toLowerCase().includes(q)
        );
      })
    : auditBank;

  const handleRunClick = () => {
    if (!selectedLeadId || !companyName) return;
    if (streamedCategories.length === 0 && savedAuditLoading) return;
    handleRun();
  };

  const handleRun = async () => {
    if (!selectedLeadId || !companyName) return;
    if (abortRef.current) abortRef.current.abort();

    setRunning(true);
    setStreamedCategories([]);
    setSummary(null);
    setErrorMsg("");
    setStatusMsg("Starting audit...");
    setSelectedRunId(null);
    setHighlightedCategory(null);
    setCompareRunId(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}/audit/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: selectedLeadId, companyName, websiteUrl: websiteUrl || undefined }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === "status") {
                setStatusMsg(data.message);
              } else if (currentEvent === "category") {
                setStreamedCategories((prev) => {
                  const exists = prev.find((c) => c.categorySlug === data.categorySlug);
                  if (exists) return prev;
                  return [...prev, data as CategoryResult];
                });
              } else if (currentEvent === "summary") {
                setSummary(data as AuditSummary);
                setStatusMsg("Audit complete!");
              } else if (currentEvent === "done") {
                if (data.runId) setLastRunId(data.runId);
                if (selectedLeadId) {
                  qc.invalidateQueries({ queryKey: getGetAuditQueryKey(selectedLeadId) });
                  qc.invalidateQueries({ queryKey: getGetAuditHistoryQueryKey(selectedLeadId) });
                }
              } else if (currentEvent === "error") {
                setErrorMsg(data.message ?? "Audit failed.");
              }
            } catch { /* skip malformed data lines */ }
          } else if (line === "") {
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setErrorMsg((err as Error).message ?? "Audit failed.");
      }
    } finally {
      setRunning(false);
    }
  };


  const handleDeleteRun = async (runId: number) => {
    setDeletingRunId(runId);
    setConfirmDeleteRunId(null);
    setDeleteError(null);
    try {
      await deleteAuditRunMutation.mutateAsync({ runId });
      if (selectedRunId === runId) setSelectedRunId(null);
      if (selectedLeadId) {
        qc.invalidateQueries({ queryKey: getGetAuditHistoryQueryKey(selectedLeadId) });
        qc.invalidateQueries({ queryKey: getListAuditBankQueryKey() });
      }
    } catch {
      setDeleteError("Failed to delete audit run. Please try again.");
    } finally {
      setDeletingRunId(null);
    }
  };

  const handleClearAll = async () => {
    if (!selectedLeadId) return;
    setClearingAll(true);
    setConfirmClearAll(false);
    setDeleteError(null);
    try {
      await clearAuditHistoryMutation.mutateAsync({ leadId: selectedLeadId });
      setSelectedRunId(null);
      qc.invalidateQueries({ queryKey: getGetAuditHistoryQueryKey(selectedLeadId) });
      qc.invalidateQueries({ queryKey: getListAuditBankQueryKey() });
    } catch {
      setDeleteError("Failed to clear audit history. Please try again.");
    } finally {
      setClearingAll(false);
    }
  };

  const statusIcon = (severity: string, status: string) => {
    if (status === "present") return <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />;
    if (severity === "critical") return <XCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />;
    if (severity === "high") return <XCircle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />;
    return <AlertCircle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />;
  };

  const statusBadge = (severity: string, status: string) => {
    if (status === "present") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium">pass</span>;
    if (status === "warning") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 font-medium">warning</span>;
    if (severity === "critical") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 font-medium">fail</span>;
    if (severity === "high") return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 font-medium">fail</span>;
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200 font-medium">fail</span>;
  };

  const wasStatusBadge = (aiStatus: string) => {
    if (aiStatus === "present") return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 font-medium opacity-80">was: pass</span>;
    if (aiStatus === "warning") return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200 font-medium opacity-80">was: warning</span>;
    if (aiStatus === "missing") return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-medium opacity-80">was: fail</span>;
    return <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200 font-medium opacity-80">was: {aiStatus}</span>;
  };


  const displaySummary = summary;
  const displayCategories = streamedCategories.length > 0 ? streamedCategories : [];

  const savedSignals: AuditSignalResult[] | undefined = savedAudit?.signals;
  const savedCategories: CategoryResult[] = (() => {
    if (!savedSignals || savedSignals.length === 0) return [];
    const map = new Map<string, CategoryResult>();
    for (const s of savedSignals) {
      const key = s.categorySlug;
      if (!map.has(key)) map.set(key, { categorySlug: key, categoryName: s.categoryName ?? key, signals: [] });
      map.get(key)!.signals.push(s);
    }
    return Array.from(map.values());
  })();

  const selectedRunSignals: AuditSignalResult[] = selectedRun?.signals ?? [];
  const selectedRunCategories: CategoryResult[] = (() => {
    if (selectedRunSignals.length === 0) return [];
    const map = new Map<string, CategoryResult>();
    for (const s of selectedRunSignals) {
      const key = s.categorySlug;
      if (!map.has(key)) map.set(key, { categorySlug: key, categoryName: s.categoryName ?? key, signals: [] });
      map.get(key)!.signals.push(s);
    }
    return Array.from(map.values());
  })();

  const isViewingHistoricalRun = !!selectedRunId && !!selectedRun;

  const showSavedAudit = streamedCategories.length === 0 && !running && savedAudit && !isViewingHistoricalRun;
  const activeCategories = isViewingHistoricalRun
    ? selectedRunCategories
    : showSavedAudit
    ? savedCategories
    : displayCategories;

  const activeSummary: AuditSummary | null = isViewingHistoricalRun
    ? {
        healthScore: selectedRun!.healthScore,
        criticalCount: selectedRun!.criticalCount,
        highCount: selectedRun!.highCount,
        mediumCount: selectedRun!.mediumCount,
        pageSpeedScore: selectedRun!.pageSpeedScore ?? null,
        aiReport: selectedRun!.aiReport ?? "",
      }
    : showSavedAudit
    ? {
        healthScore: savedAudit!.healthScore,
        criticalCount: savedAudit!.criticalCount,
        highCount: savedAudit!.highCount,
        mediumCount: savedAudit!.mediumCount,
        pageSpeedScore: savedAudit!.pageSpeedScore ?? null,
        aiReport: savedAudit!.aiReport ?? "",
      }
    : displaySummary;

  const hasHistory = auditHistory.length > 0;

  const changedSignalIds: Set<number> = (() => {
    if (!compareRun || !selectedRun) return new Set<number>();
    const prevBySignalId = new Map(
      (compareRun.signals as AuditSignalResult[]).map((s) => [s.signalId, s.status])
    );
    const changed = new Set<number>();
    for (const sig of selectedRun.signals as AuditSignalResult[]) {
      const prevStatus = prevBySignalId.get(sig.signalId);
      if (prevStatus !== undefined && prevStatus !== sig.status) {
        changed.add(sig.signalId);
      }
    }
    return changed;
  })();

  const handleExportPDF = async () => {
    if (!activeSummary) return;
    setPdfError(null);
    setPdfExporting(true);

    let jsPDF: typeof import("jspdf")["jsPDF"];
    try {
      ({ jsPDF } = await import("jspdf"));
    } catch {
      setPdfError("Could not load PDF engine. Please try again.");
      setPdfExporting(false);
      return;
    }

    try {

    // ── Brand palette (user-configurable, with defaults) ─────────────────────
    const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
    };

    const brandColorRgb = (branding?.brandColor ? hexToRgb(branding.brandColor) : null) ?? { r: 92, g: 26, b: 140 };
    const DD_PURPLE  = brandColorRgb;
    const DD_MAGENTA = { r: 233, g: 30,  b: 140 }; // #E91E8C hot pink accent
    const DD_WHITE   = { r: 255, g: 255, b: 255 };
    const DD_DARK    = { r: 30,  g: 10,  b: 50  }; // near-black tint
    const DD_LGRAY   = { r: 248, g: 245, b: 252 }; // light background

    const brandingCompanyName = branding?.companyName ?? null;
    const brandingTagline = branding?.tagline ?? null;
    const brandingContactInfo = branding?.contactInfo ?? null;

    const footerParts: string[] = [];
    if (brandingCompanyName) footerParts.push(brandingCompanyName);
    if (brandingTagline) footerParts.push(brandingTagline);
    if (brandingContactInfo) footerParts.push(brandingContactInfo);
    const FOOTER_TEXT = footerParts.length > 0
      ? footerParts.join("  \u00b7  ")
      : "Generated by Sales War Machine";

    // ── Load logo as data URL ────────────────────────────────────────────────
    let logoDataUrl: string | null = null;
    let logoAspect  = 3.2; // fallback width/height ratio

    if (branding?.logoBase64) {
      logoDataUrl = branding.logoBase64;
      try {
        logoAspect = await new Promise<number>((resolve) => {
          const img = new Image();
          img.onload  = () => resolve(img.naturalWidth / img.naturalHeight || 3.2);
          img.onerror = () => resolve(3.2);
          img.src = logoDataUrl!;
        });
      } catch { /* use default aspect */ }
    }

    const score      = activeSummary.healthScore;
    const scoreHex   = auditScoreHex(score);
    const scoreRgb   = auditScoreRgb(score);
    const scoreLabel2 = auditScoreLabel(score);

    // ── Gauge canvas ─────────────────────────────────────────────────────────
    const gaugeDataUrl = (() => {
      const W = 280, H = 180;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const cx = W / 2, cy = H - 20, radius = 108, lineW = 20;
      const startAngle = Math.PI, endAngle = 2 * Math.PI;
      const fillAngle  = startAngle + (score / 100) * Math.PI;
      // Track
      ctx.beginPath(); ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = "#E9D5FF"; ctx.lineWidth = lineW; ctx.lineCap = "round"; ctx.stroke();
      // Fill
      ctx.beginPath(); ctx.arc(cx, cy, radius, startAngle, fillAngle);
      ctx.strokeStyle = scoreHex; ctx.lineWidth = lineW; ctx.lineCap = "round"; ctx.stroke();
      // Score number
      ctx.fillStyle = scoreHex; ctx.font = "bold 52px -apple-system, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillText(String(score), cx, cy - 6);
      ctx.fillStyle = "#6B7280"; ctx.font = "600 16px -apple-system, sans-serif";
      ctx.fillText("/ 100", cx, cy + 16);
      ctx.fillStyle = scoreHex; ctx.font = "600 14px -apple-system, sans-serif";
      ctx.fillText(scoreLabel2, cx, cy + 36);
      return canvas.toDataURL("image/png");
    })();

    const doc    = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const PW     = 210, ML = 14, MR = 14, usable = PW - ML - MR;
    const CONTENT_BOTTOM = 274;
    const LOGO_MAX_H = 12; // max logo height in mm on sub-pages
    const LOGO_H_P1  = 14; // logo height on page 1 header
    const LOGO_W_P1  = LOGO_H_P1 * logoAspect;
    const LOGO_W_SUB = LOGO_MAX_H * logoAspect;
    let y = 0;

    const txt = (s: string | null | undefined) => String(s ?? "");

    // ── Shared helpers ───────────────────────────────────────────────────────
    const setFill  = (c: { r: number; g: number; b: number }) => doc.setFillColor(c.r, c.g, c.b);
    const setDraw  = (c: { r: number; g: number; b: number }) => doc.setDrawColor(c.r, c.g, c.b);
    const setColor = (c: { r: number; g: number; b: number }) => doc.setTextColor(c.r, c.g, c.b);

    // ── Per-page footer ──────────────────────────────────────────────────────
    const drawFooter = () => {
      const FY = 282;
      // Full-width purple footer band
      setFill(DD_PURPLE);
      doc.rect(0, FY - 1, PW, 16, "F");
      // Magenta accent line on top of footer
      setFill(DD_MAGENTA);
      doc.rect(0, FY - 1, PW, 1.2, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      setColor(DD_WHITE);
      doc.text(FOOTER_TEXT, PW / 2, FY + 5, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
      doc.setTextColor(220, 180, 255);
      doc.text(`Page ${doc.getNumberOfPages()}`, PW - MR, FY + 10, { align: "right" });
    };

    // ── Logo helper (preserves natural aspect ratio) ─────────────────────────
    const getImageFormat = (dataUrl: string): string => {
      const match = dataUrl.match(/^data:image\/(\w+);/);
      if (!match) return "PNG";
      const fmt = match[1].toUpperCase();
      if (fmt === "JPG") return "JPEG";
      return fmt;
    };
    const logoFormat = logoDataUrl ? getImageFormat(logoDataUrl) : "PNG";

    const drawLogo = (x: number, topY: number, height: number) => {
      if (!logoDataUrl) return;
      const w = height * logoAspect;
      doc.addImage(logoDataUrl, logoFormat, x, topY, w, height);
    };

    // ── Sub-page mini header (pages 2+) ─────────────────────────────────────
    const drawSubHeader = () => {
      // Purple thin band
      setFill(DD_PURPLE);
      doc.rect(0, 0, PW, 18, "F");
      setFill(DD_MAGENTA);
      doc.rect(0, 18, PW, 0.8, "F");
      if (logoDataUrl) drawLogo(ML, 3, LOGO_MAX_H);
      // Page label right — show user's branding company name if set
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
      setColor(DD_WHITE);
      doc.text(
        brandingCompanyName ? txt(brandingCompanyName).toUpperCase() : "BRAND AUDIT REPORT",
        PW - MR, 11, { align: "right" }
      );
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
      doc.setTextColor(220, 180, 255);
      doc.text(txt(companyName).toUpperCase(), PW - MR, 16, { align: "right" });
    };

    // ── Page break check ────────────────────────────────────────────────────
    const checkNewPage = (needed: number) => {
      if (y + needed > CONTENT_BOTTOM) {
        drawFooter();
        doc.addPage();
        drawSubHeader();
        y = 24;
      }
    };

    // ══ PAGE 1: FULL HEADER BAND ════════════════════════════════════════════

    // Purple gradient header block (full width, 46mm tall)
    setFill(DD_PURPLE);
    doc.rect(0, 0, PW, 46, "F");
    // Magenta decorative bar at bottom of header
    setFill(DD_MAGENTA);
    doc.rect(0, 46, PW, 1.5, "F");
    // Decorative magenta accent blob (right side)
    setFill({ r: 233, g: 30, b: 140 });
    doc.ellipse(188, 8, 30, 22, "F");
    setFill({ r: 92, g: 26, b: 140 });
    doc.ellipse(185, 5, 28, 20, "F");

    // Logo on white area inside the purple band (top-left)
    if (logoDataUrl) drawLogo(ML, 8, LOGO_H_P1);

    // Report header: show branding company name prominently if configured
    if (brandingCompanyName) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      setColor(DD_WHITE);
      doc.text(txt(brandingCompanyName), ML, 27);
      if (brandingTagline) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8);
        doc.setTextColor(220, 180, 255);
        doc.text(txt(brandingTagline), ML, 34);
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      doc.setTextColor(220, 180, 255);
      doc.text("Brand Audit Report", ML, brandingTagline ? 40 : 36);
    } else {
      doc.setFont("helvetica", "bold"); doc.setFontSize(20);
      setColor(DD_WHITE);
      doc.text("Brand Audit Report", ML, 33);
    }

    // Sub-info row below header
    const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    setFill(DD_LGRAY);
    doc.rect(0, 47.5, PW, 12, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    setColor(DD_PURPLE);
    doc.text(txt(companyName), ML, 55);
    if (websiteUrl) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      setColor(DD_MAGENTA);
      doc.text(txt(websiteUrl), ML + doc.getTextWidth(txt(companyName)) + 3, 55);
    }
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.setTextColor(130, 100, 160);
    doc.text(`Prepared on ${dateStr}`, PW - MR, 55, { align: "right" });

    y = 66;

    // ── Gauge + issue counts row ─────────────────────────────────────────────
    const gaugeH = 32, gaugeW = 50;
    doc.addImage(gaugeDataUrl, "PNG", PW - MR - gaugeW, y, gaugeW, gaugeH);

    const issueCols = [
      { label: "Critical",  count: activeSummary.criticalCount, rgb: { r: 220, g: 38,  b: 38  }, bgRgb: { r: 255, g: 240, b: 240 } },
      { label: "High",      count: activeSummary.highCount,     rgb: { r: 234, g: 88,  b: 12  }, bgRgb: { r: 255, g: 245, b: 235 } },
      { label: "Medium",    count: activeSummary.mediumCount,   rgb: { r: 202, g: 138, b: 4   }, bgRgb: { r: 255, g: 252, b: 235 } },
    ];
    const boxW = (usable - gaugeW - 12) / 3;
    issueCols.forEach((col, i) => {
      const bx = ML + i * (boxW + 3);
      setFill(col.bgRgb);
      doc.roundedRect(bx, y, boxW, gaugeH, 3, 3, "F");
      // left accent bar
      setFill(col.rgb);
      doc.roundedRect(bx, y, 2.5, gaugeH, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(22);
      doc.setTextColor(col.rgb.r, col.rgb.g, col.rgb.b);
      doc.text(String(col.count), bx + boxW / 2 + 1, y + 18, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.setTextColor(100, 80, 120);
      doc.text(`${col.label} Issues`, bx + boxW / 2 + 1, y + 26, { align: "center" });
    });
    y += gaugeH + 4;

    if (activeSummary.pageSpeedScore !== null) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8);
      setColor(DD_PURPLE);
      doc.text(`\u26A1 PageSpeed Score: ${activeSummary.pageSpeedScore}/100`, ML, y);
      y += 6;
    }

    // ── Section header helper ────────────────────────────────────────────────
    const sectionHeader = (title: string) => {
      checkNewPage(14);
      setFill({ r: 248, g: 243, b: 254 });
      doc.roundedRect(ML, y, usable, 9, 2, 2, "F");
      setFill(DD_MAGENTA);
      doc.roundedRect(ML, y, 3, 9, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      setColor(DD_PURPLE);
      doc.text(title.toUpperCase(), ML + 6, y + 6);
      y += 13;
    };

    // ── AI Brand Report ──────────────────────────────────────────────────────
    if (activeSummary.aiReport) {
      sectionHeader("AI Brand Report");
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      doc.setTextColor(55, 40, 75);
      const paras = activeSummary.aiReport.split("\n\n");
      for (const para of paras) {
        const lines = doc.splitTextToSize(txt(para), usable);
        checkNewPage(lines.length * 4.8 + 3);
        doc.text(lines, ML, y);
        y += lines.length * 4.8 + 3;
      }
      y += 4;
    }

    // ── Signal Checklist ─────────────────────────────────────────────────────
    const catsToRender = activeCategories.length > 0
      ? activeCategories
      : showSavedAudit
      ? savedCategories
      : [];

    if (catsToRender.length > 0) {
      sectionHeader("Signal Checklist");

      for (const cat of catsToRender) {
        checkNewPage(14);
        const missing  = cat.signals.filter((s) => s.status === "missing").length;
        const warnings = cat.signals.filter((s) => s.status === "warning").length;

        // Category sub-header
        setFill({ r: 240, g: 232, b: 250 });
        doc.rect(ML, y, usable, 6.5, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(8);
        setColor(DD_PURPLE);
        doc.text(txt(cat.categoryName).toUpperCase(), ML + 2, y + 4.5);

        const badgeText = missing > 0 ? `${missing} missing` : warnings > 0 ? `${warnings} warning` : "\u2713 all clear";
        const badgeRgb  = missing > 0 ? { r: 185, g: 28, b: 28 } : warnings > 0 ? { r: 161, g: 98, b: 7 } : { r: 21, g: 128, b: 61 };
        doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        doc.setTextColor(badgeRgb.r, badgeRgb.g, badgeRgb.b);
        doc.text(badgeText, PW - MR, y + 4.5, { align: "right" });

        y += 8;

        for (const sig of cat.signals) {
          const lineH = 5;
          const nameLines = doc.splitTextToSize(txt(sig.signalName), usable - 20);
          const explLines = sig.explanation ? doc.splitTextToSize(txt(sig.explanation), usable - 20) : [];
          const rowH = nameLines.length * lineH + (explLines.length > 0 ? explLines.length * 3.8 + 1.5 : 0) + 2;
          checkNewPage(rowH + 1);

          // Alternating row bg
          if (cat.signals.indexOf(sig) % 2 === 0) {
            setFill(DD_LGRAY);
            doc.rect(ML, y - 0.5, usable, rowH, "F");
          }

          const iconColor = sig.status === "present"
            ? { r: 22, g: 163, b: 74 }
            : sig.severity === "critical" ? { r: 220, g: 38,  b: 38  }
            : sig.severity === "high"     ? { r: 234, g: 88,  b: 12  }
            :                               { r: 202, g: 138, b: 4   };
          const icon = sig.status === "present" ? "\u2713" : sig.severity === "critical" || sig.severity === "high" ? "\u2715" : "!";

          doc.setFont("helvetica", "bold"); doc.setFontSize(9);
          doc.setTextColor(iconColor.r, iconColor.g, iconColor.b);
          doc.text(icon, ML + 1, y + 3.5);

          doc.setFont("helvetica", sig.status === "present" ? "normal" : "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(sig.status === "present" ? 110 : 55, sig.status === "present" ? 80 : 40, sig.status === "present" ? 140 : 75);
          doc.text(nameLines, ML + 6, y + 3.5);

          const badge   = sig.status === "present" ? "pass" : sig.status === "warning" ? "warning" : "fail";
          const bRgb    = sig.status === "present"    ? { r: 21,  g: 128, b: 61  }
            : sig.status === "warning"                ? { r: 161, g: 98,  b: 7   }
            : sig.severity === "critical"             ? { r: 185, g: 28,  b: 28  }
            :                                           { r: 194, g: 65,  b: 12  };
          doc.setFont("helvetica", "bold"); doc.setFontSize(7);
          doc.setTextColor(bRgb.r, bRgb.g, bRgb.b);
          doc.text(badge, PW - MR, y + 3.5, { align: "right" });

          if (explLines.length > 0) {
            doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
            doc.setTextColor(130, 100, 160);
            doc.text(explLines, ML + 6, y + nameLines.length * lineH + 2);
          }
          y += rowH + 1;
        }
        y += 5;
      }
    }

    // ── Final footer ─────────────────────────────────────────────────────────
    drawFooter();

    const safeCompany = txt(companyName).replace(/[^a-z0-9_\-\s]/gi, "").trim() || "company";
    doc.save(`brand-audit-${safeCompany.replace(/\s+/g, "-").toLowerCase()}.pdf`);
    } catch {
      setPdfError("Failed to generate PDF. Please try again.");
    } finally {
      setPdfExporting(false);
    }
  };

  const activeRunId: number | null = selectedRunId ?? lastRunId ?? auditHistory[0]?.id ?? null;

  const handleCopyLink = async () => {
    if (!activeRunId || copyingLink) return;
    setCopyingLink(true);
    setCopyLinkError(null);
    try {
      const res = await fetch(`${API_BASE}/audit/runs/${activeRunId}/share`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate share link");
      const { token } = await res.json() as { token: string };
      const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
      try {
        await navigator.clipboard.writeText(`${base}/audit/share/${token}`);
        setCopyLinkDone(true);
        setTimeout(() => setCopyLinkDone(false), 2500);
      } catch {
        setCopyLinkError("Clipboard unavailable — copy this: " + `${base}/audit/share/${token}`);
      }
    } catch {
      setCopyLinkError("Could not generate link. Please try again.");
    } finally {
      setCopyingLink(false);
    }
  };

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-foreground">Brand Audit Engine</h1>
          <p className="text-xs text-muted-foreground mt-0.5">AI-powered brand health assessment with 57+ signal checks</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(["engine", "bank"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              mainTab === tab
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "engine" ? <Zap className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5" />}
            {tab === "engine" ? "Audit Engine" : "Audit Bank"}
            {tab === "bank" && auditBank.length > 0 && (
              <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "#1A3D2B", color: "white" }}>
                {auditBank.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══ AUDIT BANK TAB ══════════════════════════════════════════════════ */}
      {mainTab === "bank" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              placeholder="Search by company, contact or website..."
              className="w-full pl-8 pr-4 py-2 text-xs rounded-lg border border-gray-200 bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-green-600"
            />
          </div>

          {filteredBank.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 p-14 text-center">
              <Database className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-50" />
              <div className="text-sm font-medium text-muted-foreground">
                {bankSearch ? "No audits match your search" : "No audits completed yet"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {bankSearch ? "Try different keywords" : "Run your first brand audit in the Audit Engine tab"}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  All Completed Audits
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {filteredBank.length} audit{filteredBank.length !== 1 ? "s" : ""}
                  {bankSearch ? ` matching "${bankSearch}"` : ""}
                </span>
              </div>
              <div className="divide-y divide-gray-50">
                {filteredBank.map((entry) => {
                  const hc = auditScoreHex(entry.healthScore);
                  const hl = auditScoreLabel(entry.healthScore);
                  return (
                    <div key={entry.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                      {/* Score */}
                      <div className="flex-shrink-0 w-12 text-center">
                        <div className="text-xl font-black" style={{ color: hc }}>{entry.healthScore}</div>
                        <div className="text-[9px] text-muted-foreground">/100</div>
                      </div>
                      {/* Company info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                            {entry.company}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-medium">
                            {entry.firstName} {entry.lastName}
                          </span>
                          {entry.designation && (
                            <span className="text-[10px] text-muted-foreground">
                              · {entry.designation}
                            </span>
                          )}
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                            style={{ background: `${hc}18`, color: hc }}
                          >
                            {hl}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {(entry.city || entry.country) && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                              {[entry.city, entry.country].filter(Boolean).join(", ")}
                            </span>
                          )}
                          {entry.website && (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[160px]">
                              <Globe className="w-2.5 h-2.5 flex-shrink-0" />
                              {entry.website.replace(/^https?:\/\//, "")}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Clock className="w-2.5 h-2.5" />
                            {formatDate(entry.createdAt)} · {formatTime(entry.createdAt)}
                          </span>
                        </div>
                      </div>
                      {/* Issue counts */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {entry.criticalCount > 0 && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100 font-medium">
                            {entry.criticalCount} crit
                          </span>
                        )}
                        {entry.highCount > 0 && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-100 font-medium">
                            {entry.highCount} high
                          </span>
                        )}
                        {entry.mediumCount > 0 && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-100 font-medium">
                            {entry.mediumCount} med
                          </span>
                        )}
                        <button
                          onClick={() => {
                            setMainTab("engine");
                            setSelectedLeadId(entry.leadId);
                            const lead = leads.find((l) => l.id === entry.leadId);
                            if (lead) {
                              setCompanyName(lead.company);
                              setWebsiteUrl((lead as Lead & { website?: string }).website ?? "");
                            }
                            setStreamedCategories([]);
                            setSummary(null);
                            setSelectedRunId(null);
                            setConfirmClearAll(false);
                          }}
                          className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded text-white transition-all hover:opacity-90"
                          style={{ background: "#1A3D2B" }}
                        >
                          <TrendingUp className="w-3 h-3" />
                          View
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {mainTab === "engine" && (<>

      {/* Setup */}
      <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
        <div className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Run Audit</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <label className="block text-[11px] text-muted-foreground mb-1">Lead</label>
            {/* Searchable lead combobox */}
            <div className="relative">
              <input
                type="text"
                placeholder={selectedLeadId ? (leads.find(l => l.id === selectedLeadId) ? `${leads.find(l => l.id === selectedLeadId)!.firstName} ${leads.find(l => l.id === selectedLeadId)!.lastName} — ${leads.find(l => l.id === selectedLeadId)!.company}` : "Select a lead…") : "Search leads…"}
                value={leadDropdownOpen ? leadSearch : ""}
                onFocus={() => { setLeadDropdownOpen(true); setLeadSearch(""); }}
                onBlur={() => setTimeout(() => setLeadDropdownOpen(false), 150)}
                onChange={(e) => setLeadSearch(e.target.value)}
                className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
              />
              {!leadDropdownOpen && selectedLeadId && (
                <div className="absolute inset-0 px-2.5 py-1.5 text-xs text-gray-900 pointer-events-none truncate flex items-center">
                  {(() => { const l = leads.find(x => x.id === selectedLeadId); return l ? `${l.firstName} ${l.lastName} — ${l.company}` : ""; })()}
                </div>
              )}
              {leadDropdownOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-52 overflow-y-auto">
                  {leads
                    .filter((l) => {
                      if (!leadSearch) return true;
                      const q = leadSearch.toLowerCase();
                      return (
                        (`${l.firstName} ${l.lastName}`).toLowerCase().includes(q) ||
                        (l.company ?? "").toLowerCase().includes(q) ||
                        (l.email ?? "").toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 100)
                    .map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onMouseDown={() => {
                          setSelectedLeadId(lead.id);
                          setLeadSearch("");
                          setLeadDropdownOpen(false);
                          setStreamedCategories([]);
                          setSummary(null);
                          setSelectedRunId(null);
                          setHighlightedCategory(null);
                          setCompareRunId(null);
                          setLastRunId(null);
                          setCopyLinkError(null);
                          setConfirmClearAll(false);
                          setCompanyName(lead.company);
                          setWebsiteUrl((lead as Lead & { website?: string }).website ?? "");
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-teal-50 border-b border-gray-50 last:border-0"
                      >
                        <span className="font-medium text-gray-900">{lead.firstName} {lead.lastName}</span>
                        <span className="text-gray-400"> — {lead.company}</span>
                        {lead.email && <span className="text-gray-300 text-[10px] block truncate">{lead.email}</span>}
                      </button>
                    ))}
                  {leads.filter((l) => {
                    if (!leadSearch) return true;
                    const q = leadSearch.toLowerCase();
                    return (`${l.firstName} ${l.lastName}`).toLowerCase().includes(q) || (l.company ?? "").toLowerCase().includes(q) || (l.email ?? "").toLowerCase().includes(q);
                  }).length === 0 && (
                    <div className="px-3 py-3 text-xs text-gray-400 text-center">No leads match "{leadSearch}"</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Company Name</label>
            <input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Enter company name"
              className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] text-muted-foreground mb-1">Website URL (optional)</label>
            <input
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full text-xs rounded border border-gray-200 bg-white text-gray-900 px-2.5 py-1.5 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={handleRunClick}
            disabled={!selectedLeadId || !companyName || running || (streamedCategories.length === 0 && !!selectedLeadId && savedAuditLoading)}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium text-white disabled:opacity-50 transition-all"
            style={{ background: "#1A7A45" }}
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            {running ? "Running AI Audit..." : "Run Brand Audit"}
          </button>
          {running && statusMsg && (
            <span className="text-xs text-muted-foreground animate-pulse">{statusMsg}</span>
          )}
        </div>
        {errorMsg && (
          <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">{errorMsg}</div>
        )}
      </div>

      {/* Score Trend Chart */}
      {auditHistory.length >= 2 && (() => {
        const now = Date.now();
        const cutoff = trendRange === "30d" ? now - 30 * 24 * 60 * 60 * 1000
          : trendRange === "90d" ? now - 90 * 24 * 60 * 60 * 1000
          : 0;
        const filteredHistory = [...auditHistory]
          .reverse()
          .filter((run: AuditRunSummary) => new Date(run.createdAt).getTime() >= cutoff);
        const chartData = filteredHistory.map((run: AuditRunSummary) => ({
          date: formatDate(run.createdAt),
          score: run.healthScore,
        }));
        const scores = chartData.map((d) => d.score);
        const minScore = Math.max(0, Math.min(...scores) - 10);
        const maxScore = Math.min(100, Math.max(...scores) + 10);

        const CustomDot = (props: { cx?: number; cy?: number; payload?: { score: number } }) => {
          const { cx, cy, payload } = props;
          if (cx === undefined || cy === undefined || !payload) return null;
          const color = auditScoreHex(payload.score);
          return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={2} />;
        };

        const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
          if (!active || !payload?.length) return null;
          const score = payload[0].value;
          const color = auditScoreHex(score);
          const label2 = auditScoreLabel(score);
          return (
            <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2">
              <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
              <div className="text-sm font-bold" style={{ color }}>{score} <span className="text-xs font-normal text-muted-foreground">/ 100 — {label2}</span></div>
            </div>
          );
        };

        const rangeOptions: { label: string; value: "30d" | "90d" | "all" }[] = [
          { label: "30d", value: "30d" },
          { label: "90d", value: "90d" },
          { label: "All", value: "all" },
        ];

        return (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Score Trend</span>
              <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-md p-0.5">
                {rangeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTrendRange(opt.value)}
                    className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${
                      trendRange === opt.value
                        ? "bg-white text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">{chartData.length} run{chartData.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="px-2 py-4">
              {chartData.length < 2 ? (
                <div className="flex flex-col items-center justify-center h-[160px] gap-1 text-center">
                  <span className="text-xs text-muted-foreground">No data in this range</span>
                  <span className="text-[10px] text-muted-foreground">Try a wider time window</span>
                </div>
              ) : (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="scoreTrendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22C55E" stopOpacity={0.18} />
                      <stop offset="95%" stopColor="#22C55E" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                  <ReferenceLine y={70} stroke="#22C55E" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.5} />
                  <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: "#9CA3AF" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[minScore, maxScore]}
                    tick={{ fontSize: 9, fill: "#9CA3AF" }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#22C55E"
                    strokeWidth={2}
                    fill="url(#scoreTrendGradient)"
                    dot={<CustomDot />}
                    activeDot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              )}
              {chartData.length >= 2 && (
              <div className="flex items-center gap-4 justify-center mt-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 rounded" style={{ background: "#22C55E", opacity: 0.5 }} />
                  <span className="text-[9px] text-muted-foreground">Good (≥70)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-0.5 rounded" style={{ background: "#F59E0B", opacity: 0.5 }} />
                  <span className="text-[9px] text-muted-foreground">Fair (≥50)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: "#EF4444" }} />
                  <span className="text-[9px] text-muted-foreground">Poor (&lt;50)</span>
                </div>
              </div>
              )}
            </div>
            {/* Per-category score breakdown */}
            {(() => {
              type RunExt = AuditRunSummary & { categoryScores?: Record<string, { score: number; name: string }> };
              const historyExt = filteredHistory as RunExt[];
              const CATEGORY_COLORS = ["#6366F1", "#F59E0B", "#3B82F6", "#EC4899", "#8B5CF6", "#14B8A6", "#F97316"];
              const allSlugs = Array.from(new Set(
                historyExt.flatMap((run) => Object.keys(run.categoryScores ?? {}))
              ));
              if (allSlugs.length === 0) return null;
              const catChartData = historyExt.map((run) => {
                const point: Record<string, string | number> = { date: formatDate(run.createdAt) };
                for (const slug of allSlugs) {
                  const cs = run.categoryScores?.[slug];
                  if (cs !== undefined) point[slug] = cs.score;
                }
                return point;
              });
              const getCatName = (slug: string) =>
                historyExt.find((r) => r.categoryScores?.[slug])?.categoryScores?.[slug]?.name ?? slug;
              const CatTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string }[]; label?: string }) => {
                if (!active || !payload?.length) return null;
                return (
                  <div className="rounded-lg border border-gray-200 bg-white shadow-md px-3 py-2 min-w-[160px]">
                    <div className="text-[10px] text-muted-foreground mb-1">{label}</div>
                    {payload.map((p) => (
                      <div key={p.dataKey} className="flex items-center gap-1.5 text-[10px] py-0.5">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                        <span className="text-gray-500 truncate">{getCatName(p.dataKey)}:</span>
                        <span className="font-semibold text-foreground ml-auto pl-2">{p.value}</span>
                      </div>
                    ))}
                  </div>
                );
              };
              return (
                <div className="border-t border-gray-100 pt-3 pb-4 px-2">
                  <div className="px-2 mb-2 flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Category Breakdown</span>
                    <span className="text-[9px] text-muted-foreground">(click a dot to filter signals)</span>
                    {highlightedCategory && (
                      <button
                        onClick={() => { setHighlightedCategory(null); setCompareRunId(null); }}
                        className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium border transition-colors"
                        style={{ background: "#f0fdf4", color: "#16a34a", borderColor: "#bbf7d0" }}
                      >
                        ✕ Clear filter
                      </button>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={catChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#9CA3AF" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "#9CA3AF" }} tickLine={false} axisLine={false} width={28} />
                      <Tooltip content={<CatTooltip />} />
                      {allSlugs.map((slug, i) => {
                        const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                        const isHighlighted = !highlightedCategory || highlightedCategory === slug;
                        return (
                          <Line
                            key={slug}
                            type="monotone"
                            dataKey={slug}
                            stroke={color}
                            strokeWidth={isHighlighted ? 2 : 1}
                            strokeOpacity={isHighlighted ? 1 : 0.25}
                            dot={(dotProps: { cx?: number; cy?: number; index?: number }) => {
                              const { cx, cy, index } = dotProps;
                              if (cx === undefined || cy === undefined || index === undefined) return <g key={`sdot-${slug}-${index}`} />;
                              return (
                                <circle
                                  key={`sdot-${slug}-${index}`}
                                  cx={cx}
                                  cy={cy}
                                  r={isHighlighted ? 3 : 2}
                                  fill={color}
                                  stroke="#fff"
                                  strokeWidth={1.5}
                                  fillOpacity={isHighlighted ? 1 : 0.35}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    const clickedRun = filteredHistory[index];
                                    if (!clickedRun) return;
                                    const fullIdx = (auditHistory as AuditRunSummary[]).findIndex((r) => r.id === clickedRun.id);
                                    const prevRun = fullIdx >= 0 ? (auditHistory as AuditRunSummary[])[fullIdx + 1] : undefined;
                                    setSelectedRunId(clickedRun.id);
                                    setHighlightedCategory(slug);
                                    setCompareRunId(prevRun?.id ?? null);
                                    setStreamedCategories([]);
                                    setSummary(null);
                                    setTimeout(() => signalsPanelRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                                  }}
                                />
                              );
                            }}
                            activeDot={(dotProps: { cx?: number; cy?: number; index?: number }) => {
                              const { cx, cy, index } = dotProps;
                              if (cx === undefined || cy === undefined || index === undefined) return <g key={`dot-${slug}-${index}`} />;
                              return (
                                <circle
                                  key={`dot-${slug}-${index}`}
                                  cx={cx}
                                  cy={cy}
                                  r={6}
                                  fill={color}
                                  stroke="#fff"
                                  strokeWidth={2}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    const clickedRun = filteredHistory[index];
                                    if (!clickedRun) return;
                                    const fullIdx = (auditHistory as AuditRunSummary[]).findIndex((r) => r.id === clickedRun.id);
                                    const prevRun = fullIdx >= 0 ? (auditHistory as AuditRunSummary[])[fullIdx + 1] : undefined;
                                    setSelectedRunId(clickedRun.id);
                                    setHighlightedCategory(slug);
                                    setCompareRunId(prevRun?.id ?? null);
                                    setStreamedCategories([]);
                                    setSummary(null);
                                    setTimeout(() => signalsPanelRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                                  }}
                                />
                              );
                            }}
                          />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-2 px-2">
                    {allSlugs.map((slug, i) => {
                      const isActive = !highlightedCategory || highlightedCategory === slug;
                      return (
                        <button
                          key={slug}
                          onClick={() => {
                            if (highlightedCategory === slug) {
                              setHighlightedCategory(null);
                              setCompareRunId(null);
                            } else {
                              setHighlightedCategory(slug);
                              setTimeout(() => signalsPanelRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
                            }
                          }}
                          className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-opacity hover:opacity-100"
                          style={{ opacity: isActive ? 1 : 0.35 }}
                          title={isActive && highlightedCategory === slug ? `Click to clear filter` : `Click to filter signals by ${getCatName(slug)}`}
                        >
                          <div className="w-3 h-0.5 rounded" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                          <span className="text-[9px] text-muted-foreground">{getCatName(slug)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Audit History Timeline */}
      {hasHistory && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Audit History</span>
            <span className="text-[10px] text-muted-foreground">{auditHistory.length} run{auditHistory.length !== 1 ? "s" : ""}</span>
            <div className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              {clearingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
              ) : confirmClearAll ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleClearAll}
                    className="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                  >
                    Clear all
                  </button>
                  <button
                    onClick={() => setConfirmClearAll(false)}
                    className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearAll(true)}
                  className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors font-medium px-1.5 py-0.5 rounded hover:bg-red-50"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col divide-y divide-gray-50">
            {auditHistory.map((run: AuditRunSummary, idx: number) => {
              const isLatest = idx === 0;
              const isSelected = selectedRunId === run.id;
              const prevRun = auditHistory[idx + 1];
              const scoreDiff = prevRun ? run.healthScore - prevRun.healthScore : null;

              type RunWithCategoryScores = typeof run & { categoryScores?: Record<string, { score: number; name: string }> };
              const runExt = run as RunWithCategoryScores;
              const prevRunExt = prevRun as RunWithCategoryScores | undefined;
              const regressedCategories: string[] =
                prevRunExt && runExt.categoryScores && prevRunExt.categoryScores
                  ? Object.keys(runExt.categoryScores)
                      .filter((slug) => {
                        const prev = prevRunExt.categoryScores?.[slug]?.score;
                        return prev !== undefined && runExt.categoryScores![slug].score < prev;
                      })
                      .map((slug) => runExt.categoryScores![slug].name)
                  : [];

              const isDeleting = deletingRunId === run.id;
              const isConfirming = confirmDeleteRunId === run.id;

              return (
                <div
                  key={run.id}
                  className={`group relative w-full px-4 py-3 flex items-center gap-3 transition-colors hover:bg-gray-50 ${isSelected ? "bg-green-50 border-l-2 border-l-green-600" : ""}`}
                >
                  <button
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    onClick={() => {
                      if (isConfirming) { setConfirmDeleteRunId(null); return; }
                      if (isSelected) {
                        setSelectedRunId(null);
                        setHighlightedCategory(null);
                        setCompareRunId(null);
                      } else {
                        setSelectedRunId(run.id);
                        setCompareRunId(prevRun?.id ?? null);
                        setStreamedCategories([]);
                        setSummary(null);
                      }
                    }}
                  >
                    <div className="flex-shrink-0 flex flex-col items-center gap-0.5 w-8">
                      <div
                        className="text-sm font-black"
                        style={{ color: auditScoreHex(run.healthScore) }}
                      >
                        {run.healthScore}
                      </div>
                      <div className="text-[9px] text-muted-foreground">/100</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium text-foreground">
                          {formatDate(run.createdAt)}
                        </span>
                        {isLatest && !isViewingHistoricalRun && !running && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">latest</span>
                        )}
                        {scoreDiff !== null && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${scoreDiff > 0 ? "bg-green-50 text-green-700" : scoreDiff < 0 ? "bg-red-50 text-red-700" : "bg-gray-50 text-gray-500"}`}
                          >
                            {scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff === 0 ? "±0" : scoreDiff}
                          </span>
                        )}
                        {regressedCategories.length > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 cursor-help"
                            title={`Category regression: ${regressedCategories.join(", ")}`}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="w-2.5 h-2.5" />
                          {formatTime(run.createdAt)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {run.criticalCount > 0 && (
                            <span className="text-[9px] text-red-600 font-medium">{run.criticalCount} crit</span>
                          )}
                          {run.highCount > 0 && (
                            <span className="text-[9px] text-orange-500 font-medium">{run.highCount} high</span>
                          )}
                          {run.mediumCount > 0 && (
                            <span className="text-[9px] text-yellow-600 font-medium">{run.mediumCount} med</span>
                          )}
                        </div>
                      </div>
                      {/* Per-category score deltas vs previous run */}
                      {prevRunExt && runExt.categoryScores && prevRunExt.categoryScores && (() => {
                        const slugs = Object.keys(runExt.categoryScores);
                        const deltas = slugs
                          .map((slug) => ({
                            slug,
                            name: runExt.categoryScores![slug].name,
                            delta: runExt.categoryScores![slug].score - (prevRunExt.categoryScores?.[slug]?.score ?? runExt.categoryScores![slug].score),
                          }))
                          .filter((d) => d.delta !== 0)
                          .sort((a, b) => a.delta - b.delta);
                        if (deltas.length === 0) return null;
                        return (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {deltas.map((d) => (
                              <span
                                key={d.slug}
                                title={d.name}
                                className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${d.delta > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
                              >
                                {d.delta > 0 ? "↑" : "↓"}
                                <span className="max-w-[60px] truncate">{d.name}</span>
                                {d.delta > 0 ? `+${d.delta}` : d.delta}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <span className="text-[10px] font-medium" style={{ color: auditScoreHex(run.healthScore) }}>
                        {auditScoreLabel(run.healthScore)}
                      </span>
                      <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`} />
                    </div>
                  </button>

                  {/* Delete controls */}
                  <div className="flex-shrink-0 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {isDeleting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
                    ) : isConfirming ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDeleteRun(run.id)}
                          className="text-[10px] px-2 py-0.5 rounded bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteRunId(null)}
                          className="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium hover:bg-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteRunId(run.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 rounded"
                        title="Delete this audit run"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Delete error banner */}
      {deleteError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 flex items-center justify-between gap-2">
          <span className="text-xs text-red-700">{deleteError}</span>
          <button onClick={() => setDeleteError(null)} className="text-xs text-red-500 hover:text-red-700 font-medium">Dismiss</button>
        </div>
      )}

      {/* Historical run banner */}
      {isViewingHistoricalRun && selectedRun && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
          <span className="text-xs text-amber-800">
            Viewing historical audit from <strong>{formatDate(selectedRun.createdAt)}</strong> at {formatTime(selectedRun.createdAt)}
          </span>
          <button
            onClick={() => { setSelectedRunId(null); setHighlightedCategory(null); setCompareRunId(null); }}
            className="ml-auto text-[11px] text-amber-700 hover:text-amber-900 font-medium underline underline-offset-2"
          >
            Back to latest
          </button>
        </div>
      )}

      {/* Results */}
      {activeSummary && (
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Audit Results</div>
          <div className="flex items-center gap-2">
            {copyLinkError && (
              <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-xs truncate" title={copyLinkError}>{copyLinkError}</span>
            )}
            {pdfError && (
              <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{pdfError}</span>
            )}
            <button
              onClick={handleCopyLink}
              disabled={copyingLink || !activeRunId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: copyLinkDone ? "#16a34a" : "#1e293b", color: "white" }}
              title="Copy a shareable link to this audit report"
            >
              {copyingLink
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : copyLinkDone
                ? <Check className="w-3.5 h-3.5" />
                : <Link className="w-3.5 h-3.5" />}
              {copyLinkDone ? "Copied!" : "Copy Link"}
            </button>
            <button
              onClick={handleExportPDF}
              disabled={pdfExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: "#1A7A45" }}
            >
              {pdfExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {pdfExporting ? "Generating..." : "Export PDF"}
            </button>
          </div>
        </div>
      )}
      {activeSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 p-4 flex flex-col items-center justify-center bg-white shadow-sm">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">Health Score</div>
            <div className="text-5xl font-black" style={{ color: auditScoreHex(activeSummary.healthScore) }}>{activeSummary.healthScore}</div>
            <div className="text-xs text-muted-foreground mt-1">/ 100</div>
            {activeSummary.pageSpeedScore !== null && (
              <div className="mt-2 text-[10px] text-muted-foreground">PageSpeed: {activeSummary.pageSpeedScore}</div>
            )}
          </div>
          {[
            { label: "Critical", count: activeSummary.criticalCount, color: "#EF4444" },
            { label: "High", count: activeSummary.highCount, color: "#F97316" },
            { label: "Medium", count: activeSummary.mediumCount, color: "#EAB308" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-gray-200 p-4 flex flex-col items-center justify-center bg-white shadow-sm" style={{ borderColor: `${item.color}30` }}>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">{item.label} Issues</div>
              <div className="text-4xl font-black" style={{ color: item.color }}>{item.count}</div>
            </div>
          ))}
        </div>
      )}

      {/* AI Report */}
      {activeSummary?.aiReport && (
        <div className="rounded-xl border border-gray-200 p-4 bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">AI Brand Report</div>
          <div className="space-y-3">
            {activeSummary.aiReport.split("\n\n").map((para, i) => (
              <p key={i} className="text-xs text-gray-700 leading-relaxed whitespace-pre-line">{para}</p>
            ))}
          </div>
        </div>
      )}

      {/* Signal Checklist — streaming or history */}
      {(activeCategories.length > 0 || running) && (
        <div ref={signalsPanelRef} className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground uppercase tracking-wider px-4 py-3 border-b border-gray-200 flex items-center gap-2">
            Signal Checklist
            {running && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            {highlightedCategory && (
              <>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium border" style={{ background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe" }}>
                  {activeCategories.find((c) => c.categorySlug === highlightedCategory)?.categoryName ?? highlightedCategory}
                </span>
                <button
                  onClick={() => { setHighlightedCategory(null); setCompareRunId(null); }}
                  className="text-[9px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                >
                  Show all
                </button>
              </>
            )}
            {changedSignalIds.size > 0 && (
              <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium border" style={{ background: "#fef3c7", color: "#d97706", borderColor: "#fde68a" }}>
                {changedSignalIds.size} changed vs previous run
              </span>
            )}
          </div>
          <div className="divide-y divide-gray-100">
            {(highlightedCategory ? activeCategories.filter((c) => c.categorySlug === highlightedCategory) : activeCategories).map((cat) => {
              const missing = cat.signals.filter((s) => s.status === "missing").length;
              const warnings = cat.signals.filter((s) => s.status === "warning").length;
              return (
                <div key={cat.categorySlug} className="p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-foreground">{cat.categoryName}</div>
                    <div className="flex gap-1.5">
                      {missing > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-medium">{missing} missing</span>
                      )}
                      {warnings > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200 font-medium">{warnings} warning</span>
                      )}
                      {missing === 0 && warnings === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 font-medium">all clear</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {cat.signals.map((signal) => (
                      <div key={signal.signalId} className="relative">
                        <div className="flex items-start gap-2">
                          {statusIcon(signal.severity, signal.status)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[11px] leading-tight ${signal.status === "present" ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                                {signal.signalName}
                              </span>
                              {statusBadge(signal.severity, signal.status)}
                              {signal.manualOverride && signal.aiStatus && wasStatusBadge(signal.aiStatus)}
                              {changedSignalIds.has(signal.signalId) && (
                                <span
                                  className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-medium border"
                                  style={{ background: "#fef3c7", color: "#d97706", borderColor: "#fde68a" }}
                                  title="This signal's status changed since the previous run"
                                >
                                  changed
                                </span>
                              )}
                              {signal.explanation && (
                                <button
                                  className="text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={() => setActiveTooltip(activeTooltip === signal.signalId ? null : signal.signalId)}
                                >
                                  <Info className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                            {activeTooltip === signal.signalId && signal.explanation && (
                              <div className="mt-1 text-[10px] text-muted-foreground leading-relaxed bg-gray-50 rounded px-2 py-1 border border-gray-100">
                                {signal.explanation}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            {running && activeCategories.length === 0 && (
              <GeneratingAnimation statusMsg={statusMsg} />
            )}
          </div>
        </div>
      )}

      {/* Previously saved audit categories when not streaming */}
      {showSavedAudit && activeCategories.length === 0 && (
        <div className="rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
          <div className="text-xs font-semibold text-foreground uppercase tracking-wider px-4 py-3 border-b border-gray-200">
            Signal Checklist
          </div>
          <div className="divide-y divide-gray-100">
            {categories.map((cat) => {
              const catSignals = savedSignals?.filter((s) => s.categorySlug === cat.slug) ?? [];
              if (catSignals.length === 0) return null;
              const missing = catSignals.filter((s) => s.status === "missing").length;
              const warnings = catSignals.filter((s) => s.status === "warning").length;
              return (
                <div key={cat.id} className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-foreground">{cat.name}</div>
                    <div className="flex gap-1.5">
                      {missing > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 font-medium">{missing} missing</span>}
                      {warnings > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200 font-medium">{warnings} warning</span>}
                      {missing === 0 && warnings === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 font-medium">all clear</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {catSignals.map((signal) => (
                      <div key={signal.signalId} className="relative flex items-start gap-2">
                        {statusIcon(signal.severity, signal.status)}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[11px] leading-tight ${signal.status === "present" ? "text-muted-foreground" : "text-foreground font-medium"}`}>
                            {signal.signalName}
                          </span>
                          {statusBadge(signal.severity, signal.status)}
                          {signal.manualOverride && signal.aiStatus && wasStatusBadge(signal.aiStatus)}
                          {signal.explanation && (
                            <button
                              className="text-muted-foreground hover:text-foreground transition-colors"
                              onClick={() => setActiveTooltip(activeTooltip === signal.signalId ? null : signal.signalId)}
                            >
                              <Info className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!activeSummary && !running && activeCategories.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 p-12 text-center">
          <Search className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <div className="text-sm text-muted-foreground">Select a lead and run the audit to see brand health results</div>
        </div>
      )}
      </>)}
    </div>
  );
}
