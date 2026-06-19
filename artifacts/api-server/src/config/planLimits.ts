export type PlanKey = "trial" | "solo" | "growth" | "agency";

export interface PlanLimits {
  leads_max: number;
  audits_max: number;
  emails_max: number;
  users_max: number;
  icps_max: number;
  autopilot: boolean;
  whatsapp_api: boolean;
  hubspot_sync: boolean;
  sales_brain: boolean;
  white_label: boolean;
  data_fetch: boolean;
  trial_days?: number;
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  trial: {
    leads_max:    100,
    audits_max:   5,
    emails_max:   10,
    users_max:    1,
    icps_max:     3,
    autopilot:    false,
    whatsapp_api: false,
    hubspot_sync: false,
    sales_brain:  false,
    white_label:  false,
    data_fetch:   false,
    trial_days:   7,
  },
  solo: {
    leads_max:    300,
    audits_max:   30,
    emails_max:   150,
    users_max:    1,
    icps_max:     5,
    autopilot:    false,
    whatsapp_api: false,
    hubspot_sync: false,
    sales_brain:  true,
    white_label:  false,
    data_fetch:   false,
  },
  growth: {
    leads_max:    2000,
    audits_max:   150,
    emails_max:   750,
    users_max:    5,
    icps_max:     -1,
    autopilot:    true,
    whatsapp_api: true,
    hubspot_sync: true,
    sales_brain:  true,
    white_label:  false,
    data_fetch:   true,
  },
  agency: {
    leads_max:    -1,
    audits_max:   500,
    emails_max:   -1,
    users_max:    -1,
    icps_max:     -1,
    autopilot:    true,
    whatsapp_api: true,
    hubspot_sync: true,
    sales_brain:  true,
    white_label:  true,
    data_fetch:   true,
  },
};

export function isPlanKey(val: unknown): val is PlanKey {
  return val === "trial" || val === "solo" || val === "growth" || val === "agency";
}

export function getLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[isPlanKey(plan) ? plan : "trial"];
}
