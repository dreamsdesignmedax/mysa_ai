import nodemailer from "nodemailer";
import { getAppBaseUrl } from "./app-url";

const SENDER_NAME = "Dreamsdesign";
const REPLY_TO    = "sales.dreamsdesign.in@gmail.com";

export interface BrevoRecipient {
  email: string;
  name?: string;
}

export interface BrevoAttachment {
  name: string;
  content: string;
  isBase64?: boolean;
}

export interface BrevoSendOptions {
  senderName?: string;
  senderEmail?: string;
  to: BrevoRecipient[];
  cc?: BrevoRecipient[];
  bcc?: BrevoRecipient[];
  replyTo?: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachments?: BrevoAttachment[];
  trackingId?: string;
}

export async function sendViaBrevo(opts: BrevoSendOptions): Promise<void> {
  const gmailUser = process.env["GMAIL_USER"];
  const gmailPass = process.env["GMAIL_APP_PASSWORD"];

  if (!gmailUser || !gmailPass) {
    throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are not configured");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
  });

  const toAddresses = opts.to
    .map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email))
    .join(", ");

  const ccAddresses  = opts.cc?.map((r) => (r.name ? `"${r.name}" <${r.email}>` : r.email)).join(", ");
  const bccAddresses = opts.bcc?.map((r) => r.email).join(", ");

  const attachments = opts.attachments?.map((a) => ({
    filename: a.name,
    content: a.isBase64
      ? Buffer.from(a.content, "base64")
      : Buffer.from(a.content),
    encoding: a.isBase64 ? undefined : "utf8",
  }));

  let html = opts.htmlContent;
  if (opts.trackingId) {
    const baseUrl = getAppBaseUrl();
    const pixelUrl = `${baseUrl}/api/track/open/${opts.trackingId}`;
    html = html + `<img src="${pixelUrl}" width="1" height="1" style="display:none;border:0" alt="" />`;
  }

  await transporter.sendMail({
    from: `"${SENDER_NAME}" <${gmailUser}>`,
    to: toAddresses,
    cc: ccAddresses || undefined,
    bcc: bccAddresses,
    replyTo: REPLY_TO,
    subject: opts.subject,
    html,
    text: opts.textContent,
    attachments: attachments?.length ? attachments : undefined,
  });
}
