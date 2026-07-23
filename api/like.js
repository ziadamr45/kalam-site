// POST /api/like   { slug, fingerprint }   → like an article
// DELETE /api/like { slug, fingerprint }   → remove like (toggle off)
// GET  /api/like?slug=...&slugs=...        → get count(s)

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
      const counts = await Promise.all(slugs.map(async (slug) => {
        const data = await lib.getLikes(slug);
        return { slug, count: data.count || 0 };
      }));
      if (single) return lib.sendJson(res, counts[0]);
      return lib.sendJson(res, { items: counts });
    } catch (e) {
      console.error('GET /api/like error:', e);
      return lib.sendJson(res, { error: 'server error' }, 500);
    }
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return lib.sendJson(res, { error: 'method not allowed' }, 405);
  }

  const ip = lib.getClientIp(req);
  if (!lib.rateLimit(ip, 'like', lib.MAX_GENERAL_REQ_PER_IP_PER_MIN)) {
    return lib.sendJson(res, { error: 'كتير طلبات، حاول تاني بعد دقيقة' }, 429);
  }

  // Parse body (Vercel auto-parses JSON, but be defensive)
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return lib.sendJson(res, { error: 'invalid JSON' }, 400); }
  }

  const slug = body.slug;
  const fingerprint = body.fingerprint;
  if (!lib.isValidSlug(slug)) return lib.sendJson(res, { error: 'invalid slug' }, 400);
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8 || fingerprint.length > 200) {
    return lib.sendJson(res, { error: 'invalid fingerprint' }, 400);
  }

  try {
    const fpHash = lib.sha256(fingerprint);
    const ipHash = lib.sha256(ip);
    const data = await lib.getLikes(slug);

    if (req.method === 'POST') {
      if (data.fingerprints && data.fingerprints.includes(fpHash)) {
        return lib.sendJson(res, { ok: false, alreadyLiked: true, count: data.count, message: 'تم تسجيل إعجابك قبل كده' }, 200);
      }
      const ipCount = (data.ips || []).filter(x => x === ipHash).length;
      if (ipCount >= lib.MAX_LIKES_PER_IP) {
        return lib.sendJson(res, {
          ok: false, rateLimited: true, count: data.count,
          message: `وصلت للحد الأقصى (${lib.MAX_LIKES_PER_IP} إعجابات من نفس الشبكة)`,
        }, 200);
      }
      data.fingerprints = data.fingerprints || [];
      data.ips = data.ips || [];
      data.fingerprints.push(fpHash);
      data.ips.push(ipHash);
      data.count = (data.count || 0) + 1;
      await lib.setLikes(slug, data);
      return lib.sendJson(res, { ok: true, liked: true, count: data.count }, 200);
    }

    if (req.method === 'DELETE') {
      if (!data.fingerprints || !data.fingerprints.includes(fpHash)) {
        return lib.sendJson(res, { ok: false, notLiked: true, count: data.count || 0 }, 200);
      }
      const fpIdx = data.fingerprints.indexOf(fpHash);
      data.fingerprints.splice(fpIdx, 1);
      for (let i = data.ips.length - 1; i >= 0; i--) {
        if (data.ips[i] === ipHash) { data.ips.splice(i, 1); break; }
      }
      data.count = Math.max(0, (data.count || 0) - 1);
      await lib.setLikes(slug, data);
      return lib.sendJson(res, { ok: true, liked: false, count: data.count }, 200);
    }
  } catch (e) {
    console.error('POST/DELETE /api/like error:', e);
    return lib.sendJson(res, { error: 'server error' }, 500);
  }
};
