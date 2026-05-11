# ferndaleportal

Express-based community portal with a municipal-style layout, Docker support, shared “community” password (extra nav + pages), and a separate admin password for editing content stored in `data/site.json`.

## Run with Docker

1. Copy environment variables: `cp .env.example .env` and set strong values for `PORTAL_PASSWORD`, `ADMIN_PASSWORD`, and `SESSION_SECRET`.
2. Start: `docker compose up --build`
3. Open [http://localhost:3000](http://localhost:3000)

Content edits persist in the named volume `portal-data` (`data/site.json` inside the container).

### Site-wide password gate (optional)

Set `SITE_GATE_ENABLED=true` (or `1` / `yes`) and `SITE_GATE_PASSWORD` to show a login screen before anyone can browse the portal. Static files under `/css/` and `/js/` stay reachable so the gate page can load styles. Non-GET requests (e.g. API calls) return 403 until the browser session has passed the gate via **POST `/site-gate`**. Use **Exit site session** in the footer to clear that cookie. This is separate from the community and admin passwords.

If `SITE_GATE_ENABLED` is set but `SITE_GATE_PASSWORD` is empty, the gate is disabled and a warning is logged.

### Google Calendar (homepage widget)

Optional feed for “Upcoming events” (next 7 days). Pick **one** auth style:

**A — Public calendar + API key** (simplest): Enable **Google Calendar API**, create an **API key**, make the calendar **public**, then set `GOOGLE_CALENDAR_ID` and `GOOGLE_CALENDAR_API_KEY`.

**B — Private calendar + service account** (no “public” toggle): In Google Cloud, enable **Google Calendar API**, create a **service account**, create a **JSON key**. Copy the service account’s **`client_email`**. In Google Calendar → that calendar’s settings → **Share with specific people**, add that email with **See all event details** (or higher). Store the JSON securely and point the app at it with **`GOOGLE_CALENDAR_SERVICE_ACCOUNT_PATH`** (recommended with Docker: mount the file read-only, e.g. `/app/secrets/gcal-sa.json`). You can use **`GOOGLE_CALENDAR_SERVICE_ACCOUNT_B64`** instead if you prefer a single env string.

If **both** a service account and an API key are set, the **service account is used** (`GOOGLE_CALENDAR_API_KEY` is ignored).

Always set **`GOOGLE_CALENDAR_ID`** from Calendar settings → **Integrate calendar**. Optionally set **`GOOGLE_CALENDAR_TIMEZONE`** (IANA name, e.g. `America/Detroit`).

If calendar-related variables are incomplete, the homepage hides the calendar block.

### Security-related environment variables

| Variable | Purpose |
|----------|---------|
| `COOKIE_SECURE` | Set `true` when the app is **only** reached over HTTPS so session cookies use the `Secure` flag. |
| `COOKIE_INSECURE` | If `NODE_ENV=production` but you still use **HTTP** (e.g. LAN Docker), set `true` so browsers accept session cookies (avoid on public networks). |
| `TRUST_PROXY` | Set `true` behind nginx / another TLS-terminating proxy so Express trusts `X-Forwarded-*` headers. |
| `RATE_LIMIT_AUTH_MAX` | Max POST attempts per IP per 15 minutes for site gate, community login, and admin login (default `60`). |
| `RATE_LIMIT_SAVE_MAX` | Max admin save POSTs per IP per 15 minutes (default `120`). |

Admin-edited HTML is **sanitized** on save (dangerous tags/schemes stripped). Navigation links only allow safe internal paths or `http`/`https` URLs.

### Homepage layout

**Section order** is stored in `site.json` as `homeSectionOrder`: an array of `intro`, `calendar`, `quick`, and `poll` (each once). Drag **Homepage section order** in the admin editor to put the poll (or any block) first. The calendar block is skipped when Google Calendar env vars are not set.

### Homepage poll

Poll data lives in **`data/poll.json`** (created from `config/poll.default.json` on first run). Admins edit the question and choices under **Edit site → Homepage poll**; **Save poll only** writes that file without touching `site.json`. Visitors vote with **name + choice**, can **add new choices** from the homepage, and see **results immediately** after voting (names and choices are public — use only if appropriate for your community). Admins can remove **individual votes** from **Edit site → Homepage poll → Current votes**. Rate limits: `RATE_LIMIT_POLL_MAX` (default 40 per 15 minutes per IP).

## Run locally

`npm install` then `npm start` (same env vars as above). On first run, `config/site.default.json` is copied to `data/site.json` if missing.

## Routes

- `/` — Homepage  
- `/p/:slug` — Internal pages (optional `memberOnly` in JSON)  
- `/login` — Community password  
- `/admin/login` — Admin password  
- `/admin` — Edit hero text, homepage HTML, navigation JSON, and pages JSON  