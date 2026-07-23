// GET /api/comments?slug=...     → { items: [...], count: N }
// GET /api/comments?slugs=a,b,c  → { items: [{ slug, count }, ...] }
// Aliased to /api/comment GET handler.

const commentHandler = require('./comment.js');
const lib = require('./_lib.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return lib.sendJson(res, {}, 204);
  if (req.method === 'GET') return commentHandler(req, res);
  return lib.sendJson(res, { error: 'method not allowed' }, 405);
};
