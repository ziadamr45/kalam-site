// GET /api/likes?slug=...        → { slug, count }
// GET /api/likes?slugs=a,b,c     → { items: [{ slug, count }, ...] }
// Aliased to /api/like GET handler.

const likeHandler = require('./like.js');
const lib = require('./_lib.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return lib.sendJson(res, {}, 204);
  if (req.method === 'GET') return likeHandler(req, res);
  return lib.sendJson(res, { error: 'method not allowed' }, 405);
};
