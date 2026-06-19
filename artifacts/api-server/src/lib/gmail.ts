import nodemailer from "nodemailer";
import { logger } from "./logger";

const GMAIL_USER = process.env["GMAIL_USER"]  ?? "";
const GMAIL_PASS = process.env["GMAIL_APP_PASSWORD"] ?? "";
const FROM_NAME  = "Krishna Puranik | Dreamsdesign";

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

export async function sendGmailEmail(opts: {
  to: string;
  toName?: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  if (!GMAIL_USER || !GMAIL_PASS) {
    logger.warn("Gmail not configured — GMAIL_USER/GMAIL_APP_PASSWORD missing");
    return false;
  }
  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from:    `"${FROM_NAME}" <${GMAIL_USER}>`,
      to:      opts.toName ? `"${opts.toName}" <${opts.to}>` : opts.to,
      subject: opts.subject,
      text:    opts.text,
    });
    return true;
  } catch (err) {
    logger.error({ err }, "Gmail send failed");
    return false;
  }
}
