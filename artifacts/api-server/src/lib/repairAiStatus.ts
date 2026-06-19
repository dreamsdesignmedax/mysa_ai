export type AuditSignalRepair = {
  signalId: number;
  status: string;
  aiStatus?: string | null;
  manualOverride?: boolean;
  [key: string]: unknown;
};

export function repairAiStatus<T extends AuditSignalRepair>(signals: T[]): T[] {
  return signals.map((s) => {
    if (s.aiStatus != null) return s;
    if (!s.manualOverride) {
      return { ...s, aiStatus: s.status };
    }
    return s;
  });
}
