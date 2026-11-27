// Properties enrolled for recurring ECCs on the dashboard (Recurring ECCs page) get their
// electrical compliance job raised automatically when it comes due, so the agency must not
// also be emailed a reminder to book it. Only the electrical-only package is dropped: an
// enrolled property's air con or combo reminder still goes out.
//
// The dashboard answers by address (the same property matching its own reports use), over
// the background services' shared secret. If it cannot be reached the reminders go out
// unfiltered and the run says so: a reminder too many is better than none at all.

import { isECC } from "./clientRules.js";

export async function dropEnrolled(groups, { dashboardUrl, secret, fetchImpl = fetch } = {}) {
  const items = groups.flatMap(g => g.items).filter(item => isECC(item.taskType));
  if (!items.length || !dashboardUrl || !secret) return { groups, dropped: 0 };

  let enrolled;
  try {
    const res = await fetchImpl(`${dashboardUrl}/api/log/recurring-compliance`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: items.map(item => ({ street: item.location ?? "", suburb: item.city ?? "" })) }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
    enrolled = (await res.json()).enrolled;
    if (!Array.isArray(enrolled) || enrolled.length !== items.length) throw new Error("unexpected answer");
  } catch (err) {
    console.warn("[run] Recurring ECC check failed, sending every reminder:", err.message);
    return { groups, dropped: 0 };
  }

  const skip = new Set(items.filter((_, i) => enrolled[i] === true));
  const out = groups
    .map(g => ({ ...g, items: g.items.filter(item => !skip.has(item)) }))
    .filter(g => g.items.length > 0);
  return { groups: out, dropped: skip.size };
}
