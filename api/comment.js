// POST /api/comment  { slug, name, text, fingerprint, website }
//   - name optional (defaults to "زائر")
//   - text required, 1..1000 chars, no URLs
//   - website field is a honeypot — bots fill it, we silently succeed
//   - rate limit: 2 comments per minute per IP
// GET /api/comment?slug=...     → { items: [...], count: N }
// GET /api/comment?slugs=a,b,c  → { items: [{ slug, count }, ...] }

const lib = require('./_lib.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return lib.sendJson(res, {}, 204);

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const single = url.searchParams.get('slug');
    const batch = url.searchParams.get('slugs');
    const slugs = batch ? batch.split(',').map(s => s.trim()).filter(Boolean) : (single ? [single] : []);
    if (slugs.length === 0) return lib.sendJson(res, { error: 'slug required' }, 400);
    if (slugs.some(s => !lib.isValidSlug(s))) return lib.sendJson(res, { error: 'invalid slug' }, 400);

    try {
      if (batch) {
        const counts = await Promise.all(slugs.map(async (slug) => {
          const list = await lib.getComments(slug);
          return { slug, count: list.length };
        }));
        return lib.sendJson(res, { items: counts });
      }
      const list = await lib.getComments(single);
      const sorted = [...list].sort((a, b) => b.ts - a.ts);
      return lib.sendJson(res, { items: sorted, count: sorted.length });
    } catch (e) {
      console.error('GET /api/comment error:', e);
      return lib.sendJson(res, { error: 'server error' }, 500);
    }
  }

  if (req.method !== 'POST') return lib.sendJson(res, { error: 'method not allowed' }, 405);

  const ip = lib.getClientIp(req);
  if (!lib.rateLimit(ip, 'comment', lib.MAX_COMMENTS_PER_IP_PER_MIN)) {
    return lib.sendJson(res, { error: 'كتير تعليقات، حاول تاني بعد دقيقة' }, 429);
  }
  if (!lib.rateLimit(ip, 'general', lib.MAX_GENERAL_REQ_PER_IP_PER_MIN)) {
    return lib.sendJson(res, { error: 'كتير طلبات، حاول تاني بعد دقيقة' }, 429);
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return lib.sendJson(res, { error: 'invalid JSON' }, 400); }
  }

  const slug = body.slug;
  const fingerprint = body.fingerprint;
  let name = (body.name && String(body.name).trim()) || 'زائر';
  const text = body.text ? String(body.text).trim() : '';
  const website = body.website ? String(body.website).trim() : '';

  // Honeypot — silently succeed for bots
  if (website) return lib.sendJson(res, { ok: true, fake: true }, 200);

  if (!lib.isValidSlug(slug)) return lib.sendJson(res, { error: 'invalid slug' }, 400);
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8 || fingerprint.length > 200) {
    return lib.sendJson(res, { error: 'invalid fingerprint' }, 400);
  }
  if (!text) return lib.sendJson(res, { error: 'التعليق فاضي' }, 400);
  if (text.length > lib.MAX_COMMENT_LEN) {
    return lib.sendJson(res, { error: `التعليق طويل أوي (حد أقصى ${lib.MAX_COMMENT_LEN} حرف)` }, 400);
  }
  if (lib.URL_RE.test(text)) return lib.sendJson(res, { error: 'ممنوع الروابط في التعليقات' }, 400);
  if (name.length > lib.MAX_NAME_LEN) name = name.slice(0, lib.MAX_NAME_LEN);

  try {
    const fpHash = lib.sha256(fingerprint);
    const ipHash = lib.sha256(ip);
    const list = await lib.getComments(slug);

    const newComment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      text,
      ts: Date.now(),
      ip: ipHash,
      fingerprint: fpHash,
    };
    list.push(newComment);
    await lib.setComments(slug, list);
    await lib.addToCommentIndex(slug);

    return lib.sendJson(res, {
      ok: true,
      comment: {
        id: newComment.id,
        name: lib.escapeHtml(newComment.name),
        text: lib.escapeHtml(newComment.text),
        ts: newComment.ts,
      },
      count: list.length,
    });
  } catch (e) {
    console.error('POST /api/comment error:', e);
    return lib.sendJson(res, { error: 'server error' }, 500);
  }
};
