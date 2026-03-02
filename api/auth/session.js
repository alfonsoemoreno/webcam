const { extractBearerToken, requireAuth, sendJson } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const claims = await requireAuth(req, res);
    if (!claims) return;
    sendJson(res, 200, {
      authenticated: true,
      user: {
        id: claims.sub || claims.user_id || null,
        email: claims.email || null,
      },
      claims,
      tokenPresent: Boolean(extractBearerToken(req)),
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
