// Shared Edge Config helpers for /api endpoints.
// Uses Vercel Edge Config REST API directly (no SDK needed).
//
// Required env vars (set on Vercel project):
//   - EDGE_CONFIG_ID         — ecfg_xxx
//   - EDGE_CONFIG_TOKEN      — token for READS via edge-config.vercel.com
//   - VERCEL_TOKEN           — Vercel API token for WRITES via api.vercel.com
//   - VERCEL_TEAM_ID         — Vercel team id (for write API)
//
// Data model (one Edge Config key per slug, JSON-encoded):
//   likes:{slug}    → { count: number, fingerprints: string[], ips: string[] }
//   comments:{slug} → [{ id, name, text, ts, ip, fingerprint }]
//   comments:index  → [slug, slug, ...]   (for /admin listing)

const crypto = require('crypto');

const EDGE_CONFIG_ID = process.env.EDGE_CONFIG_ID;
const EDGE_CONFIG_TOKEN = process.env.EDGE_CONFIG_TOKEN;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const TEAM_ID = process.env.VERCEL_TEAM_ID || process.env.TEAM_ID;

const READ_BASE = `https://edge-config.vercel.com/${EDGE_CONFIG_ID}`;
const WRITE_URL = `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items${TEAM_ID ? `?teamId=${TEAM_ID}` : ''}`;

// ── Hashing (SHA-256 → first 32 hex chars) ────────────────────────────────
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);
}

// ── READ ───────────────────────────────────────────────────────────────────
async function readItem(key) {
  const r = await fetch(`${READ_BASE}/item/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${EDGE_CONFIG_TOKEN}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`edge-config read ${key}: ${r.status}`);
  const text = await r.text();
  // Edge Config returns values JSON-encoded. If the stored value was a string,
  // it comes back wrapped in quotes — try parsing once, and if that yields a
  // string, parse again to get the actual JSON object.
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      try { return JSON.parse(parsed); }
      catch { return parsed; }
    }
    return parsed;
  } catch {
    return text;
  }
}

// ── WRITE (upsert) ─────────────────────────────────────────────────────────
async function writeItem(key, value) {
  // Edge Config stores items as JSON-encoded strings; passing a string in
  // the request body causes it to be re-stringified on read (double quotes).
  // Solution: always pass the value as a JSON string in the request body —
  // Edge Config will treat it as a string value, and readItem will unwrap.
  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
  const body = {
    items: [{
      operation: 'upsert',
      key,
      value: stringValue,
    }],
  };
  const r = await fetch(WRITE_URL, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`edge-config write ${key}: ${r.status} ${t}`);
  }
  return true;
}

// ── Domain helpers ─────────────────────────────────────────────────────────
// Edge Config keys allow [a-zA-Z0-9_-] only — so we use ":" in code but
// convert to "__" before storing (and back on read).
const KEY_SEP = '__';
function sanitizeKey(k) { return k.replace(/[:/]/g, '_'); }

const likeKey = (slug) => `likes${KEY_SEP}${slug}`;
const commentKey = (slug) => `comments${KEY_SEP}${slug}`;
const INDEX_KEY = 'comments_index';

async function getLikes(slug) {
  const data = await readItem(likeKey(slug));
  if (!data) return { count: 0, fingerprints: [], ips: [] };
  return data;
}
async function setLikes(slug, data) { return writeItem(likeKey(slug), data); }

async function getComments(slug) {
  const data = await readItem(commentKey(slug));
  if (!data) return [];
  return Array.isArray(data) ? data : [];
}
async function setComments(slug, list) { return writeItem(commentKey(slug), list); }

async function getCommentIndex() {
  const data = await readItem(INDEX_KEY);
  if (!data) return [];
  return Array.isArray(data) ? data : [];
}
async function addToCommentIndex(slug) {
  const idx = await getCommentIndex();
  if (!idx.includes(slug)) {
    idx.push(slug);
    await writeItem(INDEX_KEY, idx);
  }
}

// ── Rate limiting (in-memory per cold start instance) ─────────────────────
const rateBuckets = new Map();
const WINDOW_MS = 60_000;
function rateLimit(ip, endpoint, maxPerMin) {
  const now = Date.now();
  const key = `${ip}:${endpoint}`;
  const arr = (rateBuckets.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (arr.length >= maxPerMin) return false;
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}

// ── Response helper (Node.js res object) ──────────────────────────────────
function sendJson(res, body, status = 200, extraHeaders = {}) {
  res.status(status);
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.end(JSON.stringify(body));
}

// ── Validation helpers ────────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9-]{1,80}$/;
function isValidSlug(slug) { return typeof slug === 'string' && SLUG_RE.test(slug); }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || '0.0.0.0';
}

// ── Constants ──────────────────────────────────────────────────────────────
const MAX_LIKES_PER_IP = 3;
const MAX_COMMENTS_PER_IP_PER_MIN = 2;
const MAX_GENERAL_REQ_PER_IP_PER_MIN = 10;
const MAX_COMMENT_LEN = 1000;
const MAX_NAME_LEN = 50;
const URL_RE = /https?:\/\//i;

module.exports = {
  sha256,
  readItem, writeItem,
  getLikes, setLikes,
  getComments, setComments,
  getCommentIndex, addToCommentIndex,
  rateLimit,
  sendJson,
  isValidSlug,
  escapeHtml,
  getClientIp,
  likeKey, commentKey, INDEX_KEY,
  MAX_LIKES_PER_IP,
  MAX_COMMENTS_PER_IP_PER_MIN,
  MAX_GENERAL_REQ_PER_IP_PER_MIN,
  MAX_COMMENT_LEN,
  MAX_NAME_LEN,
  URL_RE,
};
