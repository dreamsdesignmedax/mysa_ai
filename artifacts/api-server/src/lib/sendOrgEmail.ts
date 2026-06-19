import nodemailer from "nodemailer";
import { db } from "./db";
import { smtpSettings } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const PLATFORM_GMAIL_USER = process.env["GMAIL_USER"]  ?? "";
const PLATFORM_GMAIL_PASS = process.env["GMAIL_APP_PASSWORD"] ?? "";

export interface OrgEmailOptions {
  to: string;
  toName?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    encoding?: string;
  }>;
}

/**
 * Send an email on behalf of an org.
 *
 * Resolution order:
 *   1. Org's own SMTP (smtp_settings row with host + user + password + fromAddress all set)
 *   2. Platform Gmail fallback (GMAIL_USER / GMAIL_APP_PASSWORD env vars)
 *
 * Returns true on success, false on failure. Never throws.
 */
export async function sendOrgEmail(orgId: number, opts: OrgEmailOptions): Promise<boolean> {
  try {
    const [smtp] = await db.select().from(smtpSettings).where(eq(smtpSettings.orgId, orgId));

    const hasOrgSmtp = !!(smtp?.host && smtp?.user && smtp?.password && smtp?.fromAddress);

    let transporter: nodemailer.Transporter;
    let fromAddress: string;

    if (hasOrgSmtp) {
      transporter = nodemailer.createTransport({
        host:   smtp.host!,
        port:   smtp.port  ?? 587,
        secure: smtp.secure ?? false,
        auth: {
          user: smtp.user!,
          pass: smtp.password!,
        },
      });
      fromAddress = smtp.fromAddress!;
      logger.info({ orgId, fromAddress }, "sendOrgEmail: using org SMTP");
    } else if (PLATFORM_GMAIL_USER && PLATFORM_GMAIL_PASS) {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: PLATFORM_GMAIL_USER, pass: PLATFORM_GMAIL_PASS },
      });
      fromAddress = PLATFORM_GMAIL_USER;
      logger.info({ orgId, fromAddress }, "sendOrgEmail: falling back to platform Gmail");
    } else {
      logger.warn({ orgId }, "sendOrgEmail: no SMTP configured — email skipped");
      return false;
    }

    const toFormatted = opts.toName
      ? `"${opts.toName}" <${opts.to}>`
      : opts.to;

    await transporter.sendMail({
      from:        fromAddress,
      to:          toFormatted,
      cc:          opts.cc?.join(", ") || undefined,
      bcc:         opts.bcc?.join(", ") || undefined,
      replyTo:     opts.replyTo || fromAddress,
      subject:     opts.subject,
      text:        opts.text,
      html:        opts.html,
      attachments: opts.attachments,
    });

    return true;
  } catch (err) {
    logger.error({ err, orgId }, "sendOrgEmail: send failed");
    return false;
  }
}
