"use strict";

const crypto = require("crypto");
const sanitizeHtml = require("sanitize-html");

const DISALLOW_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "form",
  "input",
  "object",
  "embed",
  "base",
  "link",
  "meta",
]);

const RICH_HTML_OPTS = {
  allowedTags: sanitizeHtml.defaults.allowedTags.filter((t) => !DISALLOW_TAGS.has(t)),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "width", "height", "loading"],
    table: ["class"],
    thead: ["class"],
    tbody: ["class"],
    tr: ["class"],
    th: ["class", "colspan", "rowspan"],
    td: ["class", "colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https"],
  },
  allowProtocolRelative: false,
};

/**
 * Rich HTML for homepage body and page content (admin-controlled).
 */
function sanitizeRichHtml(html) {
  return sanitizeHtml(String(html || ""), RICH_HTML_OPTS);
}

/**
 * Strip tags for titles, labels, subtitles.
 */
function sanitizePlainText(s, maxLen) {
  const out = sanitizeHtml(String(s || ""), {
    allowedTags: [],
    allowedAttributes: {},
  });
  if (typeof maxLen === "number" && out.length > maxLen) {
    return out.slice(0, maxLen);
  }
  return out;
}

function safeExternalHttpUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

/**
 * Navigation link safe for href (blocks javascript:, data:, etc.).
 */
function normalizeNavLink(item) {
  const label = sanitizePlainText(String(item.label || "").trim(), 500) || "Link";
  const external = Boolean(item.external);
  let pathRaw = String(item.path || "").trim();

  if (!external) {
    if (!pathRaw.startsWith("/")) {
      pathRaw = "/" + pathRaw;
    }
    if (pathRaw.startsWith("//")) {
      throw new Error(`Protocol-relative paths are not allowed for "${label}".`);
    }
    pathRaw = pathRaw.replace(/\/{2,}/g, "/");
    const cut = pathRaw.split(/[?#]/)[0];
    if (cut.includes(":")) {
      throw new Error(`Unsafe internal path for link "${label}".`);
    }
    return { label, path: cut || "/", external: false };
  }

  const url = safeExternalHttpUrl(pathRaw);
  if (!url) {
    throw new Error(`Invalid external URL for link "${label}" (use http or https only).`);
  }
  return { label, path: url, external: true };
}

function normalizeSlug(raw) {
  return (
    String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "page"
  );
}

function normalizePage(item) {
  const slug = normalizeSlug(item.slug);
  const title = sanitizePlainText(String(item.title || "").trim(), 300) || "Untitled";
  const content = sanitizeRichHtml(String(item.content || ""));
  const page = { slug, title, content };
  if (item.memberOnly === true) page.memberOnly = true;
  return page;
}

const HOME_SECTION_KEYS = ["intro", "calendar", "quick", "poll"];

/**
 * Homepage blocks: intro (body), calendar widget, quick links, poll.
 * Ensures each key appears once; unknown keys dropped; missing keys appended in default order.
 */
function normalizeHomeSectionOrder(raw) {
  const allowed = new Set(HOME_SECTION_KEYS);
  const seen = new Set();
  const out = [];
  const arr = Array.isArray(raw) ? raw : [];
  for (const k of arr) {
    const key = String(k || "").trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const k of HOME_SECTION_KEYS) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

/** Compare passwords without leaking length via timing (best-effort). */
function timingSafePasswordEqual(input, expected) {
  const a = String(input || "");
  const b = String(expected || "");
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  sanitizeRichHtml,
  sanitizePlainText,
  normalizeNavLink,
  normalizePage,
  normalizeSlug,
  normalizeHomeSectionOrder,
  HOME_SECTION_KEYS,
  timingSafePasswordEqual,
};
