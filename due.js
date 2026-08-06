// Report rows -> the set of reminder emails that should go out this run.
//
// Date basis: keyed on "Compliance Form Closed Date Time" (when the actual certificate/
// service form was signed off), not "Completed Date" (the job's completion date, which can
// lag or lead the form close-out). "Take 5 Pre-task Safety Check" rows are excluded entirely
// — that's an internal pre-job safety checklist, not a compliance certificate, so it has no
// bearing on when a property's next annual service is due.
//
// Dedup: a job can produce several rows (one per compliance form filled out on the same
// visit), and the same property can be serviced again in a later year. For each distinct
// (Location, Location City, Task Type) we only care about the most recent form close date —
// that's the property's current renewal clock for that package.
//
// Due window: reminders go out 11 months after the last service, matched by calendar month
// (not a rolling day count) — e.g. a run on 2026-08-xx reminds everyone last serviced in
// 2025-09, giving clients about a month's notice before their 1-year anniversary.
//
// Per-client rules (suppression, recipient overrides, etc.) are applied after dedup but
// before grouping — see clientRules.js.

import { applyClientRules } from "./clientRules.js";

const EXCLUDED_COMPLIANCE_FORM_TYPES = new Set(["Take 5 Pre-task Safety Check"]);

function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || "");
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

// "24/2/2025 10:14 AM" -> "24/2/2025" (drop the time for display).
function dateOnly(s) {
  return String(s ?? "").split(" ")[0];
}

// Aroflo occasionally exports this field as "Display Name<email@domain.com>" instead of a
// bare address — pull just the email out when that shape shows up.
function extractEmail(raw) {
  const s = String(raw ?? "").trim();
  const m = /<([^<>]+)>\s*$/.exec(s);
  return (m ? m[1] : s).trim();
}

export function targetMonth(runDate) {
  const total = runDate.getFullYear() * 12 + runDate.getMonth() - 11;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function computeDueGroups(rows, runDate = new Date()) {
  const { year: targetYear, month: targetMon } = targetMonth(runDate);

  const latestByProperty = new Map();
  for (const row of rows) {
    if (EXCLUDED_COMPLIANCE_FORM_TYPES.has(row["Compliance Form Type"])) continue;
    const date = parseDate(row["Compliance Form Closed Date Time"]);
    if (!date) continue;
    const key = `${row["Location"]}|${row["Location City"]}|${row["Task Type"]}`;
    const existing = latestByProperty.get(key);
    if (!existing || date > existing.date) latestByProperty.set(key, { row, date });
  }

  const dueItems = [...latestByProperty.values()]
    .filter(({ date }) => date.getFullYear() === targetYear && date.getMonth() === targetMon)
    .map(({ row, date }) => ({
      clientName: row["Client Name"],
      location: row["Location"],
      city: row["Location City"],
      taskType: row["Task Type"],
      completedDate: date,
      completedDateRaw: dateOnly(row["Compliance Form Closed Date Time"]),
      reportedByName: row["Reported By"],
      reportedByEmail: extractEmail(row["Reported By Email"]),
    }))
    .filter(item => item.reportedByEmail); // no email on file -> can't remind, skip silently

  const ruledItems = applyClientRules(dueItems);

  const groups = new Map();
  for (const item of ruledItems) {
    const key = [...item.recipients].sort().join(",");
    if (!groups.has(key)) groups.set(key, { emails: item.recipients, name: item.reportedByName, items: [] });
    groups.get(key).items.push(item);
  }

  return [...groups.values()];
}
