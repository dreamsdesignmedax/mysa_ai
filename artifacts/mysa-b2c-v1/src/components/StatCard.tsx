import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color?: "teal" | "amber" | "blue" | "green" | "red" | "purple";
  loading?: boolean;
}

const colorMap = {
  teal:   { icon: "#0D9488", bg: "#ECFDF5", badge: "#0D9488" },
  amber:  { icon: "#D97706", bg: "#FFFBEB", badge: "#D97706" },
  blue:   { icon: "#2563EB", bg: "#EFF6FF", badge: "#2563EB" },
  green:  { icon: "#16A34A", bg: "#F0FDF4", badge: "#16A34A" },
  red:    { icon: "#DC2626", bg: "#FEF2F2", badge: "#DC2626" },
  purple: { icon: "#7C3AED", bg: "#F5F3FF", badge: "#7C3AED" },
};

export default function StatCard({ label, value, icon: Icon, trend, color = "teal", loading }: StatCardProps) {
  const c = colorMap[color];
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "#ffffff",
        border: "1px solid hsl(220 13% 91%)",
        boxShadow: "0 1px 3px 0 rgb(0 0 0 / 0.04)",
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#9CA3AF" }}>
            {label}
          </div>
          {loading ? (
            <div className="h-7 w-16 rounded animate-pulse" style={{ background: "#F3F4F6" }} />
          ) : (
            <div className="text-2xl font-bold" style={{ color: "#111827" }}>{value}</div>
          )}
          {trend && !loading && (
            <div className="text-[11px] mt-1.5 font-medium" style={{ color: c.badge }}>{trend}</div>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ml-3"
          style={{ background: c.bg }}
        >
          <Icon className="w-5 h-5" style={{ color: c.icon }} />
        </div>
      </div>
    </div>
  );
}
