import "server-only";

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notify/email";
import { sendTemplate } from "@/lib/notify/whatsapp";
import { APP_NAME } from "@/lib/constants";

/**
 * Client reports. One HTML body is generated and stored, then reused by the web view
 * and the email — so what the client reads and what the agency sees can never drift.
 *
 * Numbers come from our own `Metric` snapshots, not a live Meta call, so a report is
 * reproducible after the fact and doesn't break when a token expires.
 */

export type ReportSummary = {
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number | null;
  campaigns: number;
};

export const WHATSAPP_TEMPLATE =
  process.env.WHATSAPP_REPORT_TEMPLATE ?? "ad_performance_report";

export async function buildReport(clientId: string, days = 7) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - days);

  const client = await db.client.findUnique({
    where: { id: clientId },
    include: {
      agency: true,
      campaigns: {
        include: { metrics: { where: { date: { gte: periodStart, lte: periodEnd } } } },
      },
    },
  });
  if (!client) throw new Error("Client not found.");

  const rows = client.campaigns.map((campaign) => {
    const totals = campaign.metrics.reduce(
      (acc, metric) => ({
        spend: acc.spend + metric.spend,
        impressions: acc.impressions + metric.impressions,
        clicks: acc.clicks + metric.clicks,
        leads: acc.leads + (metric.cpl ? Math.round(metric.spend / metric.cpl) : 0),
      }),
      { spend: 0, impressions: 0, clicks: 0, leads: 0 },
    );

    return { name: campaign.name, status: campaign.status, ...totals };
  });

  const summary = totalise(rows);

  const html = render({
    clientName: client.name,
    agencyName: client.agency.reportHeader ?? client.agency.name ?? APP_NAME,
    brandColor: client.agency.brandColor ?? "#1E5631",
    logoUrl: client.agency.logoUrl,
    periodStart,
    periodEnd,
    rows,
    summary,
  });

  return db.report.create({
    data: {
      clientId: client.id,
      periodStart,
      periodEnd,
      html,
      summary,
    },
  });
}

/** Email and WhatsApp are independent: one failing must not suppress the other. */
export async function deliverReport(reportId: string) {
  const report = await db.report.findUnique({
    where: { id: reportId },
    include: { client: { include: { agency: true } } },
  });
  if (!report) throw new Error("Report not found.");

  const { client } = report;
  const errors: string[] = [];
  let emailedAt: Date | null = null;
  let whatsappAt: Date | null = null;

  if (client.contactEmail) {
    try {
      const result = await sendEmail({
        to: client.contactEmail,
        subject: `${client.name} — ad performance, last 7 days`,
        html: report.html,
      });
      if (result.sent) emailedAt = new Date();
      else if (result.skipped) errors.push(`Email skipped: ${result.skipped}`);
    } catch (error) {
      errors.push(`Email failed: ${message(error)}`);
    }
  }

  if (client.contactPhone) {
    try {
      const summary = report.summary as unknown as ReportSummary;
      const result = await sendTemplate({
        to: client.contactPhone,
        template: WHATSAPP_TEMPLATE,
        variables: [
          client.name,
          `₹${Math.round(summary.spend).toLocaleString("en-IN")}`,
          summary.clicks.toLocaleString("en-IN"),
          summary.leads.toLocaleString("en-IN"),
        ],
      });
      if (result.sent) whatsappAt = new Date();
      else if (result.skipped) errors.push(`WhatsApp skipped: ${result.skipped}`);
    } catch (error) {
      errors.push(`WhatsApp failed: ${message(error)}`);
    }
  }

  return db.report.update({
    where: { id: report.id },
    data: {
      emailedAt,
      whatsappAt,
      deliveryError: errors.length > 0 ? errors.join(" ") : null,
    },
  });
}

type Row = {
  name: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
};

function totalise(rows: Row[]): ReportSummary {
  const spend = sum(rows, "spend");
  const impressions = sum(rows, "impressions");
  const clicks = sum(rows, "clicks");
  const leads = sum(rows, "leads");

  return {
    spend,
    impressions,
    clicks,
    leads,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpl: leads > 0 ? spend / leads : null,
    campaigns: rows.length,
  };
}

const sum = (rows: Row[], key: keyof Row) =>
  rows.reduce((total, row) => total + (row[key] as number), 0);

/**
 * Inline styles only, and no external assets: every email client strips <style>
 * blocks, and half of them block remote CSS outright.
 */
function render(input: {
  clientName: string;
  agencyName: string;
  brandColor: string;
  logoUrl: string | null;
  periodStart: Date;
  periodEnd: Date;
  rows: Row[];
  summary: ReportSummary;
}): string {
  const date = (value: Date) =>
    value.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

  const money = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
  const num = (value: number) => value.toLocaleString("en-IN");

  const stat = (label: string, value: string) => `
    <td style="padding:12px 16px;background:#f6f7f6;border-radius:8px;">
      <div style="font-size:12px;color:#5b6560;">${escape(label)}</div>
      <div style="font-size:20px;font-weight:600;color:#14211a;">${escape(value)}</div>
    </td>`;

  const rows = input.rows.length
    ? input.rows
        .map(
          (row) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;">${escape(row.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;color:#5b6560;">${escape(row.status)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;text-align:right;">${money(row.spend)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;text-align:right;">${num(row.impressions)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;text-align:right;">${num(row.clicks)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e6e9e7;text-align:right;">${num(row.leads)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" style="padding:20px 12px;color:#5b6560;">No delivery in this period.</td></tr>`;

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;color:#14211a;">
  <div style="background:${escape(input.brandColor)};color:#fff;padding:24px;border-radius:12px 12px 0 0;">
    ${
      input.logoUrl
        ? `<img src="${escape(input.logoUrl)}" alt="${escape(input.agencyName)}" style="max-height:32px;margin-bottom:8px;" />`
        : `<div style="font-weight:600;opacity:.85;">${escape(input.agencyName)}</div>`
    }
    <h1 style="margin:6px 0 0;font-size:22px;">${escape(input.clientName)}</h1>
    <div style="opacity:.85;font-size:13px;">Ad performance · ${date(input.periodStart)} – ${date(input.periodEnd)}</div>
  </div>

  <div style="border:1px solid #e6e9e7;border-top:0;border-radius:0 0 12px 12px;padding:20px;">
    <table role="presentation" style="width:100%;border-spacing:8px 0;margin-bottom:20px;">
      <tr>
        ${stat("Spend", money(input.summary.spend))}
        ${stat("Clicks", num(input.summary.clicks))}
        ${stat("Leads", num(input.summary.leads))}
        ${stat("Cost / lead", input.summary.cpl ? money(input.summary.cpl) : "—")}
      </tr>
    </table>

    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="text-align:left;color:#5b6560;font-size:12px;">
          <th style="padding:8px 12px;">Campaign</th>
          <th style="padding:8px 12px;">Status</th>
          <th style="padding:8px 12px;text-align:right;">Spend</th>
          <th style="padding:8px 12px;text-align:right;">Impr.</th>
          <th style="padding:8px 12px;text-align:right;">Clicks</th>
          <th style="padding:8px 12px;text-align:right;">Leads</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="color:#5b6560;font-size:12px;margin-top:20px;">
      CTR ${input.summary.ctr.toFixed(2)}% · CPC ${money(input.summary.cpc)} ·
      Prepared by ${escape(input.agencyName)}.
    </p>
  </div>
</div>`;
}

/** Client names come from a scraped website, so they are not trusted markup. */
function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";
