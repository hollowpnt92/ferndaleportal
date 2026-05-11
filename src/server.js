"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const bodyParser = require("body-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getHomepageCalendarWidget } = require("./calendar");
const {
  readPoll,
  ensurePollFile,
  applyAdminPollUpdate,
  addPublicOption,
  addVote,
  deleteVoteById,
} = require("./poll");
const {
  sanitizeRichHtml,
  sanitizePlainText,
  normalizeNavLink,
  normalizePage,
  timingSafePasswordEqual,
} = require("./security");

const PORT = Number(process.env.PORT) || 3000;
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

function envTruthy(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

const SITE_GATE_ENABLED = envTruthy("SITE_GATE_ENABLED");
const SITE_GATE_PASSWORD =
  process.env.SITE_GATE_PASSWORD != null
    ? String(process.env.SITE_GATE_PASSWORD)
    : "";

const siteGateActive = SITE_GATE_ENABLED && SITE_GATE_PASSWORD.length > 0;

/* Secure cookies require HTTPS. Enable explicitly, or in production unless COOKIE_INSECURE=true (HTTP-only deployments). */
const cookieSecure =
  envTruthy("COOKIE_SECURE") ||
  (process.env.NODE_ENV === "production" && !envTruthy("COOKIE_INSECURE"));

function sanitizeNextPath(raw) {
  if (typeof raw !== "string") return "/";
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return "/";
  return t;
}

const DATA_DIR = path.join(__dirname, "..", "data");
const SITE_FILE = path.join(DATA_DIR, "site.json");
const SITE_DEFAULT = path.join(__dirname, "..", "config", "site.default.json");
const SESSION_DIR = path.join(DATA_DIR, "sessions");

function ensureSiteFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
  if (!fs.existsSync(SITE_FILE) && fs.existsSync(SITE_DEFAULT)) {
    fs.copyFileSync(SITE_DEFAULT, SITE_FILE);
  }
  ensurePollFile();
}

function readSite() {
  ensureSiteFile();
  const raw = fs.readFileSync(SITE_FILE, "utf8");
  return JSON.parse(raw);
}

function writeSite(data) {
  ensureSiteFile();
  fs.writeFileSync(SITE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function validateSitePayload(body) {
  const heroTitle = sanitizePlainText(String(body.heroTitle || "").trim(), 300);
  if (!heroTitle) {
    throw new Error("Hero title is required.");
  }
  const heroSubtitle = sanitizePlainText(String(body.heroSubtitle || ""), 5000);
  const homeContent = sanitizeRichHtml(String(body.homeContent || ""));
  const navLinks = Array.isArray(body.navLinks)
    ? body.navLinks.map((item) => normalizeNavLink(item))
    : [];
  const memberNavLinks = Array.isArray(body.memberNavLinks)
    ? body.memberNavLinks.map((item) => normalizeNavLink(item))
    : [];
  const pages = Array.isArray(body.pages)
    ? body.pages.map((item) => normalizePage(item))
    : [];
  const slugs = pages.map((p) => p.slug);
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Each page needs a unique slug.");
  }
  return {
    heroTitle,
    heroSubtitle,
    homeContent,
    navLinks,
    memberNavLinks,
    pages,
  };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(
    5,
    parseInt(process.env.RATE_LIMIT_AUTH_MAX || "60", 10) || 60
  ),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res
      .status(429)
      .type("text/plain")
      .send("Too many attempts. Try again later.");
  },
});

const adminSaveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(
    10,
    parseInt(process.env.RATE_LIMIT_SAVE_MAX || "120", 10) || 120
  ),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ ok: false, error: "Too many saves. Try again later." });
  },
});

const pollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(10, parseInt(process.env.RATE_LIMIT_POLL_MAX || "40", 10) || 40),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res
      .status(429)
      .type("text/plain")
      .send("Too many poll actions. Try again later.");
  },
});

const app = express();

if (envTruthy("TRUST_PROXY")) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json({ limit: "2mb" }));

ensureSiteFile();

const sessionStore = new FileStore({
  path: SESSION_DIR,
  ttl: 7 * 24 * 60 * 60,
  reapInterval: 60 * 60,
  logFn: function () {},
});

app.use(
  session({
    name: "ferndaleportal.sid",
    secret: SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSecure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use((req, res, next) => {
  res.locals.site = readSite();
  res.locals.isMember = Boolean(req.session.member);
  res.locals.isAdmin = Boolean(req.session.admin);
  res.locals.currentPath = req.path || "/";
  res.locals.siteGateEnabled = siteGateActive;
  next();
});

app.use((req, res, next) => {
  if (!siteGateActive) return next();
  if (req.session.gateAuthed) return next();
  const p = req.path || "/";
  if (p === "/site-gate") return next();
  if (p.startsWith("/css/") || p.startsWith("/js/")) return next();
  const ext = path.extname(p).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico"].includes(ext)) {
    return next();
  }
  if (req.method !== "GET") {
    return res
      .status(403)
      .type("text/plain")
      .send("This site requires a password. Open it in a browser and sign in at /site-gate first.");
  }
  const q = req.originalUrl || "/";
  return res.redirect(302, "/site-gate?next=" + encodeURIComponent(q));
});

function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.redirect("/admin/login");
  }
  next();
}

app.get("/site-gate", (req, res) => {
  if (!siteGateActive) {
    return res.redirect("/");
  }
  if (req.session.gateAuthed) {
    return res.redirect(sanitizeNextPath(req.query.next));
  }
  res.render("site-gate", {
    title: "Site access",
    site: readSite(),
    error: null,
    next: sanitizeNextPath(req.query.next),
  });
});

app.post("/site-gate", authLimiter, (req, res) => {
  if (!siteGateActive) {
    return res.redirect("/");
  }
  const password = String(req.body.password || "");
  const nextPath = sanitizeNextPath(req.body.next);
  if (timingSafePasswordEqual(password, SITE_GATE_PASSWORD)) {
    req.session.gateAuthed = true;
    return req.session.save(() => res.redirect(nextPath));
  }
  res.render("site-gate", {
    title: "Site access",
    site: readSite(),
    error: "That password did not match. Try again.",
    next: nextPath,
  });
});

app.post("/site-gate/logout", (req, res) => {
  delete req.session.gateAuthed;
  req.session.save(() => res.redirect(siteGateActive ? "/site-gate" : "/"));
});

app.get("/", async (req, res, next) => {
  try {
    const site = readSite();
    const calendar = await getHomepageCalendarWidget();
    const poll = readPoll();
    const pollFlash = req.session.pollFlash || null;
    if (req.session.pollFlash) {
      delete req.session.pollFlash;
      return req.session.save((err) => {
        if (err) return next(err);
        res.render("home", {
          title: site.heroTitle,
          site,
          calendar,
          poll,
          pollFlash,
        });
      });
    }
    res.render("home", {
      title: site.heroTitle,
      site,
      calendar,
      poll,
      pollFlash: null,
    });
  } catch (e) {
    next(e);
  }
});

app.post("/poll/vote", pollLimiter, (req, res) => {
  try {
    addVote(req.body.optionId, req.body.voterName);
    req.session.pollFlash = {
      type: "success",
      message: "Thanks — your vote was recorded. Results are updated below.",
    };
  } catch (e) {
    req.session.pollFlash = {
      type: "error",
      message: e.message || "Could not save your vote.",
    };
  }
  req.session.save(() => res.redirect("/"));
});

app.post("/poll/option", pollLimiter, (req, res) => {
  try {
    addPublicOption(req.body.label);
    req.session.pollFlash = {
      type: "success",
      message: "New choice added. Others can vote for it now.",
    };
  } catch (e) {
    req.session.pollFlash = {
      type: "error",
      message: e.message || "Could not add that choice.",
    };
  }
  req.session.save(() => res.redirect("/"));
});

app.get("/p/:slug", (req, res) => {
  const site = readSite();
  const page = site.pages.find((p) => p.slug === req.params.slug);
  if (!page) {
    return res.status(404).render("404", { title: "Not found", site });
  }
  const requiresMember = page.memberOnly === true;
  if (requiresMember && !req.session.member && !req.session.admin) {
    return res.status(403).render("403", {
      title: "Sign in required",
      site,
      message: "This page is available to signed-in community members.",
    });
  }
  res.render("page", { title: page.title, site, page });
});

app.get("/login", (req, res) => {
  if (req.session.member) {
    return res.redirect("/");
  }
  res.render("login", {
    title: "Community sign in",
    site: readSite(),
    error: null,
    nextPath: sanitizeNextPath(req.query.next),
  });
});

app.post("/login", authLimiter, (req, res) => {
  const site = readSite();
  const password = String(req.body.password || "");
  const nextPath = sanitizeNextPath(req.body.next);
  if (!PORTAL_PASSWORD) {
    return res.status(503).render("login", {
      title: "Community sign in",
      site,
      error: "Portal password is not configured on the server.",
    });
  }
  if (timingSafePasswordEqual(password, PORTAL_PASSWORD)) {
    req.session.member = true;
    return req.session.save(() => res.redirect(nextPath));
  }
  res.render("login", {
    title: "Community sign in",
    site,
    error: "That password did not match. Please try again.",
  });
});

app.post("/logout", (req, res) => {
  delete req.session.member;
  req.session.save(() => res.redirect("/"));
});

app.get("/admin/login", (req, res) => {
  if (req.session.admin) {
    return res.redirect("/admin");
  }
  res.render("admin-login", {
    title: "Admin sign in",
    site: readSite(),
    error: null,
  });
});

app.post("/admin/login", authLimiter, (req, res) => {
  const site = readSite();
  const password = String(req.body.password || "");
  if (!ADMIN_PASSWORD) {
    return res.status(503).render("admin-login", {
      title: "Admin sign in",
      site,
      error: "Admin password is not configured on the server.",
    });
  }
  if (timingSafePasswordEqual(password, ADMIN_PASSWORD)) {
    req.session.admin = true;
    return res.redirect("/admin");
  }
  res.render("admin-login", {
    title: "Admin sign in",
    site,
    error: "Invalid admin password.",
  });
});

app.post("/admin/logout", requireAdmin, (req, res) => {
  delete req.session.admin;
  req.session.save(() => res.redirect("/"));
});

app.get("/admin", requireAdmin, (req, res) => {
  res.render("admin", {
    title: "Edit site",
    site: readSite(),
    poll: readPoll(),
    extraCss: "/css/admin.css",
    message: req.query.saved ? "Changes saved." : null,
    error: null,
  });
});

app.post("/admin/save", requireAdmin, adminSaveLimiter, (req, res) => {
  try {
    const parsed = validateSitePayload(req.body);
    writeSite(parsed);
    return res.json({ ok: true });
  } catch (e) {
    const msg = e.message || "Could not save.";
    return res.status(400).json({ ok: false, error: msg });
  }
});

app.post("/admin/poll/save", requireAdmin, adminSaveLimiter, (req, res) => {
  try {
    applyAdminPollUpdate(req.body || {});
    return res.json({ ok: true, votes: readPoll().votes });
  } catch (e) {
    const msg = e.message || "Could not save poll.";
    return res.status(400).json({ ok: false, error: msg });
  }
});

app.post("/admin/poll/vote/delete", requireAdmin, adminSaveLimiter, (req, res) => {
  try {
    const voteId = req.body && req.body.voteId;
    deleteVoteById(voteId);
    return res.json({ ok: true, votes: readPoll().votes });
  } catch (e) {
    const msg = e.message || "Could not remove vote.";
    return res.status(400).json({ ok: false, error: msg });
  }
});

app.use((req, res) => {
  res.status(404).render("404", { title: "Not found", site: readSite() });
});

ensureSiteFile();
app.listen(PORT, () => {
  console.log(`Ferndale portal listening on http://0.0.0.0:${PORT}`);
  if (process.env.NODE_ENV === "production" && SESSION_SECRET === "dev-secret-change-me") {
    console.warn(
      "SECURITY: SESSION_SECRET is still the default — set a strong random value in production."
    );
  }
  if (SITE_GATE_ENABLED && !SITE_GATE_PASSWORD) {
    console.warn(
      "SITE_GATE_ENABLED is set but SITE_GATE_PASSWORD is empty — site gate is disabled."
    );
  } else if (siteGateActive) {
    console.log("Site gate enabled (password required before browsing).");
  }
  if (cookieSecure) {
    console.log("Session cookies use Secure flag (HTTPS only).");
  }
});
