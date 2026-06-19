import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatRelative(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export const LEAD_STATUS_LIST = [
  "new_enquiry", "enquiry_qualified", "discovery_call",
  "quote_sent", "follow_up", "project_won", "project_lost",
] as const;
export type LeadStatus = typeof LEAD_STATUS_LIST[number];

export const STATUS_LABELS: Record<string, string> = {
  new_enquiry:        "New Enquiry",
  enquiry_qualified:  "Enquiry Qualified",
  discovery_call:     "Discovery Call",
  quote_sent:         "Quote / Estimation Sent",
  follow_up:          "Follow Up / Negotiation",
  project_won:        "Project Won",
  project_lost:       "Project Lost",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export const STATUS_COLORS: Record<string, string> = {
  new_enquiry:       "bg-blue-50 text-blue-700 border-blue-200",
  enquiry_qualified: "bg-purple-50 text-purple-700 border-purple-200",
  discovery_call:    "bg-teal-50 text-teal-700 border-teal-200",
  quote_sent:        "bg-amber-50 text-amber-700 border-amber-200",
  follow_up:         "bg-orange-50 text-orange-600 border-orange-200",
  project_won:       "bg-green-50 text-green-700 border-green-200",
  project_lost:      "bg-red-50 text-red-600 border-red-200",
  pending:           "bg-yellow-50 text-yellow-700 border-yellow-200",
  sent:              "bg-teal-50 text-teal-700 border-teal-200",
  viewed:            "bg-cyan-50 text-cyan-700 border-cyan-200",
  negotiating:       "bg-amber-50 text-amber-700 border-amber-200",
  draft:             "bg-gray-100 text-gray-600 border-gray-200",
  scheduled:         "bg-blue-50 text-blue-700 border-blue-200",
  completed:         "bg-green-50 text-green-700 border-green-200",
  cancelled:         "bg-red-50 text-red-600 border-red-200",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
}

export type BandKey = "hot" | "qualified" | "nurture" | "disqualify";

export function scoreToBandKey(score: number | null | undefined): BandKey | null {
  if (score == null || score === 0) return null;
  if (score >= 85) return "hot";
  if (score >= 65) return "qualified";
  if (score >= 45) return "nurture";
  return "disqualify";
}

export function bandColorFromKey(key: BandKey | string | null | undefined): string {
  switch (key) {
    case "hot":        return "text-red-600";
    case "qualified":  return "text-green-700";
    case "nurture":    return "text-amber-600";
    case "disqualify": return "text-slate-500";
    default:           return "text-gray-400";
  }
}

export function bandLabelFromKey(key: BandKey | string | null | undefined): string {
  switch (key) {
    case "hot":        return "Hot";
    case "qualified":  return "Qualified";
    case "nurture":    return "Nurture";
    case "disqualify": return "Disqualify";
    default:           return "Unscored";
  }
}

export function bandHexFromKey(key: BandKey | string | null | undefined, accentHex?: string): string {
  const green = accentHex ?? "#16A34A";
  switch (key) {
    case "hot":
    case "qualified":  return green;
    case "nurture":    return "#FBBF24";
    default:           return "#F87171";
  }
}

export function bandGradientFromKey(key: BandKey | string | null | undefined, accentHex?: string): string {
  const green = accentHex ?? "#16A34A";
  switch (key) {
    case "hot":
    case "qualified":  return `linear-gradient(90deg, #1B4D36, ${green})`;
    case "nurture":    return "linear-gradient(90deg, #4A2800, #FBBF24)";
    default:           return "linear-gradient(90deg, #3D0A0A, #F87171)";
  }
}

export function auditScoreHex(score: number): string {
  if (score >= 70) return "#22C55E";
  if (score >= 50) return "#F59E0B";
  return "#EF4444";
}

export function auditScoreLabel(score: number): string {
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Poor";
}

export function auditScoreRgb(score: number): { r: number; g: number; b: number } {
  if (score >= 70) return { r: 34, g: 197, b: 94 };
  if (score >= 50) return { r: 245, g: 158, b: 11 };
  return { r: 239, g: 68, b: 68 };
}

export function auditScoreColors(score: number): { text: string; bg: string; bar: string } {
  if (score >= 70) return { text: "#16a34a", bg: "#dcfce7", bar: "#16a34a" };
  if (score >= 50) return { text: "#d97706", bg: "#fef3c7", bar: "#f59e0b" };
  return { text: "#dc2626", bg: "#fee2e2", bar: "#ef4444" };
}

export function healthScoreColor(score: number): string {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

export function bantSubScoreColor(pct: number): string {
  if (pct >= 70) return "#16a34a";
  if (pct >= 40) return "#d97706";
  return "#dc2626";
}

export function bantBandMeta(score: number): { label: string; color: string } {
  const key = scoreToBandKey(score);
  if (key === "hot") return { label: "HOT — Book Meeting Now", color: "#EF4444" };
  if (key === "qualified") return { label: "QUALIFIED — Continue Outreach", color: "#22C55E" };
  if (key === "nurture") return { label: "NURTURE — Long-term pipeline", color: "#3B82F6" };
  return { label: "DISQUALIFY — Remove from pipeline", color: "#EF4444" };
}

export function auditScoreTextClass(score: number): string {
  if (score >= 70) return "text-teal-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

export function bantBandChipStyle(score: number): { background: string; color: string } {
  const key = scoreToBandKey(score);
  if (key === "hot" || key === "qualified") return { background: "#D1FAE5", color: "#065F46" };
  if (key === "nurture") return { background: "#FEF3C7", color: "#92400E" };
  return { background: "#FEE2E2", color: "#991B1B" };
}

export function bantBandDarkColor(score: number, accentColor: string): string {
  const key = scoreToBandKey(score);
  if (key === "hot" || key === "qualified") return accentColor;
  if (key === "nurture") return "#FBBF24";
  return "#F87171";
}

export function bantBandDarkGradient(score: number, accentColor: string): string {
  const key = scoreToBandKey(score);
  if (key === "hot" || key === "qualified") return `linear-gradient(90deg, #1B4D36, ${accentColor})`;
  if (key === "nurture") return "linear-gradient(90deg, #4A2800, #FBBF24)";
  return "linear-gradient(90deg, #3D0A0A, #F87171)";
}
