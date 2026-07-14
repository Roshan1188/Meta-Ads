import "server-only";

import { META_API_VERSION } from "@/lib/meta/client";

export const isWhatsappConfigured = Boolean(
  process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
);

export type WhatsappResult = { sent: boolean; skipped?: string; id?: string };

/**
 * WhatsApp Cloud API.
 *
 * Business-initiated messages outside a 24-hour customer service window MUST use a
 * pre-approved template — a plain text body is silently rejected. A scheduled report
 * is always business-initiated, so `sendTemplate` is the one to use for reports;
 * `sendText` only works if the client messaged you recently.
 */
export async function sendTemplate(input: {
  to: string;
  /** The template's name as approved in WhatsApp Manager. */
  template: string;
  languageCode?: string;
  /** Substituted into the template's {{1}}, {{2}}, … placeholders, in order. */
  variables: string[];
}): Promise<WhatsappResult> {
  if (!isWhatsappConfigured) {
    return {
      sent: false,
      skipped: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not set.",
    };
  }

  return post({
    messaging_product: "whatsapp",
    to: normalise(input.to),
    type: "template",
    template: {
      name: input.template,
      language: { code: input.languageCode ?? "en" },
      components: input.variables.length
        ? [
            {
              type: "body",
              parameters: input.variables.map((text) => ({ type: "text", text })),
            },
          ]
        : [],
    },
  });
}

async function post(body: unknown): Promise<WhatsappResult> {
  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WhatsApp rejected the message (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { messages?: { id: string }[] };
  return { sent: true, id: json.messages?.[0]?.id };
}

/** WhatsApp wants digits only, with country code and no leading +. */
function normalise(phone: string): string {
  return phone.replace(/\D/g, "");
}
