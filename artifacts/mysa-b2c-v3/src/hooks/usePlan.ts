import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PlanUsage {
  leads: { used: number; max: number };
  audits: { used: number; max: number };
  emails: { used: number; max: number };
}

export interface PlanFeatures {
  autopilot: boolean;
  whatsapp_api: boolean;
  hubspot_sync: boolean;
  sales_brain: boolean;
  white_label: boolean;
  data_fetch: boolean;
  users_max: number;
  icps_max: number;
}

export interface CurrentPlan {
  plan: string;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  trialStartedAt: string | null;
  trialExpired: boolean;
  trialDaysLeft: number;
  currentPeriodEnd: string | null;
  usage: PlanUsage;
  features: PlanFeatures;
}

export function usePlan() {
  return useQuery<CurrentPlan>({
    queryKey: ["billing-current-plan"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/billing/current-plan`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plan");
      return res.json() as Promise<CurrentPlan>;
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function usePlanPlans() {
  return useQuery<{ plans: PlanInfo[]; razorpayKeyId: string | null }>({
    queryKey: ["billing-plans"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/billing/plans`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load plans");
      return res.json() as Promise<{ plans: PlanInfo[]; razorpayKeyId: string | null }>;
    },
    staleTime: 60 * 60 * 1000,
  });
}

export interface PlanInfo {
  key: string;
  name: string;
  tagline: string;
  priceINR: number;
  priceINRYearly: number;
  leads_max: number;
  audits_max: number;
  emails_max: number;
  users_max: number;
  features: PlanFeatures;
  highlight: boolean;
}

export function formatLimit(val: number): string {
  return val === -1 ? "Unlimited" : val.toLocaleString();
}

export function planLabel(plan: string): string {
  const labels: Record<string, string> = {
    trial: "Free Trial",
    solo: "Solo",
    growth: "Growth",
    agency: "Agency",
  };
  return labels[plan] ?? plan;
}

export function planBadgeStyle(plan: string): { bg: string; text: string; border: string } {
  switch (plan) {
    case "trial":  return { bg: "#FEF3C7", text: "#B45309", border: "#FDE68A" };
    case "solo":   return { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" };
    case "growth": return { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE" };
    case "agency": return { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA" };
    default:       return { bg: "#F3F4F6", text: "#6B7280", border: "#E5E7EB" };
  }
}
