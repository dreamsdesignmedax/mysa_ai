/**
 * Returns the canonical base URL for the application.
 *
 * Priority order:
 *  1. APP_BASE_URL           – manual override (custom domain, staging, etc.)
 *  2. REPLIT_DOMAINS         – set automatically by Replit in the PRODUCTION deployment
 *                              (e.g. "myapp.replit.app" or a custom domain)
 *  3. REPLIT_DEV_DOMAIN      – set automatically in the Replit dev workspace
 *  4. localhost:8080         – final fallback for bare local runs
 *
 * This means emails sent from the live deployed app will always contain
 * correct production URLs, not dev workspace URLs.
 */
export function getAppBaseUrl(): string {
  if (process.env["APP_BASE_URL"]) {
    return process.env["APP_BASE_URL"].replace(/\/$/, "");
  }

  const replitDomains = process.env["REPLIT_DOMAINS"];
  if (replitDomains) {
    const primary = replitDomains.split(",")[0]?.trim();
    if (primary) return `https://${primary}`;
  }

  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;

  return "http://localhost:8080";
}
