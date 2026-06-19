import { jsPDF } from "jspdf";
import { auditScoreLabel, auditScoreRgb } from "./utils";

export interface AuditSignal {
  signalName: string;
  status: string;
  severity: string;
  categorySlug: string;
  categoryName?: string;
  explanation?: string;
}

export interface AuditPdfInput {
  lead: {
    firstName: string;
    lastName: string;
    company: string;
    designation?: string | null;
    websiteUrl?: string | null;
    industry?: string | null;
    country?: string | null;
  };
  audit: {
    healthScore: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    aiReport?: string | null;
    signals: AuditSignal[];
  };
  branding?: {
    companyName?: string | null;
    tagline?: string | null;
    contactInfo?: string | null;
    brandColor?: string | null;
    logoBase64?: string | null;
  } | null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

function getLogoFormat(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/(\w+);/);
  if (!match) return "PNG";
  const fmt = match[1].toUpperCase();
  return fmt === "JPG" ? "JPEG" : fmt;
}

export async function generateAuditPdf(input: AuditPdfInput): Promise<Buffer> {
  const { lead, audit, branding } = input;

  // ── Brand palette ────────────────────────────────────────────────────────
  const brandColorRgb = (branding?.brandColor ? hexToRgb(branding.brandColor) : null) ?? { r: 92, g: 26, b: 140 };
  const DD_PURPLE  = brandColorRgb;
  const DD_MAGENTA = { r: 233, g: 30,  b: 140 };
  const DD_WHITE   = { r: 255, g: 255, b: 255 };
  const DD_DARK    = { r: 30,  g: 10,  b: 50  };
  const DD_LGRAY   = { r: 248, g: 245, b: 252 };

  const brandingCompanyName = branding?.companyName ?? null;
  const brandingTagline     = branding?.tagline     ?? null;
  const brandingContactInfo = branding?.contactInfo ?? null;

  const footerParts: string[] = [];
  if (brandingCompanyName) footerParts.push(brandingCompanyName);
  if (brandingTagline)     footerParts.push(brandingTagline);
  if (brandingContactInfo) footerParts.push(brandingContactInfo);
  const FOOTER_TEXT = footerParts.length > 0
    ? footerParts.join("  ·  ")
    : "Report generated with Love by dreamsdesign.in — Your Digital Growth Partner.";

  // ── Score helpers ────────────────────────────────────────────────────────
  const score      = audit.healthScore;
  const scoreColor = auditScoreRgb(score);
  const scoreLabel = auditScoreLabel(score);

  // ── jsPDF setup ──────────────────────────────────────────────────────────
  const doc    = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const PW     = 210;
  const ML     = 14, MR = 14;
  const usable = PW - ML - MR;
  const CONTENT_BOTTOM = 274;
  const LOGO_MAX_H = 12;
  const LOGO_H_P1  = 14;

  let y = 0;
  const txt = (s: string | null | undefined) => String(s ?? "");

  // ── Helpers ──────────────────────────────────────────────────────────────
  const setFill  = (c: { r: number; g: number; b: number }) => doc.setFillColor(c.r, c.g, c.b);
  const setDraw  = (c: { r: number; g: number; b: number }) => doc.setDrawColor(c.r, c.g, c.b);
  const setColor = (c: { r: number; g: number; b: number }) => doc.setTextColor(c.r, c.g, c.b);

  // Logo detection
  let logoDataUrl: string | null = branding?.logoBase64 ?? null;
  let logoAspect = 3.2;
  const logoFormat = logoDataUrl ? getLogoFormat(logoDataUrl) : "PNG";

  const drawLogo = (x: number, topY: number, height: number) => {
    if (!logoDataUrl) return;
    const w = height * logoAspect;
    try { doc.addImage(logoDataUrl!, logoFormat, x, topY, w, height); } catch { /* skip bad logo */ }
  };

  // ── Footer ───────────────────────────────────────────────────────────────
  const drawFooter = () => {
    const FY = 282;
    setFill(DD_PURPLE);
    doc.rect(0, FY - 1, PW, 16, "F");
    setFill(DD_MAGENTA);
    doc.rect(0, FY - 1, PW, 1.2, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    setColor(DD_WHITE);
    doc.text(FOOTER_TEXT, PW / 2, FY + 5, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(6.5);
    doc.setTextColor(220, 180, 255);
    doc.text(`Page ${doc.getNumberOfPages()}`, PW - MR, FY + 10, { align: "right" });
  };

  // ── Sub-page mini header ─────────────────────────────────────────────────
  const drawSubHeader = () => {
    setFill(DD_PURPLE);
    doc.rect(0, 0, PW, 18, "F");
    setFill(DD_MAGENTA);
    doc.rect(0, 18, PW, 0.8, "F");
    if (logoDataUrl) drawLogo(ML, 3, LOGO_MAX_H);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    setColor(DD_WHITE);
    doc.text(
      brandingCompanyName ? txt(brandingCompanyName).toUpperCase() : "BRAND AUDIT REPORT",
      PW - MR, 11, { align: "right" }
    );
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
    doc.setTextColor(220, 180, 255);
    doc.text(txt(lead.company).toUpperCase(), PW - MR, 16, { align: "right" });
  };

  // ── Page break check ─────────────────────────────────────────────────────
  const checkNewPage = (needed: number) => {
    if (y + needed > CONTENT_BOTTOM) {
      drawFooter();
      doc.addPage();
      drawSubHeader();
      y = 24;
    }
  };

  // ══ PAGE 1: HEADER ═══════════════════════════════════════════════════════
  setFill(DD_PURPLE);
  doc.rect(0, 0, PW, 46, "F");
  setFill(DD_MAGENTA);
  doc.rect(0, 46, PW, 1.5, "F");
  // Decorative accent ellipses
  setFill({ r: 233, g: 30, b: 140 });
  doc.ellipse(188, 8, 30, 22, "F");
  setFill({ r: 92, g: 26, b: 140 });
  doc.ellipse(185, 5, 28, 20, "F");

  if (logoDataUrl) drawLogo(ML, 8, LOGO_H_P1);

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

  // Sub-info row
  const dateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  setFill(DD_LGRAY);
  doc.rect(0, 47.5, PW, 12, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  setColor(DD_PURPLE);
  doc.text(txt(lead.company), ML, 55);
  if (lead.websiteUrl) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    setColor(DD_MAGENTA);
    doc.text(txt(lead.websiteUrl), ML + doc.getTextWidth(txt(lead.company)) + 3, 55);
  }
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.setTextColor(130, 100, 160);
  doc.text(`Prepared on ${dateStr}`, PW - MR, 55, { align: "right" });

  y = 66;

  // ── Score gauge (drawn with jsPDF primitives — no canvas needed) ──────────
  const gaugeX  = PW - MR - 50;
  const gaugeY  = y;
  const gaugeW  = 50;
  const gaugeH  = 34;
  const cx      = gaugeX + gaugeW / 2;
  const cy      = gaugeY + 14;
  const radius  = 10;

  // Track circle (light purple ring)
  setDraw({ r: 233, g: 213, b: 255 });
  doc.setLineWidth(3);
  doc.circle(cx, cy, radius, "S");

  // Score-colored ring overlay (simulate fill by drawing a slightly smaller circle)
  setDraw(scoreColor);
  doc.setLineWidth(3);
  doc.circle(cx, cy, radius, "S");

  // Score number
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  setColor(scoreColor);
  doc.text(String(score), cx, cy + 2, { align: "center" });

  // "/100" and label
  doc.setFont("helvetica", "normal"); doc.setFontSize(6);
  doc.setTextColor(107, 114, 128);
  doc.text("/ 100", cx, cy + 8, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(7);
  setColor(scoreColor);
  doc.text(scoreLabel, cx, cy + 14, { align: "center" });

  // ── Issue count boxes ────────────────────────────────────────────────────
  const issueCols = [
    { label: "Critical",  count: audit.criticalCount, rgb: { r: 220, g: 38,  b: 38  }, bgRgb: { r: 255, g: 240, b: 240 } },
    { label: "High",      count: audit.highCount,     rgb: { r: 234, g: 88,  b: 12  }, bgRgb: { r: 255, g: 245, b: 235 } },
    { label: "Medium",    count: audit.mediumCount,   rgb: { r: 202, g: 138, b: 4   }, bgRgb: { r: 255, g: 252, b: 235 } },
  ];
  const boxW = (usable - gaugeW - 12) / 3;
  issueCols.forEach((col, i) => {
    const bx = ML + i * (boxW + 3);
    setFill(col.bgRgb);
    doc.roundedRect(bx, y, boxW, gaugeH, 3, 3, "F");
    setFill(col.rgb);
    doc.roundedRect(bx, y, 2.5, gaugeH, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(22);
    doc.setTextColor(col.rgb.r, col.rgb.g, col.rgb.b);
    doc.text(String(col.count), bx + boxW / 2 + 1, y + 18, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.setTextColor(100, 80, 120);
    doc.text(`${col.label} Issues`, bx + boxW / 2 + 1, y + 26, { align: "center" });
  });
  y += gaugeH + 8;

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
  if (audit.aiReport) {
    sectionHeader("AI Brand Report");
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.setTextColor(55, 40, 75);
    const paras = audit.aiReport.split("\n\n").filter(Boolean);
    for (const para of paras) {
      const lines = doc.splitTextToSize(txt(para), usable);
      checkNewPage(lines.length * 4.8 + 3);
      doc.text(lines, ML, y);
      y += lines.length * 4.8 + 3;
    }
    y += 4;
  }

  // ── Signal Checklist ─────────────────────────────────────────────────────
  if (audit.signals.length > 0) {
    sectionHeader("Signal Checklist");

    // Group by category
    const catMap = new Map<string, { categoryName: string; signals: AuditSignal[] }>();
    for (const sig of audit.signals) {
      const slug = sig.categorySlug;
      if (!catMap.has(slug)) {
        catMap.set(slug, { categoryName: sig.categoryName ?? slug, signals: [] });
      }
      catMap.get(slug)!.signals.push(sig);
    }

    for (const [, cat] of catMap) {
      checkNewPage(14);
      const missing  = cat.signals.filter((s) => s.status === "missing").length;
      const warnings = cat.signals.filter((s) => s.status === "warning").length;

      setFill({ r: 240, g: 232, b: 250 });
      doc.rect(ML, y, usable, 6.5, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8);
      setColor(DD_PURPLE);
      doc.text(txt(cat.categoryName).toUpperCase(), ML + 2, y + 4.5);

      const badgeText = missing > 0 ? `${missing} missing` : warnings > 0 ? `${warnings} warning` : "✓ all clear";
      const badgeRgb  = missing > 0 ? { r: 185, g: 28, b: 28 } : warnings > 0 ? { r: 161, g: 98, b: 7 } : { r: 21, g: 128, b: 61 };
      doc.setFont("helvetica", "normal"); doc.setFontSize(7);
      doc.setTextColor(badgeRgb.r, badgeRgb.g, badgeRgb.b);
      doc.text(badgeText, PW - MR, y + 4.5, { align: "right" });

      y += 8;

      cat.signals.forEach((sig, idx) => {
        const lineH      = 5;
        const nameLines  = doc.splitTextToSize(txt(sig.signalName), usable - 20);
        const explLines  = sig.explanation ? doc.splitTextToSize(txt(sig.explanation), usable - 20) : [];
        const rowH       = nameLines.length * lineH + (explLines.length > 0 ? explLines.length * 3.8 + 1.5 : 0) + 2;
        checkNewPage(rowH + 1);

        if (idx % 2 === 0) {
          setFill(DD_LGRAY);
          doc.rect(ML, y - 0.5, usable, rowH, "F");
        }

        const iconColor = sig.status === "present"
          ? { r: 22,  g: 163, b: 74  }
          : sig.severity === "critical" ? { r: 220, g: 38,  b: 38  }
          : sig.severity === "high"     ? { r: 234, g: 88,  b: 12  }
          :                               { r: 202, g: 138, b: 4   };
        const icon = sig.status === "present" ? "✓" : sig.severity === "critical" || sig.severity === "high" ? "✗" : "!";

        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        doc.setTextColor(iconColor.r, iconColor.g, iconColor.b);
        doc.text(icon, ML + 1, y + 3.5);

        doc.setFont("helvetica", sig.status === "present" ? "normal" : "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(
          sig.status === "present" ? 110 : 55,
          sig.status === "present" ? 80  : 40,
          sig.status === "present" ? 140 : 75
        );
        doc.text(nameLines, ML + 6, y + 3.5);

        const badge = sig.status === "present" ? "pass" : sig.status === "warning" ? "warning" : "fail";
        const bRgb  = sig.status === "present"
          ? { r: 21,  g: 128, b: 61  }
          : sig.status === "warning"
          ? { r: 161, g: 98,  b: 7   }
          : sig.severity === "critical"
          ? { r: 185, g: 28,  b: 28  }
          :   { r: 194, g: 65,  b: 12  };
        doc.setFont("helvetica", "bold"); doc.setFontSize(7);
        doc.setTextColor(bRgb.r, bRgb.g, bRgb.b);
        doc.text(badge, PW - MR, y + 3.5, { align: "right" });

        if (explLines.length > 0) {
          doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
          doc.setTextColor(130, 100, 160);
          doc.text(explLines, ML + 6, y + nameLines.length * lineH + 2);
        }
        y += rowH + 1;
      });
      y += 5;
    }
  }

  // ── Prepared by row ──────────────────────────────────────────────────────
  checkNewPage(20);
  y += 4;
  setFill({ r: 248, g: 243, b: 254 });
  doc.roundedRect(ML, y, usable, 14, 3, 3, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  setColor(DD_PURPLE);
  doc.text("Prepared by", ML + 6, y + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  setColor(DD_MAGENTA);
  doc.text(brandingCompanyName ?? "Dreamsdesign", ML + 6, y + 11);
  if (brandingContactInfo) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.setTextColor(130, 100, 160);
    doc.text(txt(brandingContactInfo), PW - MR, y + 11, { align: "right" });
  }
  y += 18;

  // ── Final footer ─────────────────────────────────────────────────────────
  drawFooter();

  return Buffer.from(doc.output("arraybuffer"));
}
