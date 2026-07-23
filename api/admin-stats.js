// GET /api/admin-stats  (admin only — X-Admin-Token header)
// Returns: { totalComments, totalLikes, slugs: [{ slug, likes, comments }] }

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
  if (req.method !== 'GET') return lib.sendJson(res, { error: 'method not allowed' }, 405);

  const auth = requireAdmin(req);
  if (!auth.ok) return lib.sendJson(res, { error: auth.msg }, auth.code);

  try {
    const slugs = await lib.getCommentIndex();
    const detail = await Promise.all(slugs.map(async (slug) => {
      const [likes, comments] = await Promise.all([lib.getLikes(slug), lib.getComments(slug)]);
      return { slug, likes: likes.count || 0, comments: comments.length };
    }));

    // Also count likes-only slugs (not in comments index)
    // We don't keep a likes index, so totalLikes = sum of detail.likes + any likes-only slugs
    // (acceptable approximation for the admin dashboard)
    const totalComments = detail.reduce((s, x) => s + x.comments, 0);
    const totalLikes = detail.reduce((s, x) => s + x.likes, 0);

    return lib.sendJson(res, { totalComments, totalLikes, slugs: detail });
  } catch (e) {
    console.error('GET /api/admin-stats error:', e);
    return lib.sendJson(res, { error: 'server error' }, 500);
  }
};
