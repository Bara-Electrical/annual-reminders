// Minimal RFC4180 CSV parser — handles quoted fields (with embedded commas/newlines) and
// "" as an escaped literal quote. Sufficient for Aroflo's periodic report export.
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseReportCSV(text) {
  const rows = parseCSV(text);
  const header = rows[0];
  return rows.slice(1)
    .filter(r => r.length > 1 || r[0] !== "")
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
