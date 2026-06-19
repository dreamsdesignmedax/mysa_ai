export type BandKey = "hot" | "qualified" | "nurture" | "disqualify";

export function scoreToBandKey(score: number | null | undefined): BandKey | null {
  if (score == null || score === 0) return null;
  if (score >= 85) return "hot";
  if (score >= 65) return "qualified";
  if (score >= 45) return "nurture";
  return "disqualify";
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

export function auditScoreHex(score: number): string {
  if (score >= 70) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}
