import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { readFileSync, existsSync } from "fs";
import { sendMail } from "./graph.js";
import { fetchLatestReportRows } from "./report.js";
import { computeDueGroups, targetMonth } from "./due.js";
import { buildReminderEmail } from "./template.js";

const REPORT_MAILBOX = process.env.REPORT_MAILBOX;
const SENDER_MAILBOX = process.env.GRAPH_SENDER_MAILBOX;
const DRY_RUN = process.env.DRY_RUN !== "false"; // default to safe/dry unless explicitly disabled
const DRY_RUN_RECIPIENT = process.env.DRY_RUN_RECIPIENT || "brandon.roberts@baraelectrical.com.au";

// Exchange Online throttles app-only sendMail at roughly 30 messages/minute per mailbox, and
// a full run is 180+ emails from the one sender. Pace under that ceiling instead of firing
// them back to back — the 2026-09-02 dry run got all 183 away in 70s, but that's ~2.6/sec and
// only held because every message went to a single internal recipient.
function parseSendDelay() {
  const raw = process.env.SEND_DELAY_MS;
  if (raw === undefined) return 2500;
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 0) {
    console.warn(`[startup] SEND_DELAY_MS="${raw}" is not a non-negative number — using 2500ms`);
    return 2500;
  }
  return ms;
}
const SEND_DELAY_MS = parseSendDelay();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
// The activity log lives in the Bara dashboard's database now. It was an Airtable table in
// the "Bara AI" base until Sep 2026; Airtable is being decommissioned.
const LOG_API = process.env.DASHBOARD_URL?.replace(/\/$/, "");
if (!LOG_API || !process.env.LOG_API_SECRET) {
  console.warn("[startup] DASHBOARD_URL or LOG_API_SECRET not set — activity logging disabled");
}

// Swallows its own failures, exactly as the Airtable version did: this runs at the end of a
// reminder send, and a missing log line must never make a completed send look failed.
async function logActivity(action) {
  if (!LOG_API || !process.env.LOG_API_SECRET) return;
  try {
    const res = await fetch(`${LOG_API}/api/log/activity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.LOG_API_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, department: "Admin", source: "annual-reminders" }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.warn("Activity log failed:", err.message);
  }
}

export async function run() {
  const runDate = getRunDate();
  console.log(`[run] Starting — ${DRY_RUN ? "DRY RUN (all mail redirected to " + DRY_RUN_RECIPIENT + ")" : "LIVE"}, runDate=${runDate.toISOString().slice(0, 10)}, ${SEND_DELAY_MS}ms between sends`);

  const { rows, receivedDateTime, sourceUrl } = await fetchLatestReportRows(REPORT_MAILBOX);
  console.log(`[run] Report loaded — ${rows.length} rows, received ${receivedDateTime}, source ${sourceUrl}`);

  const groups = computeDueGroups(rows, runDate);
  const { year: targetYear, month: targetMon } = targetMonth(runDate);
  const totalProperties = groups.reduce((n, g) => n + g.items.length, 0);
  const pacingSeconds = Math.round(Math.max(groups.length - 1, 0) * SEND_DELAY_MS / 1000);
  console.log(`[run] ${groups.length} reminder emails to send (${totalProperties} properties total), target month ${targetMon + 1}/${targetYear}, ~${pacingSeconds}s of pacing`);

  let sent = 0, failed = 0;
  for (const [i, group] of groups.entries()) {
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
    // Paced whether live or dry, so a dry run stays a faithful rehearsal of the real thing.
    // Skipped after the last message — nothing follows it to throttle against.
    if (i < groups.length - 1) await sleep(SEND_DELAY_MS);
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
  app.get("/run", async (req, res) => {
    // The service is on a public Railway domain (generated for manual testing) but /run
    // sends real emails to real clients when DRY_RUN=false, so it needs to not be triggerable
    // by anyone who finds the URL.
    if (process.env.RUN_TOKEN && req.query.token !== process.env.RUN_TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
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
