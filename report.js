import { graphFetch } from "./graph.js";
import { parseReportCSV } from "./csv.js";

const REPORT_SUBJECT = "Annual Reminder Email Report";

// The email wraps its download link through Outlook SafeLinks + INKY phishing protection,
// neither of which is the real target. The real, direct Aroflo download URL only appears as
// plain link text in the "if the button doesn't work, copy this URL" fallback paragraph, so
// pull it out of the body by pattern instead of trying to unwrap the tracking redirects.
const DOWNLOAD_URL_RE = /https:\/\/in\.aroflo\.com\/document\/[A-Za-z0-9-]+/;

export async function fetchLatestReportRows(mailbox) {
  const searchRes = await graphFetch(
    `/users/${mailbox}/messages?$search="${REPORT_SUBJECT}"&$select=id,subject,receivedDateTime&$top=5`,
    { headers: { ConsistencyLevel: "eventual" } }
  );
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(`Report search failed: ${JSON.stringify(searchData)}`);

  const messages = (searchData.value || [])
    .filter(m => m.subject?.includes(REPORT_SUBJECT))
    .sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime));
  const latest = messages[0];
  if (!latest) throw new Error(`No "${REPORT_SUBJECT}" email found in ${mailbox}`);

  const fullRes = await graphFetch(`/users/${mailbox}/messages/${latest.id}?$select=body,receivedDateTime`);
  const full = await fullRes.json();
  if (!fullRes.ok) throw new Error(`Failed to read report email: ${JSON.stringify(full)}`);

  const match = DOWNLOAD_URL_RE.exec(full.body.content);
  if (!match) throw new Error("Could not find a download link in the report email body");

  const csvRes = await fetch(match[0]);
  if (!csvRes.ok) throw new Error(`Report download failed: HTTP ${csvRes.status}`);
  const csvText = await csvRes.text();

  return { rows: parseReportCSV(csvText), receivedDateTime: latest.receivedDateTime, sourceUrl: match[0] };
}
