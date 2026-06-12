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

const COMPANY = "CloudSheer Consulting";

export const SENDERS: Sender[] = [
  {
    name: "Shubham",
    email: "shubham@cloudsheer.com",
    mailingAddress: "CloudSheer Consulting, 6614 Avenue U, #1019, Brooklyn, New York 11234, USA",
    signature: `Regards,\nShubham\n${COMPANY}`,
  },
  {
    name: "Bharat",
    email: "bharat@cloudsheer.com",
    mailingAddress: "CloudSheer Consulting, 6614 Avenue U, #1019, Brooklyn, New York 11234, USA",
    signature: `Regards,\nBharat\n${COMPANY}`,
  },
  {
    name: "Tushar",
    email: "tushar@cloudsheer.com",
    mailingAddress: "CloudSheer Consulting, 6614 Avenue U, #1019, Brooklyn, New York 11234, USA",
    signature: `Regards,\nTushar\n${COMPANY}`,
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
