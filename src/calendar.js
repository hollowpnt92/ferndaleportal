"use strict";

const fs = require("fs");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

/**
 * Public calendar: GOOGLE_CALENDAR_API_KEY
 * Private calendar: share the calendar with the service account email, then set
 * GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH (or JSON / base64). Service account wins if configured.
 */

const CACHE_MS = 5 * 60 * 1000;
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

/** @type {{ at: number; payload: { configured: boolean; events: unknown[]; error: string | null } } | null} */
let cache = null;

/** @type {GoogleAuth | null} */
let googleAuthClient = null;

function readEnvVar(name) {
  const v = process.env[name];
  if (v == null || v === undefined) return "";
  let s = String(v).trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function sanitizeCalendarIdInput(s) {
  if (!s) return "";
  let x = String(s)
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  if ((x.startsWith('"') && x.endsWith('"')) || (x.startsWith("'") && x.endsWith("'"))) {
    x = x.slice(1, -1).trim();
  }
  if (x.includes("%40") && !x.includes("@")) {
    try {
      x = decodeURIComponent(x);
    } catch (e) {
      /* ignore */
    }
  }
  return x.trim();
}

function calendarIdFromIcalUrl(s) {
  const m = s.match(/calendar\.google\.com\/calendar\/ical\/([^/]+)\//i);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch (e) {
    return m[1];
  }
}

function resolveCalendarId() {
  let s = sanitizeCalendarIdInput(readEnvVar("GOOGLE_CALENDAR_ID"));
  if (!s) return "";

  const fromIcal = calendarIdFromIcalUrl(s);
  if (fromIcal) return sanitizeCalendarIdInput(fromIcal);

  if (s.includes("calendar.google.com")) {
    try {
      const u = new URL(s.startsWith("http") ? s : `https://${s}`);
      const src = u.searchParams.get("src");
      if (src) {
        return sanitizeCalendarIdInput(
          decodeURIComponent(src.replace(/\+/g, " "))
        );
      }
    } catch (e) {
      /* ignore */
    }
  }

  return s;
}

function loadServiceAccountCredentials() {
  const inline = readEnvVar("GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON");
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch (e) {
      return null;
    }
  }
  const b64 = readEnvVar("GOOGLE_CALENDAR_SERVICE_ACCOUNT_B64");
  if (b64) {
    try {
      return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch (e) {
      return null;
    }
  }
  const filePath = readEnvVar("GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH");
  if (filePath) {
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    try {
      if (fs.existsSync(resolved)) {
        return JSON.parse(fs.readFileSync(resolved, "utf8"));
      }
    } catch (e) {
      return null;
    }
  }
  return null;
}

async function getServiceAccountAccessToken() {
  const creds = loadServiceAccountCredentials();
  if (!creds) return null;
  if (!googleAuthClient) {
    googleAuthClient = new GoogleAuth({
      credentials: creds,
      scopes: [CALENDAR_SCOPE],
    });
  }
  const client = await googleAuthClient.getClient();
  const res = await client.getAccessToken();
  if (!res.token) {
    throw new Error("Service account did not return an access token.");
  }
  return res.token;
}

function parseYmd(localDateStr) {
  const parts = String(localDateStr).split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatOpts(extra) {
  const tz = process.env.GOOGLE_CALENDAR_TIMEZONE;
  if (!tz || String(tz).trim() === "") return extra;
  return { ...extra, timeZone: tz.trim() };
}

function normalizeEvent(item) {
  const title = String(item.summary || "").trim() || "(Untitled event)";
  let allDay = false;
  let startRaw = "";
  let endRaw = "";
  if (item.start && item.start.dateTime) {
    startRaw = item.start.dateTime;
    endRaw = item.end && item.end.dateTime ? item.end.dateTime : "";
  } else if (item.start && item.start.date) {
    allDay = true;
    startRaw = item.start.date;
    endRaw = item.end && item.end.date ? item.end.date : "";
  } else {
    return null;
  }
  return {
    title,
    allDay,
    startRaw,
    endRaw,
    link: item.htmlLink || null,
  };
}

function formatDisplay(ev) {
  if (ev.allDay) {
    const start = parseYmd(ev.startRaw);
    const endExcl = ev.endRaw ? parseYmd(ev.endRaw) : null;
    const primary = start.toLocaleDateString(undefined, formatOpts({
      weekday: "short",
      month: "long",
      day: "numeric",
      year: "numeric",
    }));
    let secondary = "All day";
    if (endExcl && endExcl > start) {
      const lastDay = new Date(endExcl.getTime() - 86400000);
      if (lastDay > start) {
        secondary = `Through ${lastDay.toLocaleDateString(undefined, formatOpts({
          weekday: "short",
          month: "short",
          day: "numeric",
        }))}`;
      }
    }
    return { primary, secondary };
  }

  const start = new Date(ev.startRaw);
  const end = ev.endRaw ? new Date(ev.endRaw) : null;
  const primary = start.toLocaleString(undefined, formatOpts({
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }));
  let secondary = null;
  if (end && end > start) {
    secondary = `Ends ${end.toLocaleString(undefined, formatOpts({
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }))}`;
  }
  return { primary, secondary };
}

function calendarHttpErrorMessage(status, detail, authMode) {
  const hint404Public =
    "Check Calendar ID and that the calendar is public if you use an API key only.";
  const hint404Sa =
    "Calendar ID may be wrong, or this calendar is not shared with your service account. In Google Calendar → Settings → Share with specific people → add the service account email from the JSON (client_email) with permission to see events.";
  const hint404 = authMode === "serviceAccount" ? hint404Sa : hint404Public;

  if (status === 403) {
    if (authMode === "serviceAccount") {
      return `Calendar access denied (${status}). ${detail} Enable the Google Calendar API for the project that owns this service account, and share the calendar with the service account email.`;
    }
    return `Calendar access denied (${status}). ${detail} For API key access: enable Calendar API, check key restrictions, and make the calendar public. For private calendars, use a service account instead.`;
  }
  if (status === 404) {
    return `Calendar could not be loaded (${status}). ${detail} ${hint404}`;
  }
  return `Calendar could not be loaded (${status}). ${detail}`;
}

async function getHomepageCalendarWidget() {
  const calendarId = resolveCalendarId();
  const apiKey = readEnvVar("GOOGLE_CALENDAR_API_KEY");
  const saCreds = loadServiceAccountCredentials();
  const useServiceAccount = saCreds != null;
  const useApiKey = !useServiceAccount && Boolean(apiKey);

  if (!calendarId || (!useServiceAccount && !useApiKey)) {
    return { configured: false, events: [], error: null };
  }

  const authMode = useServiceAccount ? "serviceAccount" : "apiKey";

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.payload;
  }

  try {
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: weekAhead.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "50",
    });
    if (useApiKey) {
      params.set("key", apiKey);
    }

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`;
    /** @type {Record<string, string>} */
    const headers = {};
    if (useServiceAccount) {
      const token = await getServiceAccountAccessToken();
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const errBody = await res.json();
        if (errBody.error && errBody.error.message) detail = errBody.error.message;
      } catch (e) {
        /* ignore */
      }
      const payload = {
        configured: true,
        events: [],
        error: calendarHttpErrorMessage(res.status, detail, authMode),
      };
      cache = { at: Date.now(), payload };
      return payload;
    }

    const data = await res.json();
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const normalized = rawItems.map(normalizeEvent).filter(Boolean);
    const events = normalized.map(function (ev) {
      const fmt = formatDisplay(ev);
      return {
        title: ev.title,
        primary: fmt.primary,
        secondary: fmt.secondary,
        link: ev.link,
      };
    });

    const payload = { configured: true, events, error: null };
    cache = { at: Date.now(), payload };
    return payload;
  } catch (e) {
    const payload = {
      configured: true,
      events: [],
      error: e.message || "Could not reach Google Calendar.",
    };
    cache = { at: Date.now(), payload };
    return payload;
  }
}

module.exports = { getHomepageCalendarWidget };
