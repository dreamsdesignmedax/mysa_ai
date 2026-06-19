import { cn, statusColor } from "@/lib/utils";

interface BadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: BadgeProps) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border", statusColor(status), className)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

interface TagProps {
  label: string;
  className?: string;
}

export function Tag({ label, className }: TagProps) {
  return (
    <span
      className={cn("inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium", className)}
      style={{ background: "#F3F4F6", color: "#6B7280", border: "1px solid #E5E7EB" }}
    >
      {label}
    </span>
  );
}
