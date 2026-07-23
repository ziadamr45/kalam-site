// DELETE /api/comment-admin?id=...&slug=...   (admin only — X-Admin-Token header)
// GET  /api/comment-admin?all=1              (admin only — list all comments)
//
// Token: ADMIN_TOKEN env var. Sent as X-Admin-Token header.

const lib = require('./_lib.js');

function requireAdmin(req) {
  const token = req.headers['x-admin-token'] || '';
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: false, code: 503, msg: 'admin not configured' };
  if (token.length !== expected.length || token !== expected) {
    return { ok: false, code: 401, msg: 'unauthorized' };
  }
  return { ok: true };
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return lib.sendJson(res, {}, 204);

  const auth = requireAdmin(req);
  if (!auth.ok) return lib.sendJson(res, { error: auth.msg }, auth.code);

  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET') {
    try {
      const slugs = await lib.getCommentIndex();
      const all = await Promise.all(slugs.map(async (slug) => {
        const list = await lib.getComments(slug);
        return list.map(c => ({ ...c, slug }));
      }));
      const flat = all.flat().sort((a, b) => b.ts - a.ts);
      return lib.sendJson(res, { items: flat, count: flat.length });
    } catch (e) {
      console.error('GET /api/comment-admin error:', e);
      return lib.sendJson(res, { error: 'server error' }, 500);
    }
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const slug = url.searchParams.get('slug');
    if (!id || !lib.isValidSlug(slug)) return lib.sendJson(res, { error: 'id and slug required' }, 400);
    try {
      const list = await lib.getComments(slug);
      const filtered = list.filter(c => c.id !== id);
      if (filtered.length === list.length) return lib.sendJson(res, { error: 'comment not found' }, 404);
      await lib.setComments(slug, filtered);
      return lib.sendJson(res, { ok: true, count: filtered.length });
    } catch (e) {
      console.error('DELETE /api/comment-admin error:', e);
      return lib.sendJson(res, { error: 'server error' }, 500);
    }
  }

  return lib.sendJson(res, { error: 'method not allowed' }, 405);
};
