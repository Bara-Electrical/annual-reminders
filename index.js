import "dotenv/config";
import express from "express";
import cron from "node-cron";
import Airtable from "airtable";
import { readFileSync, existsSync } from "fs";
import { sendMail } from "./graph.js";
import { fetchLatestReportRows } from "./report.js";
import { computeDueGroups, targetMonth } from "./due.js";
import { buildReminderEmail } from "./template.js";

const REPORT_MAILBOX = process.env.REPORT_MAILBOX;
const SENDER_MAILBOX = process.env.GRAPH_SENDER_MAILBOX;
const DRY_RUN = process.env.DRY_RUN !== "false"; // default to safe/dry unless explicitly disabled
const DRY_RUN_RECIPIENT = process.env.DRY_RUN_RECIPIENT || "brandon.roberts@baraelectrical.com.au";

// Override for testing against historical report data (e.g. RUN_DATE=2026-08-05).
// Computed fresh per run (not at module load) since the server stays up long-term on Railway
// and the cron trigger needs the actual date at run time, not at process start.
function getRunDate() {
  return process.env.RUN_DATE ? new Date(process.env.RUN_DATE) : new Date();
}

const COMPLIANCE_PDF_PATH = new URL("./Bara Compliance Packages.pdf", import.meta.url);
const complianceAttachment = existsSync(COMPLIANCE_PDF_PATH)
  ? { name: "Bara Compliance Packages.pdf", contentType: "application/pdf", contentBytes: readFileSync(COMPLIANCE_PDF_PATH).toString("base64") }
  : null;
if (!complianceAttachment) {
  console.warn('[startup] "Bara Compliance Packages.pdf" not found in project root — reminder emails will be sent without the attachment');
}

// Shared cross-project Activity Log base (same one booking-reminders logs to).
let airtableBase = null;
if (process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID) {
  airtableBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
} else {
  console.warn("[startup] AIRTABLE_API_KEY or AIRTABLE_BASE_ID not set — activity logging disabled");
}

async function logActivity(action) {
  if (!airtableBase) return;
  try {
    await airtableBase("Activity Log").create([{ fields: { "Action": action, "Department": "Admin" } }]);
  } catch (err) {
    console.warn("Airtable activity log failed:", err.message);
  }
}

export async function run() {
  const runDate = getRunDate();
  console.log(`[run] Starting — ${DRY_RUN ? "DRY RUN (all mail redirected to " + DRY_RUN_RECIPIENT + ")" : "LIVE"}, runDate=${runDate.toISOString().slice(0, 10)}`);

  const { rows, receivedDateTime, sourceUrl } = await fetchLatestReportRows(REPORT_MAILBOX);
  console.log(`[run] Report loaded — ${rows.length} rows, received ${receivedDateTime}, source ${sourceUrl}`);

  const groups = computeDueGroups(rows, runDate);
  const { year: targetYear, month: targetMon } = targetMonth(runDate);
  const totalProperties = groups.reduce((n, g) => n + g.items.length, 0);
  console.log(`[run] ${groups.length} reminder emails to send (${totalProperties} properties total), target month ${targetMon + 1}/${targetYear}`);

  let sent = 0, failed = 0;
  for (const group of groups) {
    const { subject, html } = buildReminderEmail(group, { targetMonth: targetMon, targetYear });
    const to = DRY_RUN ? DRY_RUN_RECIPIENT : group.emails;
    const finalHtml = DRY_RUN ? `<p><em>[DRY RUN — originally addressed to ${group.emails.join(", ")}]</em></p>${html}` : html;
    try {
      await sendMail(SENDER_MAILBOX, {
        subject,
        html: finalHtml,
        to,
        attachments: complianceAttachment ? [complianceAttachment] : [],
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[run] Failed to send to ${group.emails.join(", ")}:`, err.message);
    }
  }

  console.log(`[run] Done — sent ${sent}, failed ${failed}`);

  if (!DRY_RUN) {
    const monthLabel = new Date(targetYear, targetMon, 1).toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    await logActivity(`Annual maintenance reminders sent: ${sent} emails covering ${totalProperties} properties completed in ${monthLabel} (${failed} failed)`);
  }

  return { sent, failed, groups: groups.length };
}

if (process.env.RUN_ONCE === "true") {
  run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
} else {
  const app = express();
  app.get("/", (_req, res) => res.json({ status: "ok" }));
  app.get("/run", async (_req, res) => {
    try { res.json(await run()); } catch (err) { res.status(500).json({ error: err.message }); }
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`[startup] Listening on ${port}`));

  // First Wednesday of every month, 10:00 Perth time. Cron has no native "nth weekday of
  // month" field, so this fires every Wednesday and the handler skips any that aren't the
  // month's first (day-of-month > 7 means a prior Wednesday already fired this month).
  cron.schedule("0 10 * * 3", () => {
    if (new Date().getDate() > 7) return;
    run().catch(err => console.error("[cron] run failed:", err));
  }, {
    timezone: "Australia/Perth",
  });
  console.log("[startup] Monthly schedule armed (first Wednesday @ 10:00 Australia/Perth)");
}
