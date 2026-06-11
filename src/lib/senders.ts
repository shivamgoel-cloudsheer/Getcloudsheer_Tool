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
    mailingAddress: "CloudSheer Consulting, [STREET ADDRESS], Brooklyn, NY [ZIP], USA",
    signature: `Regards,\nShubham\n${COMPANY}`,
  },
  {
    name: "Bharat",
    email: "bharat@cloudsheer.com",
    mailingAddress: "CloudSheer Consulting, [STREET ADDRESS], Brooklyn, NY [ZIP], USA",
    signature: `Regards,\nBharat\n${COMPANY}`,
  },
  {
    name: "Tushar",
    email: "tushar@cloudsheer.com",
    mailingAddress: "CloudSheer Consulting, [STREET ADDRESS], Brooklyn, NY [ZIP], USA",
    signature: `Regards,\nTushar\n${COMPANY}`,
  },
];

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

/** Fallback address for the default RESEND_FROM sender (set MAILING_ADDRESS to override). */
const DEFAULT_MAILING_ADDRESS =
  process.env.MAILING_ADDRESS ??
  "CloudSheer Consulting, [STREET ADDRESS], Brooklyn, NY [ZIP], USA";

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

/** Postal address to print in the footer for a given From address. */
export function mailingAddressFor(fromAddress: string | null | undefined): string {
  return getSender(fromAddress)?.mailingAddress ?? DEFAULT_MAILING_ADDRESS;
}

/**
 * Reply-To for a send: the address the email was sent from, so replies land
 * in that sender's own mailbox. Falls back to the global From when unknown.
 */
export function replyToFor(fromAddress: string | null | undefined): string {
  return fromAddress?.trim() || process.env.RESEND_FROM!;
}

/** mailto: target for the List-Unsubscribe header, pointed at the sender. */
export function unsubscribeMailtoFor(fromAddress: string | null | undefined): string {
  const email = fromAddress
    ? emailFromAddress(fromAddress)
    : emailFromAddress(process.env.RESEND_FROM ?? "unsubscribe@cloudsheer.com");
  return `mailto:${email}?subject=unsubscribe`;
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
