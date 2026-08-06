// Per-client overrides to the default "remind whoever's in Reported By Email" behaviour.
// Keyed on the exact Client Name string as it appears in the Aroflo report — verified
// against the real report data on 2026-08-05. If a client's name in Aroflo changes, the
// rule silently stops applying (no error), so re-verify this list periodically.
//
// suppressAll        — never send a reminder for this client, full stop.
// suppressECC        — drop only the electrical-only compliance package ("$120 Standard
//                       Electrical Compliance"); combo Air Con & Electrical Compliance and
//                       pure air con packages are unaffected.
// overrideRecipients — ignore Reported By Email entirely, always send to this fixed list.
// additionalRecipients — send to Reported By Email as normal, plus these extra addresses.
// excludeEmails      — drop items whose Reported By Email matches one of these (client
//                       otherwise proceeds normally for other contacts).
export const CLIENT_RULES = {
  "Aslander Real Estate": { suppressAll: true, note: "Do Not Trade" },
  "Dana Fulton Property Management": { suppressAll: true },
  "Expanded Equity Group": { suppressAll: true, note: "Has internal process" },
  "Heritage Realty": { suppressAll: true },
  "Jones & Co Property": { suppressAll: true },
  "Pulse Property Group": { suppressAll: true },
  "Welsh Real Estate": { suppressAll: true },
  // Not found in the current report's client list under this exact name — kept here so the
  // rule takes effect automatically if/when they reappear, but the spelling is unverified.
  "Hamilton Property": { suppressAll: true },
  "Next Move": { suppressAll: true },
  "Shellabears": { suppressAll: true },
  "Tyler & Sons": { suppressAll: true, suppressECC: true },

  "D R Property Management": { overrideRecipients: ["accountswa@drpm.com.au"] },
  "Limnios Property Group": { overrideRecipients: ["limnios@limnios.com"] },
  "Perth EQ Residential Pty Ltd": { overrideRecipients: ["mshi@fareast.net.au"], note: "Amanda Loud no longer there" },

  "Orana Property Management": { additionalRecipients: ["t.tassicker@oranaproperty.com.au", "pmassist3@oranaproperty.com.au"] },

  "Investors Edge Real Estate": { overrideRecipients: ["dani@investorsedge.com.au", "processing@investorsedge.com.au"] },

  "Professionals BW Backhouse & Associates": { excludeEmails: ["pm10@bwbackhouse.com.au"], note: "Sally Fulford — no emails" },

  "Mack Hall Real Estate": { suppressECC: true },
  "RH Property": { suppressECC: true },
  "Vivid Property Perth": { suppressECC: true, note: "Combo package still sent" },

  "Hartanto Properties": { note: "Formerly Harcourts Applecross — send as normal" },

  // No rule applied (confirmed with Brandon — not worth chasing down): "Amana Living"
  // (owner-name requirement, no data source for it), "Porter Matthews Metro" (departed
  // contact, no replacement given), "PLG Realty" (no matching Aroflo client found), "Prop
  // UP & Co Pty Ltd" (settlement-job inclusion — no such concept in this pipeline). All four
  // just get default behaviour, same as any client with no entry here.
};

function isECC(taskType) {
  const t = String(taskType ?? "");
  return /electrical compliance/i.test(t) && !/air con/i.test(t);
}

// Applies suppression/ECC/exclude rules to due items (pre-grouping), and returns each
// surviving item annotated with its effective recipient list.
export function applyClientRules(dueItems) {
  const out = [];
  for (const item of dueItems) {
    const rule = CLIENT_RULES[item.clientName];
    if (!rule) {
      out.push({ ...item, recipients: [item.reportedByEmail] });
      continue;
    }
    if (rule.suppressAll) continue;
    if (rule.suppressECC && isECC(item.taskType)) continue;
    if (rule.excludeEmails?.includes(item.reportedByEmail.toLowerCase())) continue;

    const recipients = rule.overrideRecipients
      ? [...rule.overrideRecipients]
      : [item.reportedByEmail];
    if (rule.additionalRecipients) recipients.push(...rule.additionalRecipients);

    out.push({ ...item, recipients: [...new Set(recipients.map(r => r.toLowerCase()))] });
  }
  return out;
}
