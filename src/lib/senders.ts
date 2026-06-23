/**
 * Per-sender configuration. Each mailbox we send from has its own display
 * name, reply-to (always its own address), and physical postal address that
 * goes in the email footer (CAN-SPAM requires a real address per sender).
 *
 * Edit the `mailingAddress` values below with each person's real postal
 * address before sending. The bracketed placeholders are deliberately
 * obvious so an unfilled one is caught in review.
 */
export type Sender = {
  name: string;
  email: string;
  mailingAddress: string;
  signature: string;
};

const COMPANY = "Cloudsheer Consulting";

/**
 * Domains whose signed-in users may send from their own Gmail mailbox through
 * this tool (in addition to the preset SENDERS below). Each domain's mailboxes
 * must be Google Workspace accounts that can grant the gmail.send scope.
 *
 * Configured via the ALLOWED_SENDER_DOMAINS env var (comma-separated) so new
 * domains can be added in Vercel without a code change. Set it to "*" to allow
 * any signed-in account to send from its own mailbox - safe only because Google
 * OAuth (the "Internal" consent screen) already limits who can sign in at all.
 */
const DEFAULT_SENDER_DOMAINS = ["getcloudsheer.com"];

export function allowedSenderDomains(): string[] {
  const raw = process.env.ALLOWED_SENDER_DOMAINS?.trim();
  if (!raw) return DEFAULT_SENDER_DOMAINS;
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** True when a signed-in address is allowed to send from its own mailbox. */
export function isAllowedSenderEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domains = allowedSenderDomains();
  if (domains.includes("*")) return true; // trust whoever OAuth let sign in
  return domains.includes(email.slice(at + 1).toLowerCase());
}

const ADDRESS =
  "Cloudsheer Consulting, 6614 Avenue U, #1019, Brooklyn, New York 11234, USA";

export const SENDERS: Sender[] = [
  {
    name: "Adrian Stanley",
    email: "adrian@getcloudsheer.com",
    mailingAddress: ADDRESS,
    signature: `Regards,\nAdrian\n${COMPANY}`,
  },
  {
    name: "Brittney Marshall",
    email: "brittney@getcloudsheer.com",
    mailingAddress: ADDRESS,
    signature: `Regards,\nBrittney\n${COMPANY}`,
  },
  {
    name: "Lauren Bailey",
    email: "lauren@getcloudsheer.com",
    mailingAddress: ADDRESS,
    signature: `Regards,\nLauren\n${COMPANY}`,
  },
  {
    name: "Nicholas Guerrant",
    email: "nicholas@getcloudsheer.com",
    mailingAddress: ADDRESS,
    signature: `Regards,\nNicholas\n${COMPANY}`,
  },
];

/** Default sender when a campaign has no fromAddress (replaces RESEND_FROM). */
export const DEFAULT_FROM_ADDRESS = `${SENDERS[0].name} <${SENDERS[0].email}>`;

/** Display name out of a "Name <email>" or plain address (empty if none). */
export function nameFromAddress(fromAddress: string | null | undefined): string {
  if (!fromAddress) return "";
  const lt = fromAddress.indexOf("<");
  return lt > 0 ? fromAddress.slice(0, lt).trim() : "";
}

/** A generic sign-off for a custom sender with no configured signature. */
export function defaultSignatureFor(name: string): string {
  return name ? `Regards,\n${name}\n${COMPANY}` : `Regards,\n${COMPANY}`;
}

/** Pulls the bare email out of a "Name <email@domain>" or plain address. */
export function emailFromAddress(fromAddress: string): string {
  const match = fromAddress.match(/<([^>]+)>/);
  return (match ? match[1] : fromAddress).trim().toLowerCase();
}

export function getSender(fromAddress: string | null | undefined): Sender | null {
  if (!fromAddress) return null;
  const email = emailFromAddress(fromAddress);
  return SENDERS.find((s) => s.email.toLowerCase() === email) ?? null;
}

/**
 * Signature to append for a given From address: the configured one for a known
 * sender, otherwise a generic sign-off built from the From display name.
 */
export function signatureFor(fromAddress: string | null | undefined): string {
  return (
    getSender(fromAddress)?.signature ??
    defaultSignatureFor(nameFromAddress(fromAddress))
  );
}
