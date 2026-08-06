// Microsoft Graph API client — client-credentials (app-only) auth, same Azure app
// registration used by the workorder-emails project.

const REQUIRED_ENV = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] ${key} is not set`);
    process.exit(1);
  }
}

async function fetchWithRetry(url, options = {}, { attempts = 3, baseDelayMs = 500, label = "fetch" } = {}) {
  let lastErr, lastRes;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status < 500 && res.status !== 429)) return res;
      lastRes = res;
      lastErr = new Error(`${label}: HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) {
      const delay = baseDelayMs * 2 ** i;
      console.warn(`${label} — attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms: ${lastErr.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  if (lastRes) return lastRes; // exhausted retries but got a (failing) response — let the caller inspect/report it
  throw lastErr; // every attempt was a raw network failure
}

let tokenCache = { token: null, expiry: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiry - 60000) return tokenCache.token;
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     process.env.GRAPH_CLIENT_ID,
        client_secret: process.env.GRAPH_CLIENT_SECRET,
        scope:         "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(`Graph auth failed: ${JSON.stringify(data)}`);
  tokenCache = { token: data.access_token, expiry: Date.now() + data.expires_in * 1000 };
  return tokenCache.token;
}

export async function graphFetch(path, options = {}) {
  const token = await getAccessToken();
  return fetchWithRetry(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  }, { label: `graphFetch ${path}` });
}

export async function sendMail(mailbox, { subject, html, to, attachments = [] }) {
  const res = await graphFetch(`/users/${mailbox}/sendMail`, {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject,
        toRecipients: (Array.isArray(to) ? to : [to]).map(address => ({ emailAddress: { address } })),
        body: { contentType: "HTML", content: html },
        attachments: attachments.map(a => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: a.name,
          contentType: a.contentType,
          contentBytes: a.contentBytes, // base64
        })),
      },
    }),
  });
  if (!res.ok) throw new Error(`sendMail failed: HTTP ${res.status} ${await res.text()}`);
}
