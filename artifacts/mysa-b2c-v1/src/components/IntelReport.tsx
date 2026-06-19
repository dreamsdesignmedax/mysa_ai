import type { FC } from "react";

// ── Color palette matching the HTML design ──────────────────
const C = {
  p: "#6C22D4", p2: "#8B45E8", p3: "#F3EEFF", p4: "#E4D4FF", p5: "#FAF7FF",
  d: "#E03128", d2: "#FFF1F0", d3: "#FFCCC7",
  am: "#C27D0E", am2: "#FFFBF0", am3: "#FFE49A",
  g: "#0A7A52", g2: "#F0FDF8", g3: "#A3E6CC",
  n9: "#111217", n7: "#3A3D4A", n5: "#6B6F80", n3: "#C4C7D4",
  n2: "#E8EAF0", n1: "#F4F5F8", n0: "#FAFAFA", wh: "#FFFFFF",
};

// ── Types ───────────────────────────────────────────────────
export interface IntelReportData {
  v: 2;
  companyName: string;
  website?: string;
  healthScore: number;
  criticalCount: number;
  hero: { monthlyRisk: string; annualRisk: string; fixTimeline: string };
  why: { quote: string; body: string; positiveTags: string[]; negativeTags: string[] };
  compare: {
    name: string;
    company: { label: string; status: "fail" | "warn" | "pass" };
    competitors: { label: string; status: "fail" | "warn" | "pass" };
    industry: { label: string; status: "fail" | "warn" | "pass" };
  }[];
  categoryScores: { name: string; score: number }[];
  revenueCards: { amount: string; title: string; note: string }[];
  findings: {
    num: string;
    severity: "critical" | "high";
    title: string;
    revenuePill: string;
    whatWeFound: string;
    exactFix: string;
  }[];
  belief: {
    score: number;
    title: string;
    pillLabel: string;
    pillType: "positive" | "neutral" | "negative";
    summary: string;
    quote: string;
    body: string;
    signals: { label: string; on: boolean }[];
  };
  actionPlan: {
    week: string;
    range: string;
    title: string;
    pillType: "urgent" | "high" | "medium" | "strategic";
    actions: { day: string; text: string }[];
  }[];
  cta: { eyebrow: string; phone: string; email: string; website: string; address?: string };
}

// ── Sub-components ──────────────────────────────────────────
type StatusType = "fail" | "warn" | "pass";
const statusStyles: Record<StatusType, { color: string; bg: string; border: string; prefix: string }> = {
  fail: { color: C.d, bg: C.d2, border: C.d3, prefix: "✕" },
  warn: { color: C.am, bg: C.am2, border: C.am3, prefix: "◑" },
  pass: { color: C.g, bg: C.g2, border: C.g3, prefix: "✓" },
};

function StatusBadge({ status, label }: { status: StatusType; label: string }) {
  const s = statusStyles[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 99, border: `1px solid ${s.border}`, background: s.bg, color: s.color }}>
      <span style={{ fontSize: 9 }}>{s.prefix}</span>{label}
    </span>
  );
}

type PillColor = "purple" | "red" | "amber" | "green" | "grey";
const pillStyles: Record<PillColor, { color: string; bg: string; border: string }> = {
  purple: { color: C.p, bg: C.p3, border: C.p4 },
  red:    { color: C.d, bg: C.d2, border: C.d3 },
  amber:  { color: C.am, bg: C.am2, border: C.am3 },
  green:  { color: C.g, bg: C.g2, border: C.g3 },
  grey:   { color: C.n5, bg: C.n1, border: C.n2 },
};
function Pill({ color, children }: { color: PillColor; children: React.ReactNode }) {
  const s = pillStyles[color];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "4px 11px", borderRadius: 99, border: `1px solid ${s.border}`, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ScoreBar({ name, score }: { name: string; score: number }) {
  const clampedScore = Math.max(0, Math.min(10, score));
  const pct = clampedScore * 10;
  const color = clampedScore <= 3 ? C.d : clampedScore <= 5 ? C.am : C.g;
  const grad = clampedScore <= 3
    ? `linear-gradient(90deg,${C.d},#F06B65)`
    : clampedScore <= 5
    ? `linear-gradient(90deg,${C.am},#E8A020)`
    : `linear-gradient(90deg,${C.g},#22C490)`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.n7 }}>{name}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{clampedScore} / 10</span>
      </div>
      <div style={{ height: 7, background: C.n2, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: grad, borderRadius: 99 }} />
      </div>
    </div>
  );
}

function SectionTag({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.p, background: C.p3, border: `1px solid ${C.p4}`, display: "inline-flex", padding: "4px 11px", borderRadius: 99, marginBottom: 10 }}>
      {children}
    </div>
  );
}
function SectionH({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 24, fontWeight: 800, color: C.n9, letterSpacing: "-0.5px", lineHeight: 1.2, marginBottom: 6 }}>{children}</h2>;
}
function SectionSub({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 15, fontWeight: 400, color: C.n5, marginBottom: 24, lineHeight: 1.65, maxWidth: 560 }}>{children}</p>;
}
function Hr() { return <div style={{ height: 1, background: C.n2 }} />; }

// ── Main Component ──────────────────────────────────────────
interface IntelReportProps {
  data: IntelReportData;
  auditDate: string;
}

export const IntelReport: FC<IntelReportProps> = ({ data, auditDate }) => {
  const { companyName, healthScore, criticalCount } = data;
  const scoreLabel = healthScore < 40 ? "Critical Risk" : healthScore < 60 ? "Needs Work" : healthScore < 80 ? "Good" : "Excellent";
  const scoreColor = healthScore < 40 ? C.d : healthScore < 60 ? C.am : C.g;
  const scoreBg = healthScore < 40 ? `linear-gradient(145deg,${C.d2},#fff3f2)` : healthScore < 60 ? `linear-gradient(145deg,${C.am2},#fffdf0)` : `linear-gradient(145deg,${C.g2},#f0fff8)`;
  const scoreBorder = healthScore < 40 ? C.d3 : healthScore < 60 ? C.am3 : C.g3;

  const sec: React.CSSProperties = { padding: "40px 18px" };
  const secAlt: React.CSSProperties = { padding: "40px 18px", background: C.wh, borderTop: `1px solid ${C.n2}`, borderBottom: `1px solid ${C.n2}` };
  const secTint: React.CSSProperties = { padding: "40px 18px", background: C.p5, borderTop: `1px solid ${C.p4}`, borderBottom: `1px solid ${C.p4}` };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans',-apple-system,sans-serif", background: C.n0, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.n2}`, boxShadow: "0 4px 24px rgba(17,18,23,.08)", color: C.n9, lineHeight: 1.6 }}>

      {/* ─ Sticky header ─ */}
      <div style={{ background: "rgba(255,255,255,.96)", backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.n2}`, padding: "0 18px", height: 50, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${C.p},${C.p2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: C.wh }}>M</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: C.n9, letterSpacing: "-0.3px" }}>Mysa<span style={{ color: C.p }}>AI</span> Intelligence Report</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pill color="purple">Intelligence Report</Pill>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.n5 }}>{auditDate}</span>
        </div>
      </div>

      {/* ══ HERO ═══════════════════════════════════════════ */}
      <div style={{ background: C.wh, borderBottom: `1px solid ${C.n2}`, padding: "40px 18px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle,rgba(108,34,212,.06) 0%,transparent 70%)", pointerEvents: "none" }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.d, marginBottom: 16 }}>
          <span style={{ width: 6, height: 6, borderRadius: 99, background: C.d, flexShrink: 0, display: "inline-block" }} />
          Confidential · Intelligence Report
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: C.n9, letterSpacing: "-0.7px", lineHeight: 1.18, marginBottom: 14 }}>
          You Built Something Real.<br />The World Just <span style={{ color: C.d }}>Can't Find It Yet.</span>
        </h1>
        <p style={{ fontSize: 15, fontWeight: 400, color: C.n5, lineHeight: 1.7, marginBottom: 24, maxWidth: 520 }}>
          MysaAI's Revenue Intelligence Engine ran a <strong style={{ fontWeight: 700, color: C.n9 }}>61-point digital audit</strong> on {data.website || companyName}. We found <strong style={{ fontWeight: 700, color: C.n9 }}>{criticalCount} critical gaps</strong> that are quietly costing you{" "}
          <span style={{ color: C.d, fontWeight: 700 }}>{data.hero.monthlyRisk} every month</span> — not because your work isn't good enough, but because the right people can't see it.
        </p>
        <div style={{ display: "flex", gap: 14, alignItems: "stretch", marginBottom: 20 }}>
          <div style={{ flexShrink: 0, background: scoreBg, border: `1.5px solid ${scoreBorder}`, borderRadius: 16, padding: "18px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, minWidth: 118, boxShadow: "0 4px 12px rgba(17,18,23,.06)" }}>
            <div style={{ fontSize: 54, fontWeight: 800, color: scoreColor, letterSpacing: -2, lineHeight: 1 }}>{healthScore}</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.n5 }}>/ 100</div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.wh, background: scoreColor, padding: "3px 9px", borderRadius: 99, marginTop: 2 }}>{scoreLabel}</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}>
            {([
              { label: "Critical Issues", val: `${criticalCount} Found`, type: "r" },
              { label: "Monthly Revenue Risk", val: data.hero.monthlyRisk, type: "r" },
              { label: "Annual Revenue Risk", val: data.hero.annualRisk, type: "a" },
              { label: "Time to Fix Everything", val: data.hero.fixTimeline, type: "g" },
            ] as const).map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < 3 ? `1px solid ${C.n2}` : "none" }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: C.n5 }}>{row.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: row.type === "r" ? C.d : row.type === "a" ? C.am : C.g }}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "Monthly Risk", val: data.hero.monthlyRisk, red: true },
            { label: "Annual Risk", val: data.hero.annualRisk, red: true },
            { label: "Gaps Found", val: String(criticalCount), red: true },
            { label: "Fix Timeline", val: data.hero.fixTimeline, red: false },
          ].map((s, i) => (
            <div key={i} style={{ background: C.n1, border: `1px solid ${C.n2}`, borderRadius: 10, padding: "13px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.n5, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: s.red ? C.d : C.g, letterSpacing: "-0.4px" }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
      <Hr />

      {/* ══ WHY ════════════════════════════════════════════ */}
      <div style={secAlt}>
        <SectionTag>Start With WHY</SectionTag>
        <SectionH>Before the Data,<br /><span style={{ color: C.p }}>The Human Truth</span></SectionH>
        <SectionSub>Every number in this report traces back to one gap. Not in your product. Not in your team. In how clearly your story is being told.</SectionSub>
        <div style={{ background: `linear-gradient(135deg,${C.p5} 0%,${C.wh} 100%)`, border: `1.5px solid ${C.p4}`, borderLeft: `4px solid ${C.p}`, borderRadius: 16, padding: 24, boxShadow: "0 8px 24px rgba(108,34,212,.12),0 2px 6px rgba(17,18,23,.06)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.p, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ background: C.p, color: C.wh, padding: "2px 8px", borderRadius: 99, fontSize: 9 }}>WHY</span>
            The WHY
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.n9, lineHeight: 1.5, letterSpacing: "-0.2px", marginBottom: 14, fontStyle: "italic" }}>
            "{data.why.quote}"
          </div>
          <div style={{ fontSize: 15, fontWeight: 400, color: C.n7, lineHeight: 1.75, marginBottom: 18 }} dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(data.why.body) }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.why.negativeTags.map((t, i) => <Pill key={`n${i}`} color="red">{t}</Pill>)}
            {data.why.positiveTags.map((t, i) => <Pill key={`p${i}`} color="green">{t} ✓</Pill>)}
          </div>
        </div>
      </div>
      <Hr />

      {/* ══ 90-SECOND TEST (COMPARE) ════════════════════════ */}
      <div style={sec}>
        <SectionTag>The 90-Second Test</SectionTag>
        <SectionH>What a Prospect Sees<br /><span style={{ color: C.p }}>Before They Call Anyone</span></SectionH>
        <SectionSub>A business owner comparing agencies spends 90 seconds per website before forming a shortlist. These signals decide if you make it — or get skipped.</SectionSub>
        <div style={{ background: `linear-gradient(135deg,${C.p},${C.p2})`, borderRadius: 16, padding: "20px 24px", display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16, boxShadow: "0 12px 32px rgba(108,34,212,.18),0 2px 8px rgba(108,34,212,.08)" }}>
          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>💡</span>
          <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,.9)", lineHeight: 1.65 }}>
            <strong style={{ fontWeight: 800, color: C.wh }}>The uncomfortable truth:</strong> A prospect who has never heard of {companyName} will judge your digital capability by your own digital presence. If your website doesn't do what you promise to do for clients — they notice. Every time.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.compare.map((row, i) => (
            <div key={i} style={{ background: C.wh, border: `1px solid ${C.n2}`, borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 3px rgba(17,18,23,.07)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.n9, marginBottom: 10 }}>{row.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {([
                  { colName: companyName, d: row.company },
                  { colName: "Competitors", d: row.competitors },
                  { colName: "Industry Standard", d: row.industry },
                ] as const).map(({ colName, d }, ci) => (
                  <div key={ci}>
                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.3, color: C.n5, marginBottom: 4 }}>{colName}</div>
                    <StatusBadge status={d.status} label={d.label} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Hr />

      {/* ══ SCORE BREAKDOWN ════════════════════════════════ */}
      <div style={secAlt}>
        <SectionTag>Score Breakdown</SectionTag>
        <SectionH>Overall Score: <span style={{ color: C.d }}>{healthScore}</span> / 100</SectionH>
        <SectionSub>Your strongest areas are holding up — this is not a failing business. It's a great business with a visibility problem. Fix that. The rest follows.</SectionSub>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.categoryScores.map((cat, i) => <ScoreBar key={i} name={cat.name} score={cat.score} />)}
        </div>
      </div>
      <Hr />

      {/* ══ REVENUE AT RISK ════════════════════════════════ */}
      <div style={sec}>
        <SectionTag>The Price of Inaction</SectionTag>
        <SectionH>What These Gaps Cost<br /><span style={{ color: C.d }}>Every Single Month</span></SectionH>
        <SectionSub>These aren't hypothetical losses. They're calculated against real traffic, real search volumes, and verified industry conversion benchmarks.</SectionSub>
        <div style={{ background: "linear-gradient(145deg,#FFF0EF,#FFF6F6)", border: `1.5px solid ${C.d3}`, borderRadius: 16, padding: "32px 24px", textAlign: "center", marginBottom: 16, boxShadow: "0 4px 12px rgba(17,18,23,.06)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.n5, marginBottom: 8 }}>Estimated Monthly Revenue At Risk</div>
          <div style={{ fontSize: 42, fontWeight: 800, color: C.d, letterSpacing: "-1.5px", lineHeight: 1, marginBottom: 6 }}>{data.hero.monthlyRisk}</div>
          <div style={{ fontSize: 15, fontWeight: 500, color: C.n7 }}>bleeding out of your pipeline every month</div>
          <div style={{ fontSize: 13, color: C.n5, marginTop: 4 }}>That's <strong style={{ color: C.am, fontWeight: 700 }}>{data.hero.annualRisk} per year</strong> that's yours to recover — starting in 30 days.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {data.revenueCards.map((card, i) => (
            <div key={i} style={{ background: C.wh, border: `1px solid ${C.n2}`, borderTop: `3px solid ${C.d3}`, borderRadius: 10, padding: 14, boxShadow: "0 1px 3px rgba(17,18,23,.07)" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.d, letterSpacing: "-0.4px", marginBottom: 4 }}>{card.amount}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.n9, marginBottom: 5 }}>{card.title}</div>
              <div style={{ fontSize: 11, fontWeight: 400, color: C.n5, lineHeight: 1.55 }}>{card.note}</div>
            </div>
          ))}
        </div>
      </div>
      <Hr />

      {/* ══ FINDINGS ═══════════════════════════════════════ */}
      <div style={secAlt}>
        <SectionTag>9 Critical Findings</SectionTag>
        <SectionH>The Gaps, The Cost,<br /><span style={{ color: C.p }}>The Fix — All of It.</span></SectionH>
        <SectionSub>Every finding ranked by revenue impact. Every action is specific enough to hand to your team today.</SectionSub>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.findings.map((f, i) => (
            <div key={i} style={{ background: C.wh, border: `1px solid ${C.n2}`, borderTop: `3px solid ${f.severity === "critical" ? C.d : C.am}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(17,18,23,.07)", transition: "box-shadow .25s" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 16px 14px" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, background: f.severity === "critical" ? C.d2 : C.am2, color: f.severity === "critical" ? C.d : C.am }}>
                  {f.num}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.n9, lineHeight: 1.35, marginBottom: 6 }}>{f.title}</div>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: C.d, background: C.d2, border: `1px solid ${C.d3}`, padding: "3px 10px", borderRadius: 99 }}>
                    <span style={{ fontWeight: 800 }}>→</span>{f.revenuePill}
                  </span>
                </div>
              </div>
              <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ borderRadius: 6, padding: "12px 14px", background: C.n1, border: `1px solid ${C.n2}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.n5, marginBottom: 6 }}>What We Found</div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: C.n7, lineHeight: 1.65 }}>{f.whatWeFound}</div>
                </div>
                <div style={{ borderRadius: 6, padding: "12px 14px", background: C.g2, border: `1px solid ${C.g3}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: C.g, marginBottom: 6 }}>Exact Fix</div>
                  <div style={{ fontSize: 13, fontWeight: 400, color: C.n7, lineHeight: 1.65 }}>{f.exactFix}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Hr />

      {/* ══ BELIEF SCORE ═══════════════════════════════════ */}
      <div style={secTint}>
        <SectionTag>Belief Alignment Score — BANTB</SectionTag>
        <SectionH>The 5th Dimension<br /><span style={{ color: C.p }}>Beyond Budget and Timeline</span></SectionH>
        <SectionSub>The clients who stay 3+ years, refer their peers, and never negotiate on price share your WHY. This score predicts who they are — before you ever speak.</SectionSub>
        <div style={{ background: C.wh, border: `1.5px solid ${C.p4}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 8px 24px rgba(108,34,212,.12)" }}>
          <div style={{ background: `linear-gradient(135deg,${C.p3},${C.p5})`, borderBottom: `1px solid ${C.p4}`, padding: "24px 24px 20px", display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ textAlign: "center", flexShrink: 0 }}>
              <div style={{ fontSize: 56, fontWeight: 800, color: C.p, letterSpacing: -2, lineHeight: 1 }}>{data.belief.score}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: C.n5 }}>/ 25 · Belief Score</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.n9, marginBottom: 6 }}>{data.belief.title}</div>
              <Pill color={data.belief.pillType === "positive" ? "purple" : data.belief.pillType === "neutral" ? "amber" : "red"}>{data.belief.pillLabel}</Pill>
              <p style={{ fontSize: 13, color: C.n7, marginTop: 10, lineHeight: 1.6 }}>{data.belief.summary}</p>
            </div>
          </div>
          <div style={{ padding: "20px 24px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, fontStyle: "italic", color: C.n9, lineHeight: 1.6, paddingLeft: 14, borderLeft: `3px solid ${C.p}`, marginBottom: 14 }}>"{data.belief.quote}"</div>
            <div style={{ fontSize: 13, color: C.n5, lineHeight: 1.7, marginBottom: 16 }}>{data.belief.body}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {data.belief.signals.map((sig, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 600, padding: "4px 11px", borderRadius: 99, display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid", color: sig.on ? C.g : C.n5, background: sig.on ? C.g2 : C.n1, borderColor: sig.on ? C.g3 : C.n2 }}>
                  <span style={{ fontSize: 9 }}>{sig.on ? "✓" : "○"}</span>{sig.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Hr />

      {/* ══ 30-DAY PLAN ════════════════════════════════════ */}
      <div style={sec}>
        <SectionTag>The 30-Day Playbook</SectionTag>
        <SectionH>Stop the Leak.<br /><span style={{ color: C.p }}>Rebuild the Funnel. Dominate Search.</span></SectionH>
        <SectionSub>Ordered strictly by revenue impact. The highest-return fixes go first. First results visible within 7 days of starting — not 90.</SectionSub>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.actionPlan.map((wk, i) => {
            const wkColor = wk.pillType === "urgent" ? C.d : wk.pillType === "high" ? C.am : wk.pillType === "medium" ? C.p : C.g;
            const wkBg = wk.pillType === "urgent" ? C.d2 : wk.pillType === "high" ? C.am2 : wk.pillType === "medium" ? C.p3 : C.g2;
            const pillColor: PillColor = wk.pillType === "urgent" ? "red" : wk.pillType === "high" ? "amber" : wk.pillType === "medium" ? "purple" : "green";
            const pillLabel = wk.pillType === "urgent" ? "Urgent" : wk.pillType === "high" ? "High" : wk.pillType === "medium" ? "Medium" : "Strategic";
            return (
              <div key={i} style={{ background: C.wh, border: `1px solid ${C.n2}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 3px rgba(17,18,23,.07)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${C.n2}` }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: wkColor, background: wkBg }}>{wk.week}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.n5, letterSpacing: 0.3 }}>{wk.range}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.n9 }}>{wk.title}</div>
                  </div>
                  <Pill color={pillColor}>{pillLabel}</Pill>
                </div>
                <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 0 }}>
                  {wk.actions.map((action, ai) => (
                    <div key={ai} style={{ display: "flex", gap: 12, padding: "11px 0", borderBottom: ai < wk.actions.length - 1 ? `1px solid ${C.n1}` : "none" }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, color: C.n5, minWidth: 52, flexShrink: 0, paddingTop: 1 }}>{action.day}</div>
                      <div style={{ fontSize: 13, color: C.n7, lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: sanitizeReportHtml(action.text) }} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Hr />

      {/* ══ CTA ════════════════════════════════════════════ */}
      <div style={{ background: C.wh, borderTop: `1px solid ${C.n2}`, padding: "48px 18px" }}>
        <div style={{ background: `linear-gradient(135deg,${C.p3},${C.p5})`, border: `1.5px solid ${C.p4}`, borderRadius: 16, padding: "20px 24px", marginBottom: 32, display: "flex", gap: 14, alignItems: "flex-start" }}>
          <span style={{ fontSize: 28, flexShrink: 0 }}>💜</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: C.p, marginBottom: 5 }}>MysaAI's WHY</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.n7, lineHeight: 1.65, fontStyle: "italic" }}>"We believe every business built with genuine purpose deserves to be seen, found, and chosen — not just by algorithm, but by the right people at the right moment."</div>
          </div>
        </div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: C.n9, letterSpacing: "-0.5px", lineHeight: 1.2, marginBottom: 10 }}>
          You've Read The Report.<br />Now There Are <em style={{ fontStyle: "italic", color: C.p }}>Two Paths.</em>
        </h2>
        <p style={{ fontSize: 15, color: C.n5, lineHeight: 1.7, marginBottom: 24 }}>
          This isn't a sales pitch. It's a decision point. The {criticalCount} gaps are real. The revenue numbers are calculated from your actual traffic. The 30-day plan is ready. The only question is what you do next.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 32 }}>
          <div style={{ borderRadius: 10, padding: 16, background: C.d2, border: `1.5px solid ${C.d3}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.d, marginBottom: 7 }}>Path A — Do Nothing</div>
            <div style={{ fontSize: 13, color: C.n7, lineHeight: 1.65 }}>Close this report. The gaps stay open. Every month, visitors leave without a trace. Competitors appear in ChatGPT. The compounding loss deepens quietly — until a competitor takes the position that was always yours to claim.</div>
          </div>
          <div style={{ borderRadius: 10, padding: 16, background: C.p3, border: `1.5px solid ${C.p4}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: C.p, marginBottom: 7 }}>Path B — Take Action</div>
            <div style={{ fontSize: 13, color: C.n7, lineHeight: 1.65 }}>One 30-minute conversation. No pitch. No pressure. Just a walk-through of exactly how to close these {criticalCount} gaps — starting this week, using your existing team and tools. First results visible in 7 days.</div>
          </div>
        </div>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.n5, marginBottom: 10 }}>{data.cta.eyebrow}</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.n9, letterSpacing: "-0.5px", marginBottom: 6 }}>{data.cta.phone}</div>
          <div style={{ fontSize: 15, color: C.n5, marginBottom: 3 }}>{data.cta.email}</div>
          <div style={{ fontSize: 13, color: C.n3 }}>{data.cta.website}</div>
        </div>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: `linear-gradient(135deg,${C.p},${C.p2})`, color: C.wh, fontSize: 15, fontWeight: 800, padding: 18, borderRadius: 16, boxShadow: "0 12px 32px rgba(108,34,212,.18),0 2px 8px rgba(108,34,212,.08)", marginBottom: 16, letterSpacing: 0.2, cursor: "pointer" }}
          onClick={() => { if (data.cta.phone) window.open(`tel:${data.cta.phone.replace(/[^+0-9]/g, "")}`); }}
        >
          Book Your Free Strategy Call — No Pitch, Just a Plan →
        </div>
        {data.cta.address && (
          <div style={{ fontSize: 11, color: C.n3, textAlign: "center", lineHeight: 1.7 }}>{data.cta.address}</div>
        )}
      </div>

      {/* ══ FOOTER ════════════════════════════════════════ */}
      <div style={{ background: C.n1, borderTop: `1px solid ${C.n2}`, padding: "32px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${C.p},${C.p2})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: C.wh }}>M</div>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.n9, letterSpacing: "-0.3px" }}>Mysa<span style={{ color: C.p }}>AI</span></span>
        </div>
        <div style={{ fontSize: 13, fontStyle: "italic", color: C.n7, lineHeight: 1.7, paddingLeft: 13, borderLeft: `2px solid ${C.p}`, marginBottom: 14 }}>
          "We believe every business built with genuine purpose deserves to be seen, found, and chosen — not just by algorithm, but by the right people."
        </div>
        <div style={{ fontSize: 11, color: C.n5, lineHeight: 1.65 }}>
          This report was prepared using automated web crawling, SERP analysis, public data sources, and AI-powered interpretation. Revenue impact estimates are based on industry benchmarks and are intended to illustrate the order-of-magnitude opportunity — they are not guarantees of outcome.
        </div>
        <div style={{ fontSize: 11, color: C.n3, marginTop: 8 }}>© 2026 MysaAI · A Dreamsdesign Product · All Rights Reserved</div>
      </div>
    </div>
  );
};

// ── Parser helper ───────────────────────────────────────────
export function generateReportHtml(data: IntelReportData, auditDate?: string): string {
  const date = auditDate ?? new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  const esc = (s: string | undefined | null) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const bdg = (status: "fail"|"warn"|"pass", label: string) =>
    `<span class="bdg ${status==="fail"?"bf":status==="warn"?"bw":"bp"}">${esc(label)}</span>`;
  const pillCls = (t: string) => t==="urgent"?"pr":t==="high"?"pa":t==="medium"?"pp":"pn";
  const wkBg = (t: string) => t==="urgent"?"var(--d2)":t==="high"?"var(--am2)":t==="medium"?"var(--p3)":"var(--g2)";
  const wkClr = (t: string) => t==="urgent"?"var(--d)":t==="high"?"var(--am)":t==="medium"?"var(--p)":"var(--g)";
  const barClr = (s: number) => s<=3?"linear-gradient(90deg,var(--d),#F06B65)":s<=6?"linear-gradient(90deg,var(--am),#E8A020)":"linear-gradient(90deg,var(--g),#22C490)";
  const scoreClr = (s: number) => s<=3?"var(--d)":s<=6?"var(--am)":"var(--g)";
  const scoreLabel = (s: number) => s>=70?"Good Health":s>=50?"Needs Work":s>=30?"At Risk":"Critical Risk";
  const css = `
:root{--p:#6C22D4;--p2:#8B45E8;--p3:#F3EEFF;--p4:#E4D4FF;--p5:#FAF7FF;--d:#E03128;--d2:#FFF1F0;--d3:#FFCCC7;--am:#C27D0E;--am2:#FFFBF0;--am3:#FFE49A;--g:#0A7A52;--g2:#F0FDF8;--g3:#A3E6CC;--n9:#111217;--n8:#1E2029;--n7:#3A3D4A;--n5:#6B6F80;--n3:#C4C7D4;--n2:#E8EAF0;--n1:#F4F5F8;--n0:#FAFAFA;--wh:#FFFFFF;--sh1:0 1px 3px rgba(17,18,23,.07),0 1px 2px rgba(17,18,23,.04);--sh2:0 4px 12px rgba(17,18,23,.06),0 2px 4px rgba(17,18,23,.04);--sh3:0 8px 24px rgba(108,34,212,.12),0 2px 6px rgba(17,18,23,.06);--shp:0 12px 32px rgba(108,34,212,.18),0 2px 8px rgba(108,34,212,.08);--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--s6:24px;--s8:32px;--s10:40px;--s12:48px;--r1:6px;--r2:10px;--r3:16px;--r4:22px;--px:18px}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html{-webkit-text-size-adjust:100%}
body{font-family:'Plus Jakarta Sans',-apple-system,sans-serif;font-size:15px;font-weight:400;line-height:1.6;color:var(--n9);background:var(--n0);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.pill{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;padding:4px 11px;border-radius:99px;border:1px solid;white-space:nowrap}
.pp{color:var(--p);background:var(--p3);border-color:var(--p4)}.pr{color:var(--d);background:var(--d2);border-color:var(--d3)}.pa{color:var(--am);background:var(--am2);border-color:var(--am3)}.pg{color:var(--g);background:var(--g2);border-color:var(--g3)}.pn{color:var(--n5);background:var(--n1);border-color:var(--n2)}
.bdg{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;border:1px solid}
.bf{color:var(--d);background:var(--d2);border-color:var(--d3)}.bf::before{content:'✕';font-size:9px}
.bw{color:var(--am);background:var(--am2);border-color:var(--am3)}.bw::before{content:'◑';font-size:9px}
.bp{color:var(--g);background:var(--g2);border-color:var(--g3)}.bp::before{content:'✓';font-size:9px;font-weight:800}
.wrap{max-width:720px;margin:0 auto}.sec{padding:var(--s10) var(--px)}.sec-alt{background:var(--wh);border-top:1px solid var(--n2);border-bottom:1px solid var(--n2);padding:var(--s10) var(--px)}.hr{height:1px;background:var(--n2)}
.stag{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--p);background:var(--p3);border:1px solid var(--p4);display:inline-flex;padding:4px 11px;border-radius:99px;margin-bottom:10px}
.sh{font-size:24px;font-weight:800;color:var(--n9);letter-spacing:-.5px;line-height:1.2;margin-bottom:6px}.sh .ac{color:var(--p)}.sh .rd{color:var(--d)}
.ssub{font-size:15px;font-weight:400;color:var(--n5);margin-bottom:var(--s6);line-height:1.65;max-width:560px}
.nav{position:sticky;top:0;z-index:100;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--n2);padding:0 var(--px);height:54px;display:flex;align-items:center;justify-content:space-between}
.nbrand{display:flex;align-items:center;gap:9px}.nicon{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:var(--wh)}.nname{font-size:15px;font-weight:800;color:var(--n9);letter-spacing:-.3px}.nname b{color:var(--p)}
.hero{background:var(--wh);border-bottom:1px solid var(--n2);padding:var(--s10) var(--px) var(--s8);position:relative;overflow:hidden}
.hero-kicker{display:inline-flex;align-items:center;gap:7px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--d);margin-bottom:16px}
.hero-kicker-dot{width:6px;height:6px;border-radius:99px;background:var(--d);flex-shrink:0}
.hero-h{font-size:32px;font-weight:800;color:var(--n9);letter-spacing:-.7px;line-height:1.18;margin-bottom:14px}.hero-h .rd{color:var(--d)}
.hero-intro{font-size:15px;font-weight:400;color:var(--n5);line-height:1.7;margin-bottom:var(--s6);max-width:520px}.hero-intro strong{font-weight:700;color:var(--n9)}.hero-intro .rd{color:var(--d);font-weight:700}
.hero-score-row{display:flex;gap:14px;align-items:stretch;margin-bottom:var(--s5)}
.score-block{flex-shrink:0;background:linear-gradient(145deg,var(--d2),#fff3f2);border:1.5px solid var(--d3);border-radius:var(--r3);padding:18px 22px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:118px}
.score-n{font-size:54px;font-weight:800;color:var(--d);letter-spacing:-2px;line-height:1}.score-d{font-size:13px;font-weight:500;color:var(--n5)}
.score-badge{font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--wh);background:var(--d);padding:3px 9px;border-radius:99px;margin-top:2px}
.score-facts{flex:1;display:flex;flex-direction:column;justify-content:space-between;gap:6px}
.sf-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--n2)}.sf-row:last-child{border-bottom:none}
.sf-label{font-size:13px;font-weight:500;color:var(--n5)}.sf-val{font-size:13px;font-weight:700}.sf-val.r{color:var(--d)}.sf-val.g{color:var(--g)}.sf-val.a{color:var(--am)}
.stat-strip{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:var(--s5)}
.stat-card{background:var(--n1);border:1px solid var(--n2);border-radius:var(--r2);padding:13px 14px}
.stat-label{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--n5);margin-bottom:4px}
.stat-val{font-size:18px;font-weight:800;color:var(--n9);letter-spacing:-.4px}.stat-val.r{color:var(--d)}.stat-val.g{color:var(--g)}
.why-section{padding:var(--s10) var(--px);background:var(--wh);border-top:1px solid var(--n2);border-bottom:1px solid var(--n2)}
.why-card{background:linear-gradient(135deg,var(--p5) 0%,var(--wh) 100%);border:1.5px solid var(--p4);border-left:4px solid var(--p);border-radius:var(--r3);padding:var(--s6)}
.why-label{font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--p);margin-bottom:10px;display:flex;align-items:center;gap:6px}
.why-label::before{content:'WHY';background:var(--p);color:var(--wh);padding:2px 8px;border-radius:99px;font-size:9px}
.why-quote{font-size:18px;font-weight:700;color:var(--n9);line-height:1.5;letter-spacing:-.2px;margin-bottom:14px;font-style:italic}
.why-body{font-size:15px;font-weight:400;color:var(--n7);line-height:1.75;margin-bottom:18px}.why-body strong{font-weight:700;color:var(--n9)}
.why-tags{display:flex;flex-wrap:wrap;gap:6px}
.insight{background:linear-gradient(135deg,var(--p),var(--p2));border-radius:var(--r3);padding:var(--s5) var(--s6);display:flex;align-items:flex-start;gap:14px;margin-bottom:var(--s4)}
.insight-icon{font-size:24px;flex-shrink:0;margin-top:2px}.insight-text{font-size:13px;font-weight:500;color:rgba(255,255,255,.9);line-height:1.65}.insight-text strong{font-weight:800;color:var(--wh)}
.clist{display:flex;flex-direction:column;gap:8px}
.citem{background:var(--wh);border:1px solid var(--n2);border-radius:var(--r2);padding:14px 16px}
.cname{font-size:13px;font-weight:700;color:var(--n9);margin-bottom:10px}.crow{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}.ccol-name{font-size:11px;font-weight:600;letter-spacing:.3px;color:var(--n5);margin-bottom:4px}
.bars{display:flex;flex-direction:column;gap:14px}.bar-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px}.bar-lbl{font-size:13px;font-weight:600;color:var(--n7)}.bar-val{font-size:13px;font-weight:800}
.bar-track{height:7px;background:var(--n2);border-radius:99px;overflow:hidden}.bar-fill{height:100%;border-radius:99px}
.rev-hero{background:linear-gradient(145deg,#FFF0EF,#FFF6F6);border:1.5px solid var(--d3);border-radius:var(--r3);padding:var(--s8) var(--s6);text-align:center;margin-bottom:var(--s4)}
.rev-eyebrow{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--n5);margin-bottom:8px}
.rev-num{font-size:42px;font-weight:800;color:var(--d);letter-spacing:-1.5px;line-height:1;margin-bottom:6px}.rev-sub{font-size:15px;font-weight:500;color:var(--n7)}
.rev-annual{font-size:13px;color:var(--n5);margin-top:4px}.rev-annual strong{color:var(--am);font-weight:700}
.rgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.rcard{background:var(--wh);border:1px solid var(--n2);border-radius:var(--r2);padding:14px;border-top:3px solid var(--d3)}
.rcard-num{font-size:18px;font-weight:800;color:var(--d);letter-spacing:-.4px;margin-bottom:4px}.rcard-title{font-size:13px;font-weight:700;color:var(--n9);margin-bottom:5px}.rcard-note{font-size:11px;font-weight:400;color:var(--n5);line-height:1.55}
.fc-list{display:flex;flex-direction:column;gap:14px}.fc{background:var(--wh);border:1px solid var(--n2);border-radius:var(--r3);overflow:hidden}
.fc.cr{border-top:3px solid var(--d)}.fc.hi{border-top:3px solid var(--am)}
.fc-head{display:flex;align-items:flex-start;gap:12px;padding:16px 16px 14px}
.fc-num{width:28px;height:28px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}
.fc.cr .fc-num{background:var(--d2);color:var(--d)}.fc.hi .fc-num{background:var(--am2);color:var(--am)}
.fc-title-wrap{flex:1}.fc-title{font-size:15px;font-weight:700;color:var(--n9);line-height:1.35;margin-bottom:6px}
.fc-rev-pill{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--d);background:var(--d2);border:1px solid var(--d3);padding:3px 10px;border-radius:99px}
.fc-rev-pill::before{content:'→';font-weight:800}
.fc-body{padding:0 16px 16px;display:flex;flex-direction:column;gap:10px}
.fc-block{border-radius:var(--r1);padding:12px 14px}.fc-block.fi{background:var(--n1);border:1px solid var(--n2)}.fc-block.ac{background:var(--g2);border:1px solid var(--g3)}
.fc-block-lbl{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;margin-bottom:6px}.fc-block.fi .fc-block-lbl{color:var(--n5)}.fc-block.ac .fc-block-lbl{color:var(--g)}
.fc-block-text{font-size:13px;font-weight:400;color:var(--n7);line-height:1.65}
.belief{background:var(--wh);border:1.5px solid var(--p4);border-radius:var(--r3);overflow:hidden}
.belief-top{background:linear-gradient(135deg,var(--p3),var(--p5));border-bottom:1px solid var(--p4);padding:var(--s6) var(--s6) var(--s5);display:flex;align-items:center;gap:var(--s5)}
.belief-score-wrap{text-align:center}.belief-score-num{font-size:56px;font-weight:800;color:var(--p);letter-spacing:-2px;line-height:1}.belief-score-of{font-size:13px;font-weight:500;color:var(--n5)}
.belief-info{flex:1}.belief-title{font-size:18px;font-weight:800;color:var(--n9);margin-bottom:6px}
.belief-body{padding:var(--s5) var(--s6)}.belief-quote{font-size:15px;font-weight:600;font-style:italic;color:var(--n9);line-height:1.6;padding-left:14px;border-left:3px solid var(--p);margin-bottom:14px}
.belief-text{font-size:13px;color:var(--n5);line-height:1.7;margin-bottom:16px}
.sigs{display:flex;flex-wrap:wrap;gap:6px}
.sig{font-size:11px;font-weight:600;padding:4px 11px;border-radius:99px;border:1px solid;display:flex;align-items:center;gap:4px}
.sig.on{color:var(--g);background:var(--g2);border-color:var(--g3)}.sig.on::before{content:'✓';font-weight:800}
.sig.off{color:var(--n5);background:var(--n1);border-color:var(--n2)}.sig.off::before{content:'○';color:var(--n3)}
.week-list{display:flex;flex-direction:column;gap:10px}
.wk{background:var(--wh);border:1px solid var(--n2);border-radius:var(--r3);overflow:hidden}
.wk-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--n2)}
.wk-num-box{width:44px;height:44px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800}
.wk-info{flex:1}.wk-range{font-size:11px;font-weight:600;color:var(--n5);letter-spacing:.3px}.wk-title{font-size:15px;font-weight:700;color:var(--n9)}
.wk-body{padding:14px 16px;display:flex;flex-direction:column;gap:0}
.wk-action{display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--n1)}.wk-action:last-child{border-bottom:none;padding-bottom:0}
.wk-day{font-size:11px;font-weight:700;letter-spacing:.3px;color:var(--n5);min-width:48px;flex-shrink:0;padding-top:1px}
.wk-text{font-size:13px;color:var(--n7);line-height:1.65}.wk-text strong{font-weight:700;color:var(--n9)}
.cta-section{background:var(--wh);border-top:1px solid var(--n2);padding:var(--s12) var(--px)}
.cta-h{font-size:28px;font-weight:800;color:var(--n9);letter-spacing:-.5px;line-height:1.2;margin-bottom:10px}.cta-h em{font-style:italic;color:var(--p)}
.cta-sub{font-size:15px;color:var(--n5);line-height:1.7;margin-bottom:var(--s6)}
.cta-contact{text-align:center;margin-bottom:var(--s6)}
.cta-eyebrow{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--n5);margin-bottom:10px}
.cta-phone{font-size:28px;font-weight:800;color:var(--n9);letter-spacing:-.5px;margin-bottom:6px}
.cta-email{font-size:15px;color:var(--n5);margin-bottom:3px}.cta-web{font-size:13px;color:var(--n3)}
.cta-btn{display:flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(135deg,var(--p),var(--p2));color:var(--wh);font-size:15px;font-weight:800;padding:18px;border-radius:var(--r3);margin-bottom:var(--s4);letter-spacing:.2px}
.cta-addr{font-size:11px;color:var(--n3);text-align:center;line-height:1.7}
.footer{background:var(--n1);border-top:1px solid var(--n2);padding:var(--s8) var(--px)}
.footer-brand{display:flex;align-items:center;gap:9px;margin-bottom:14px}.footer-brand-text{font-size:18px;font-weight:800;color:var(--n9)}.footer-brand-text b{color:var(--p)}
.footer-why{font-size:13px;font-style:italic;color:var(--n7);line-height:1.7;padding-left:13px;border-left:2px solid var(--p);margin-bottom:14px}
.footer-disc{font-size:11px;color:var(--n5);line-height:1.65}.footer-copy{font-size:11px;color:var(--n3);margin-top:8px}
@media(min-width:600px){:root{--px:32px}.stat-strip{grid-template-columns:repeat(4,1fr)}.rgrid{grid-template-columns:repeat(3,1fr)}}
@media print{.nav{position:static!important;backdrop-filter:none}.fc-body{flex-direction:column}.rgrid{grid-template-columns:1fr 1fr}.stat-strip{grid-template-columns:repeat(4,1fr)}}
`;

  const findingsCritical = data.findings.filter(f => f.severity === "critical");
  const findingsHigh = data.findings.filter(f => f.severity === "high");
  const allFindings = [...findingsCritical, ...findingsHigh];

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"><title>MysaAI Intelligence Report · ${esc(data.companyName)}</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,600&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<nav class="nav"><div class="nbrand"><div class="nicon">M</div><span class="nname">Mysa<b>AI</b></span></div><div style="display:flex;align-items:center;gap:8px"><span class="pill pp">Intelligence Report</span><span style="font-size:11px;font-weight:600;color:var(--n5)">${esc(date)}</span></div></nav>

<div class="hero"><div class="wrap"><div class="hero-kicker"><div class="hero-kicker-dot"></div>Confidential · ${esc(data.companyName)} · ${esc(data.website ?? "")}</div>
<h1 class="hero-h">You Built Something Real.<br>The World Just<br><span class="rd">Can't Find It Yet.</span></h1>
<p class="hero-intro">MysaAI's Revenue Intelligence Engine ran a <strong>61-point digital audit</strong> on ${esc(data.website || data.companyName)}. We found <strong>${data.criticalCount} critical gaps</strong> that are quietly costing you <span class="rd">${esc(data.hero.monthlyRisk)} every month</span> — not because your work isn't good enough, but because the right people can't see it.</p>
<div class="hero-score-row"><div class="score-block"><div class="score-n">${data.healthScore}</div><div class="score-d">/ 100</div><div class="score-badge">${esc(scoreLabel(data.healthScore))}</div></div>
<div class="score-facts">
<div class="sf-row"><span class="sf-label">Critical Issues</span><span class="sf-val r">${data.criticalCount} Found</span></div>
<div class="sf-row"><span class="sf-label">Monthly Revenue Risk</span><span class="sf-val r">${esc(data.hero.monthlyRisk)}</span></div>
<div class="sf-row"><span class="sf-label">Annual Revenue Risk</span><span class="sf-val a">${esc(data.hero.annualRisk)}</span></div>
<div class="sf-row"><span class="sf-label">Time to Fix Everything</span><span class="sf-val g">${esc(data.hero.fixTimeline)}</span></div>
</div></div>
<div class="stat-strip">
<div class="stat-card"><div class="stat-label">Monthly Risk</div><div class="stat-val r">${esc(data.hero.monthlyRisk)}</div></div>
<div class="stat-card"><div class="stat-label">Annual Risk</div><div class="stat-val r">${esc(data.hero.annualRisk)}</div></div>
<div class="stat-card"><div class="stat-label">Gaps Found</div><div class="stat-val r">${data.criticalCount}</div></div>
<div class="stat-card"><div class="stat-label">Fix Timeline</div><div class="stat-val g">${esc(data.hero.fixTimeline)}</div></div>
</div></div></div>

<div class="hr"></div>

<div class="why-section"><div class="wrap">
<div class="stag">Start With WHY</div>
<h2 class="sh">Before the Data,<br><span class="ac">The Human Truth</span></h2>
<p class="ssub">Every number in this report traces back to one gap. Not in your product. Not in your team. In how clearly your story is being told.</p>
<div class="why-card">
<div class="why-label">The WHY</div>
<div class="why-quote">"${esc(data.why.quote)}"</div>
<div class="why-body">${sanitizeReportHtml(data.why.body)}</div>
<div class="why-tags">
${data.why.negativeTags.map(t => `<span class="pill pr">${esc(t)}</span>`).join("")}
${data.why.positiveTags.map(t => `<span class="pill pg">${esc(t)} ✓</span>`).join("")}
</div></div></div></div>

<div class="hr"></div>

<div class="sec-alt"><div class="wrap">
<div class="stag">The 90-Second Test</div>
<h2 class="sh">What a Prospect Sees<br><span class="ac">Before They Call Anyone</span></h2>
<p class="ssub">A business owner comparing agencies spends 90 seconds per website before forming a shortlist. These 8 signals decide if you make it — or get skipped.</p>
<div class="insight"><div class="insight-icon">💡</div><div class="insight-text"><strong>The uncomfortable truth:</strong> A prospect who has never heard of ${esc(data.companyName)} will judge your capability by your own digital presence. If your website doesn't do what you promise to do for clients — they notice. Every time.</div></div>
<div class="clist">
${data.compare.map(row => `<div class="citem"><div class="cname">${esc(row.name)}</div><div class="crow"><div><div class="ccol-name">${esc(data.companyName)}</div>${bdg(row.company.status, row.company.label)}</div><div><div class="ccol-name">Competitors</div>${bdg(row.competitors.status, row.competitors.label)}</div><div><div class="ccol-name">Industry Standard</div>${bdg(row.industry.status, row.industry.label)}</div></div></div>`).join("")}
</div></div></div>

<div class="hr"></div>

<div class="sec"><div class="wrap">
<div class="stag">Score Breakdown</div>
<h2 class="sh">Overall Score: <span class="rd">${data.healthScore}</span> / 100</h2>
<p class="ssub">Here's how each dimension of your digital presence scored — and where the biggest recovery opportunity sits.</p>
<div class="bars">
${data.categoryScores.map(c => `<div class="bar-item"><div class="bar-top"><span class="bar-lbl">${esc(c.name)}</span><span class="bar-val" style="color:${scoreClr(c.score)}">${c.score} / 10</span></div><div class="bar-track"><div class="bar-fill" style="width:${c.score*10}%;background:${barClr(c.score)}"></div></div></div>`).join("")}
</div></div></div>

<div class="hr"></div>

<div class="sec-alt"><div class="wrap">
<div class="stag">The Price of Inaction</div>
<h2 class="sh">What These Gaps Cost<br><span class="rd">Every Single Month</span></h2>
<p class="ssub">These aren't hypothetical losses. They're calculated against your real traffic, real search volumes, and verified industry conversion benchmarks.</p>
<div class="rev-hero">
<div class="rev-eyebrow">Estimated Monthly Revenue At Risk</div>
<div class="rev-num">${esc(data.hero.monthlyRisk)}</div>
<div class="rev-sub">bleeding out of your pipeline every month</div>
<div class="rev-annual">That's <strong>${esc(data.hero.annualRisk)} per year</strong> that's yours to recover — starting in 30 days.</div>
</div>
<div class="rgrid">
${data.revenueCards.map(c => `<div class="rcard"><div class="rcard-num">${esc(c.amount)}</div><div class="rcard-title">${esc(c.title)}</div><div class="rcard-note">${esc(c.note)}</div></div>`).join("")}
</div></div></div>

<div class="hr"></div>

<div class="sec"><div class="wrap">
<div class="stag">${allFindings.length} Critical Findings</div>
<h2 class="sh">The Gaps, The Cost,<br><span class="ac">The Fix — All of It.</span></h2>
<p class="ssub">Every finding ranked by revenue impact. Every action is specific enough to hand to your team today.</p>
<div class="fc-list">
${allFindings.map(f => `<div class="fc ${f.severity==="critical"?"cr":"hi"}"><div class="fc-head"><div class="fc-num">${esc(f.num)}</div><div class="fc-title-wrap"><div class="fc-title">${esc(f.title)}</div><span class="fc-rev-pill">${esc(f.revenuePill)}</span></div></div><div class="fc-body"><div class="fc-block fi"><div class="fc-block-lbl">What We Found</div><div class="fc-block-text">${esc(f.whatWeFound)}</div></div><div class="fc-block ac"><div class="fc-block-lbl">Exact Fix</div><div class="fc-block-text">${esc(f.exactFix)}</div></div></div></div>`).join("")}
</div></div></div>

<div class="hr"></div>

<div class="sec-alt"><div class="wrap">
<div class="stag">Belief Score</div>
<h2 class="sh">The WHY Behind<br><span class="ac">The Numbers</span></h2>
<p class="ssub">Great businesses are built on belief. This score measures how clearly that belief is transmitted digitally — before a client ever speaks to you.</p>
<div class="belief">
<div class="belief-top">
<div class="belief-score-wrap"><div class="belief-score-num">${data.belief.score}</div><div class="belief-score-of">/ 25</div></div>
<div class="belief-info"><div class="belief-title">${esc(data.belief.title)}</div><span class="pill ${data.belief.pillType==="positive"?"pg":data.belief.pillType==="negative"?"pr":"pa"}">${esc(data.belief.pillLabel)}</span></div>
</div>
<div class="belief-body">
<div class="belief-quote">${esc(data.belief.quote)}</div>
<div class="belief-text">${esc(data.belief.body)}</div>
<div class="sigs">
${data.belief.signals.map(s => `<span class="sig ${s.on?"on":"off"}">${esc(s.label)}</span>`).join("")}
</div></div></div></div></div>

<div class="hr"></div>

<div class="sec"><div class="wrap">
<div class="stag">30-Day Playbook</div>
<h2 class="sh">The Exact Plan,<br><span class="ac">Week by Week</span></h2>
<p class="ssub">Every action is sequenced by impact. Week 1 stops the bleeding. Week 4 builds the compounding advantage.</p>
<div class="week-list">
${data.actionPlan.map(w => `<div class="wk"><div class="wk-head"><div class="wk-num-box" style="background:${wkBg(w.pillType)};color:${wkClr(w.pillType)}">${esc(w.week)}</div><div class="wk-info"><div class="wk-range">${esc(w.range)}</div><div class="wk-title">${esc(w.title)}</div></div><span class="pill ${pillCls(w.pillType)}">${esc(w.pillType.toUpperCase())}</span></div><div class="wk-body">${w.actions.map(a => `<div class="wk-action"><div class="wk-day">${esc(a.day)}</div><div class="wk-text">${sanitizeReportHtml(a.text)}</div></div>`).join("")}</div></div>`).join("")}
</div></div></div>

<div class="hr"></div>

<div class="cta-section"><div class="wrap">
<h2 class="cta-h">Ready to <em>Close the Gap</em>?</h2>
<p class="cta-sub">Every day you wait is a day a competitor gets recommended instead of you. The fixes are clear. The timeline is 30 days. The only question is when you start.</p>
<div class="cta-contact">
<div class="cta-eyebrow">${esc(data.cta.eyebrow)}</div>
<div class="cta-phone">${esc(data.cta.phone)}</div>
<div class="cta-email">${esc(data.cta.email)}</div>
<div class="cta-web">${esc(data.cta.website)}</div>
</div>
<a href="tel:${esc(data.cta.phone)}" class="cta-btn">📞 Book Strategy Call — ${esc(data.cta.phone)}</a>
${data.cta.address ? `<div class="cta-addr">${esc(data.cta.address)}</div>` : ""}
</div></div>

<div class="footer"><div class="wrap">
<div class="footer-brand"><div class="nicon" style="width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,var(--p),var(--p2));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff">M</div><div class="footer-brand-text">Mysa<b>AI</b></div></div>
<div class="footer-why">We believe every business deserves to be found by the clients who need them most. This report is built on that belief.</div>
<div class="footer-disc">This Intelligence Report was generated by MysaAI's Revenue Intelligence Engine. All revenue estimates are based on industry benchmarks and verified conversion data. Actual results may vary based on implementation quality and market conditions.</div>
<div class="footer-copy">© ${new Date().getFullYear()} MysaAI · Confidential · Prepared for ${esc(data.companyName)}</div>
</div></div>
</body></html>`;
}

// ── HTML sanitizer ──────────────────────────────────────────
/**
 * Strips all HTML from an AI-generated string except <strong> and <em> tags.
 * Prevents XSS while preserving the intentional bold/italic formatting that
 * the report prompt explicitly requests from Claude.
 */
export function sanitizeReportHtml(input: string | null | undefined): string {
  if (!input) return "";
  const escaped = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/&lt;(\/?(?:strong|em))&gt;/gi, "<$1>");
}

export function parseIntelReport(aiReport: string | null | undefined): IntelReportData | null {
  if (!aiReport) return null;
  try {
    // Strip markdown code blocks if present
    const cleaned = aiReport.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.v === 2 && parsed.hero && parsed.findings) return parsed as IntelReportData;
    return null;
  } catch {
    return null;
  }
}
