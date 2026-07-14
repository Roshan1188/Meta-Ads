import "server-only";

export const isEmailConfigured = Boolean(process.env.RESEND_API_KEY);

export type EmailResult = { sent: boolean; skipped?: string; id?: string };

/**
 * Resend over REST. Returns rather than throws on a missing key: a report that can't
 * be emailed should still be generated and readable in the app.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<EmailResult> {
  if (!isEmailConfigured) {
    return { sent: false, skipped: "RESEND_API_KEY is not set." };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from ?? process.env.REPORT_FROM_EMAIL ?? "reports@autoads.ai",
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend rejected the email (${res.status}): ${body}`);
  }

  const { id } = (await res.json()) as { id: string };
  return { sent: true, id };
}
