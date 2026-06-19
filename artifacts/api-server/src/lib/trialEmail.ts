import { sendViaBrevo } from "./brevo";

export async function sendWelcomeEmail(email: string, firstName: string, trialEndsAt: Date): Promise<void> {
  const trialEndStr = trialEndsAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  await sendViaBrevo({
    to: [{ email, name: firstName }],
    subject: "Welcome to MysaAI — your 7-day trial has started 🚀",
    htmlContent: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;background:#ffffff;">
        <div style="margin-bottom:24px;">
          <div style="width:48px;height:48px;background:#1A3D2B;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="color:#fff;font-size:22px;font-weight:700;">M</span>
          </div>
          <h2 style="color:#111827;margin:0 0 6px 0;font-size:22px;font-weight:800;">Welcome to MysaAI, ${firstName}!</h2>
          <p style="color:#6B7280;margin:0;font-size:14px;">Your free trial is active until <strong>${trialEndStr}</strong>.</p>
        </div>

        <p style="color:#374151;line-height:1.6;font-size:14px;margin:0 0 20px 0;">
          You now have full access to MysaAI's B2B sales OS. Here are the three best places to start:
        </p>

        <!-- Top 3 things to try -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
          <tr>
            <td style="padding:0 0 12px 0;">
              <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:16px;">
                <div style="font-size:20px;margin-bottom:6px;">🔍</div>
                <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:4px;">1. Run a Brand Audit</div>
                <div style="font-size:13px;color:#374151;line-height:1.5;">Paste any prospect's website and get a full score on their brand, messaging, and trust signals in under 60 seconds.</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 12px 0;">
              <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:16px;">
                <div style="font-size:20px;margin-bottom:6px;">✉️</div>
                <div style="font-size:14px;font-weight:700;color:#1E40AF;margin-bottom:4px;">2. Generate AI Outreach</div>
                <div style="font-size:13px;color:#374151;line-height:1.5;">Add a lead and let MysaAI write a personalised cold email sequence based on their business context and audit findings.</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 0 0;">
              <div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;padding:16px;">
                <div style="font-size:20px;margin-bottom:6px;">📊</div>
                <div style="font-size:14px;font-weight:700;color:#9A3412;margin-bottom:4px;">3. Score Your Leads with BANT+B</div>
                <div style="font-size:13px;color:#374151;line-height:1.5;">Use our BANT + Belief scoring model to instantly prioritise which prospects deserve your attention first.</div>
              </div>
            </td>
          </tr>
        </table>

        <div style="text-align:center;margin:0 0 24px 0;">
          <a href="https://mysaai.app/v1" style="display:inline-block;padding:14px 32px;background:#1A3D2B;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Open MysaAI →</a>
        </div>

        <p style="color:#6B7280;font-size:13px;line-height:1.6;">
          Questions? Just reply to this email — we read every message.
        </p>
        <p style="color:#6B7280;font-size:13px;">— The MysaAI Team</p>
        <hr style="border:none;border-top:1px solid #F3F4F6;margin:24px 0;" />
        <p style="color:#D1D5DB;font-size:11px;">You're receiving this because you just signed up for a MysaAI trial. <a href="https://mysaai.app/unsubscribe" style="color:#D1D5DB;">Unsubscribe</a></p>
      </div>
    `,
    textContent: `Welcome to MysaAI, ${firstName}!\n\nYour 7-day free trial is active until ${trialEndStr}.\n\nTop 3 things to try:\n1. Run a Brand Audit — score any prospect's website in 60 seconds\n2. Generate AI Outreach — personalised cold email sequences\n3. Score leads with BANT+B — prioritise your pipeline instantly\n\nGet started at https://mysaai.app/v1\n\n— The MysaAI Team`,
  });
}

export async function sendTrialNudgeEmail(email: string, name: string, leadsCount?: number): Promise<void> {
  const leadNote = leadsCount && leadsCount > 0
    ? `You have <strong>${leadsCount}</strong> leads and audits ready to work with — upgrade to keep the momentum going.`
    : "Everything you've set up is waiting for you — upgrade to keep the momentum going.";

  await sendViaBrevo({
    to: [{ email, name }],
    subject: "Your MysaAI trial ends in 2 days — don't lose your data",
    htmlContent: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;background:#ffffff;">
        <div style="margin-bottom:20px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#F59E0B,#D97706);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="color:#fff;font-size:22px;">⏳</span>
          </div>
          <h2 style="color:#111827;margin:0 0 6px 0;font-size:22px;font-weight:800;">2 days left in your trial</h2>
          <p style="color:#374151;margin:0;font-size:14px;">Hi ${name},</p>
        </div>

        <p style="color:#374151;line-height:1.6;font-size:14px;margin:0 0 12px 0;">${leadNote}</p>
        <p style="color:#374151;line-height:1.6;font-size:14px;margin:0 0 20px 0;">Pick a plan now and keep your full pipeline, brand audits, AI outreach, and WhatsApp conversations intact.</p>

        <!-- Urgency banner -->
        <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:14px 16px;margin:0 0 24px 0;">
          <p style="color:#92400E;font-size:13px;font-weight:700;margin:0 0 4px 0;">⚡ Act before your trial ends</p>
          <p style="color:#78350F;font-size:12px;margin:0;line-height:1.5;">After your trial expires your data is held for 30 days, then permanently deleted if you haven't upgraded.</p>
        </div>

        <!-- Plan cards -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
          <tr>
            <td width="32%" style="padding-right:8px;">
              <div style="border:2px solid #E5E7EB;border-radius:10px;padding:14px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#374151;">Solo</div>
                <div style="font-size:18px;font-weight:900;color:#111827;margin:4px 0 2px 0;">₹2,499<span style="font-size:10px;font-weight:400;color:#9CA3AF;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">1 user · 300 leads<br/>30 audits/mo</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#F3F4F6;color:#374151;border-radius:6px;text-decoration:none;font-weight:600;font-size:11px;text-align:center;">Choose Solo</a>
              </div>
            </td>
            <td width="36%" style="padding:0 4px;">
              <div style="border:2px solid #7C3AED;border-radius:10px;padding:14px;text-align:left;background:#F5F3FF;">
                <div style="font-size:10px;font-weight:700;color:#7C3AED;background:#EDE9FE;display:inline-block;padding:2px 8px;border-radius:99px;margin-bottom:4px;">Most Popular</div>
                <div style="font-size:12px;font-weight:700;color:#7C3AED;">Growth</div>
                <div style="font-size:18px;font-weight:900;color:#7C3AED;margin:4px 0 2px 0;">₹6,999<span style="font-size:10px;font-weight:400;color:#A78BFA;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">5 users · 2,000 leads<br/>150 audits · Autopilot</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#7C3AED;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">Choose Growth</a>
              </div>
            </td>
            <td width="32%" style="padding-left:8px;">
              <div style="border:2px solid #E5E7EB;border-radius:10px;padding:14px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#374151;">Agency</div>
                <div style="font-size:18px;font-weight:900;color:#111827;margin:4px 0 2px 0;">₹14,999<span style="font-size:10px;font-weight:400;color:#9CA3AF;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">Unlimited users<br/>All features + White-label</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#F3F4F6;color:#374151;border-radius:6px;text-decoration:none;font-weight:600;font-size:11px;text-align:center;">Choose Agency</a>
              </div>
            </td>
          </tr>
        </table>

        <div style="text-align:center;margin:0 0 20px 0;">
          <a href="https://mysaai.app/billing" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#F59E0B,#D97706);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Choose a Plan →</a>
        </div>

        <p style="color:#6B7280;font-size:13px;line-height:1.6;">Questions? Reply to this email and we'll help you pick the right plan.</p>
        <p style="color:#6B7280;font-size:13px;">— The MysaAI Team</p>
        <hr style="border:none;border-top:1px solid #F3F4F6;margin:24px 0;" />
        <p style="color:#D1D5DB;font-size:11px;">You're receiving this because your MysaAI trial is ending soon. <a href="https://mysaai.app/unsubscribe" style="color:#D1D5DB;">Unsubscribe</a></p>
      </div>
    `,
    textContent: `Hi ${name},\n\nYour MysaAI free trial ends in 2 days. Upgrade now to keep your leads, audits, and pipeline data.\n\nChoose a plan at https://mysaai.app/billing\n\n— The MysaAI Team`,
  });
}

export async function sendTrialExpiredEmail(email: string, name: string, leadsCount?: number): Promise<void> {
  const leadNote = leadsCount && leadsCount > 0
    ? `You have <strong>${leadsCount}</strong> leads saved — upgrade to keep working with them.`
    : "All your leads, audits, and data are safe and waiting for you when you upgrade.";

  await sendViaBrevo({
    to: [{ email, name }],
    subject: "Your MysaAI free trial has ended — choose a plan to continue",
    htmlContent: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:32px 24px;background:#ffffff;">
        <div style="margin-bottom:20px;">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#4F35A8,#7C3AED);border-radius:12px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="color:#fff;font-size:22px;">⚡</span>
          </div>
          <h2 style="color:#111827;margin:0 0 6px 0;font-size:22px;font-weight:800;">Your free trial has ended</h2>
          <p style="color:#374151;margin:0;font-size:14px;">Hi ${name},</p>
        </div>

        <p style="color:#374151;line-height:1.6;font-size:14px;margin:0 0 12px 0;">${leadNote}</p>
        <p style="color:#374151;line-height:1.6;font-size:14px;margin:0 0 20px 0;">Upgrade to restore full access — lead management, brand audits, AI outreach, and your entire pipeline are waiting.</p>

        <!-- 30-day data warning -->
        <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:10px;padding:14px 16px;margin:0 0 24px 0;">
          <p style="color:#B91C1C;font-size:13px;font-weight:700;margin:0 0 4px 0;">⚠️ Important: Your data is held for 30 days</p>
          <p style="color:#991B1B;font-size:12px;margin:0;line-height:1.5;">If you don't upgrade within 30 days of your trial ending, your leads, audits, and pipeline data will be permanently deleted. Upgrade now to keep everything safe.</p>
        </div>

        <!-- Plan cards -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
          <tr>
            <td width="32%" style="padding-right:8px;">
              <div style="border:2px solid #E5E7EB;border-radius:10px;padding:14px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#374151;">Solo</div>
                <div style="font-size:18px;font-weight:900;color:#111827;margin:4px 0 2px 0;">₹2,499<span style="font-size:10px;font-weight:400;color:#9CA3AF;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">1 user · 300 leads<br/>30 audits/mo</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#F3F4F6;color:#374151;border-radius:6px;text-decoration:none;font-weight:600;font-size:11px;text-align:center;">Choose Solo</a>
              </div>
            </td>
            <td width="36%" style="padding:0 4px;">
              <div style="border:2px solid #7C3AED;border-radius:10px;padding:14px;text-align:left;background:#F5F3FF;">
                <div style="font-size:10px;font-weight:700;color:#7C3AED;background:#EDE9FE;display:inline-block;padding:2px 8px;border-radius:99px;margin-bottom:4px;">Most Popular</div>
                <div style="font-size:12px;font-weight:700;color:#7C3AED;">Growth</div>
                <div style="font-size:18px;font-weight:900;color:#7C3AED;margin:4px 0 2px 0;">₹6,999<span style="font-size:10px;font-weight:400;color:#A78BFA;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">5 users · 2,000 leads<br/>150 audits · Autopilot</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#7C3AED;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:11px;text-align:center;">Choose Growth</a>
              </div>
            </td>
            <td width="32%" style="padding-left:8px;">
              <div style="border:2px solid #E5E7EB;border-radius:10px;padding:14px;text-align:left;">
                <div style="font-size:12px;font-weight:700;color:#374151;">Agency</div>
                <div style="font-size:18px;font-weight:900;color:#111827;margin:4px 0 2px 0;">₹14,999<span style="font-size:10px;font-weight:400;color:#9CA3AF;">/mo</span></div>
                <div style="font-size:10px;color:#6B7280;line-height:1.4;">Unlimited users<br/>All features + White-label</div>
                <a href="https://mysaai.app/billing" style="display:block;margin-top:10px;padding:8px 0;background:#F3F4F6;color:#374151;border-radius:6px;text-decoration:none;font-weight:600;font-size:11px;text-align:center;">Choose Agency</a>
              </div>
            </td>
          </tr>
        </table>

        <div style="text-align:center;margin:0 0 20px 0;">
          <a href="https://mysaai.app/billing" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#4F35A8,#7C3AED);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">View All Plans →</a>
        </div>

        <p style="color:#6B7280;font-size:13px;line-height:1.6;">Questions? Reply to this email and we'll help you pick the right plan.</p>
        <p style="color:#6B7280;font-size:13px;">— The MysaAI Team</p>
        <hr style="border:none;border-top:1px solid #F3F4F6;margin:24px 0;" />
        <p style="color:#D1D5DB;font-size:11px;">You're receiving this because your MysaAI trial has expired. <a href="https://mysaai.app/unsubscribe" style="color:#D1D5DB;">Unsubscribe</a></p>
      </div>
    `,
  });
}
