"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sanitizePlainText } = require("./security");

const POLL_FILE = path.join(__dirname, "..", "data", "poll.json");
const POLL_DEFAULT = path.join(__dirname, "..", "config", "poll.default.json");

const MAX_OPTIONS = 50;
const MAX_VOTES = 500;
const MAX_LABEL_LEN = 200;
const MAX_NAME_LEN = 120;
const MAX_QUESTION_LEN = 500;

function ensurePollFile() {
  const dir = path.dirname(POLL_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(POLL_FILE) && fs.existsSync(POLL_DEFAULT)) {
    fs.copyFileSync(POLL_DEFAULT, POLL_FILE);
  }
}

function readPoll() {
  ensurePollFile();
  const raw = fs.readFileSync(POLL_FILE, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.options)) data.options = [];
  if (!Array.isArray(data.votes)) data.votes = [];
  data.question = String(data.question || "").slice(0, MAX_QUESTION_LEN);
  return data;
}

function writePoll(data) {
  ensurePollFile();
  fs.writeFileSync(POLL_FILE, JSON.stringify(data, null, 2), "utf8");
}

function normalizeOptionId(id) {
  const s = String(id || "").trim();
  if (!s || s.length > 80) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return null;
  return s;
}

function sanitizeOptionLabel(label) {
  const t = sanitizePlainText(String(label || "").trim(), MAX_LABEL_LEN);
  return t || null;
}

function sanitizeVoterName(name) {
  const t = sanitizePlainText(String(name || "").trim(), MAX_NAME_LEN);
  return t || null;
}

function sanitizeQuestion(q) {
  return sanitizePlainText(String(q || "").trim(), MAX_QUESTION_LEN) || "Poll";
}

/**
 * Admin save: { question, options: [{id, label}], clearVotes?: boolean }
 */
function applyAdminPollUpdate(body) {
  const current = readPoll();
  const question = sanitizeQuestion(body.question);
  const clearVotes = Boolean(body.clearVotes);
  const incoming = Array.isArray(body.options) ? body.options : [];
  const options = [];
  const seen = new Set();
  for (const row of incoming) {
    if (options.length >= MAX_OPTIONS) break;
    const id = normalizeOptionId(row.id) || `opt-${crypto.randomUUID()}`;
    if (seen.has(id)) continue;
    const label = sanitizeOptionLabel(row.label);
    if (!label) continue;
    seen.add(id);
    options.push({ id, label });
  }
  if (options.length === 0) {
    throw new Error("Poll needs at least one option.");
  }
  let votes = [];
  if (!clearVotes) {
    const allowed = new Set(options.map((o) => o.id));
    votes = current.votes.filter((v) => allowed.has(v.optionId));
  }
  writePoll({ question, options, votes });
}

function addPublicOption(label) {
  const optLabel = sanitizeOptionLabel(label);
  if (!optLabel) {
    throw new Error("Please enter a choice label.");
  }
  const poll = readPoll();
  if (poll.options.length >= MAX_OPTIONS) {
    throw new Error("Maximum number of choices reached.");
  }
  const id = `opt-${crypto.randomUUID()}`;
  poll.options.push({ id, label: optLabel });
  writePoll(poll);
  return { id, label: optLabel };
}

function addVote(optionId, voterName) {
  const id = normalizeOptionId(optionId);
  const name = sanitizeVoterName(voterName);
  if (!id) throw new Error("Invalid choice.");
  if (!name) throw new Error("Please enter your name.");
  const poll = readPoll();
  const exists = poll.options.some((o) => o.id === id);
  if (!exists) throw new Error("That choice is no longer available.");
  if (poll.votes.length >= MAX_VOTES) {
    throw new Error("This poll has reached the maximum number of responses.");
  }
  poll.votes.push({
    id: `vote-${crypto.randomUUID()}`,
    optionId: id,
    voterName: name,
    createdAt: new Date().toISOString(),
  });
  writePoll(poll);
}

function optionLabelById(poll, optionId) {
  const o = poll.options.find((x) => x.id === optionId);
  return o ? o.label : optionId;
}

function normalizeVoteId(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > 100) return null;
  if (!/^vote-[a-zA-Z0-9_-]+$/.test(s)) return null;
  return s;
}

function deleteVoteById(voteId) {
  const id = normalizeVoteId(voteId);
  if (!id) {
    throw new Error("Invalid vote id.");
  }
  const poll = readPoll();
  const idx = poll.votes.findIndex((v) => v.id === id);
  if (idx === -1) {
    throw new Error("That vote was not found.");
  }
  poll.votes.splice(idx, 1);
  writePoll(poll);
}

module.exports = {
  readPoll,
  writePoll,
  ensurePollFile,
  applyAdminPollUpdate,
  addPublicOption,
  addVote,
  deleteVoteById,
  optionLabelById,
  POLL_FILE,
};
