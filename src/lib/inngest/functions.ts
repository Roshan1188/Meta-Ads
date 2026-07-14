import { inngest } from "./client";
import { db } from "@/lib/db";
import { optimiseClient, syncClientMetrics } from "@/server/optimize";
import { buildReport, deliverReport } from "@/server/reports";
import { detectAnomalies, runSchedule } from "@/server/schedule";
import { sendEmail } from "@/lib/notify/email";

/** Health check — lets `npx inngest-cli dev` prove the wiring without touching Meta. */
export const healthcheck = inngest.createFunction(
  { id: "healthcheck", triggers: [{ event: "app/healthcheck" }] },
  async ({ event }) => ({ ok: true, receivedAt: event.ts }),
);

/**
 * Nightly fan-out at 03:00 UTC — after Meta has finalised the previous day, before
 * the Indian ad day gets going.
 *
 * The cron only fans out; each client runs as its own function so one agency's expired
 * Meta token can't stop everyone else's optimisation.
 */
export const nightlyOptimisation = inngest.createFunction(
  { id: "nightly-optimisation", triggers: [{ cron: "0 3 * * *" }] },
  async ({ step }) => {
    const clients = await step.run("find-live-clients", () =>
      db.client.findMany({
        where: { campaigns: { some: { status: "ACTIVE" } } },
        select: { id: true },
      }),
    );

    await Promise.all(
      clients.map((client) =>
        step.sendEvent(`optimise-${client.id}`, {
          name: "client/optimise",
          data: { clientId: client.id },
        }),
      ),
    );

    return { clients: clients.length };
  },
);

export const optimiseClientJob = inngest.createFunction(
  {
    id: "optimise-client",
    triggers: [{ event: "client/optimise" }],
    retries: 2,
    // One run per client at a time — two concurrent runs could each raise the same
    // budget by 20% and blow straight through the daily cap.
    concurrency: { key: "event.data.clientId", limit: 1 },
  },
  async ({ event, step }) => {
    const { clientId } = event.data as { clientId: string };

    const synced = await step.run("sync-metrics", () => syncClientMetrics(clientId));
    const result = await step.run("apply-rules", () => optimiseClient(clientId));

    return { ...synced, ...result };
  },
);

/**
 * Scheduled campaign start/stop, hourly. Ad delivery ramps over hours anyway, so
 * minute-level precision would cost far more than it's worth.
 */
export const campaignScheduler = inngest.createFunction(
  { id: "campaign-scheduler", triggers: [{ cron: "0 * * * *" }] },
  async () => runSchedule(),
);

/** Weekly client reports — Monday 04:00 UTC (≈09:30 IST). */
export const weeklyReports = inngest.createFunction(
  { id: "weekly-reports", triggers: [{ cron: "0 4 * * 1" }] },
  async ({ step }) => {
    const clients = await step.run("find-reportable-clients", () =>
      db.client.findMany({
        where: { reportsEnabled: true, campaigns: { some: { metaCampaignId: { not: null } } } },
        select: { id: true },
      }),
    );

    await Promise.all(
      clients.map((client) =>
        step.sendEvent(`report-${client.id}`, {
          name: "client/report",
          data: { clientId: client.id },
        }),
      ),
    );

    return { clients: clients.length };
  },
);

export const clientReportJob = inngest.createFunction(
  { id: "client-report", triggers: [{ event: "client/report" }], retries: 2 },
  async ({ event, step }) => {
    const { clientId } = event.data as { clientId: string };

    const report = await step.run("build", () => buildReport(clientId));
    // Delivery is a separate step so a WhatsApp outage retries the send without
    // regenerating (and re-storing) the whole report.
    await step.run("deliver", () => deliverReport(report.id));

    return { reportId: report.id };
  },
);

/** Anomaly watch — daily, after the metric sync has landed. */
export const anomalyWatch = inngest.createFunction(
  { id: "anomaly-watch", triggers: [{ cron: "30 4 * * *" }] },
  async ({ step }) => {
    const agencies = await step.run("list-agencies", () =>
      db.agency.findMany({
        select: {
          id: true,
          name: true,
          users: {
            where: { role: { in: ["OWNER", "ADMIN"] } },
            select: { email: true },
          },
        },
      }),
    );

    let alerts = 0;

    for (const agency of agencies) {
      const anomalies = await step.run(`detect-${agency.id}`, () =>
        detectAnomalies(agency.id),
      );
      if (anomalies.length === 0) continue;

      alerts += anomalies.length;

      await step.run(`alert-${agency.id}`, async () => {
        const html = `<p>${anomalies.length} thing${anomalies.length === 1 ? "" : "s"} worth a look:</p><ul>${anomalies
          .map((anomaly) => `<li>${anomaly.message}</li>`)
          .join("")}</ul>`;

        await Promise.all(
          agency.users.map((user) =>
            sendEmail({
              to: user.email,
              subject: `Spend alert — ${agency.name}`,
              html,
            }),
          ),
        );
        return { notified: agency.users.length };
      });
    }

    return { agencies: agencies.length, alerts };
  },
);

export const functions = [
  healthcheck,
  nightlyOptimisation,
  optimiseClientJob,
  campaignScheduler,
  weeklyReports,
  clientReportJob,
  anomalyWatch,
];
