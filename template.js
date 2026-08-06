// Mirrors the wording of the real "Annual Maintenance Reminders - Bara Electrical" emails
// previously sent by hand from workorders@baraelectrical.com.au, minus the smoke-alarm
// warranty paragraph (dropped per Brandon — email now ends after the work-order instructions).
// Each block is its own <div>, with an empty spacer <div><br></div> between them — matching
// the original manually-composed emails' structure.

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const cellStyle = "border:1px solid #ABABAB; padding:4px 8px; font-family:Calibri,Arial,sans-serif; font-size:12pt; vertical-align:top;";

// "$240 Air Con & Electrical Compliance" -> "Air Con & Electrical Compliance"
// "Private - $220 Standard Air Con Service" -> "Private - Standard Air Con Service"
function stripPrice(taskType) {
  return String(taskType ?? "").replace(/\$\d+\s*/g, "").replace(/\s{2,}/g, " ").trim();
}

function buildSubject(group) {
  const { items } = group;
  const suffix = items.length > 1
    ? `${items.length} properties due`
    : `${items[0].location}, ${items[0].city}`;
  return `Bara Electrical Annual Maintenance Reminders - ${suffix}`;
}

export function buildReminderEmail(group, { targetMonth, targetYear }) {
  const monthLabel = `${MONTH_NAMES[targetMonth]} ${targetYear}`;

  const rowsHtml = group.items.map(i => `
    <tr>
      <td style="${cellStyle}">${escapeHtml(i.location)}, ${escapeHtml(i.city)}</td>
      <td style="${cellStyle}">${escapeHtml(stripPrice(i.taskType))}</td>
      <td style="${cellStyle} text-align:center; white-space:nowrap;">${escapeHtml(i.completedDateRaw)}</td>
    </tr>`).join("");

  const table = `<table style="border-collapse:collapse; width:100%;"><tbody>${rowsHtml}</tbody></table>`;

  const segments = [
    "Hello,",
    "We hope this finds you well,",
    `<b>Please see the properties below that had Maintenance Packages completed in ${monthLabel} that are now due</b>`,
    table,
    `If you would like to proceed with any of the services above, please send through separate work orders to <a href="mailto:workorders@baraelectrical.com.au">workorders@baraelectrical.com.au</a>`,
    "Please include the <b>service name</b> and <b>order code</b> in the workorder. Our Maintenance Packages Brochure is attached for you reference.",
    "We look forward to hearing from you!"
  ];

  const style = "font-family:Calibri,Arial,sans-serif; font-size:12pt; color:rgb(0,0,0);";
  const html = segments
    .map(s => `<div style="${style}">${s}</div>`)
    .join(`<div style="${style}"><br></div>`);

  return { subject: buildSubject(group), html };
}
