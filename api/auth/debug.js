const { getJwksUrl, getNeonAuthBaseUrl, parseJsonBody, sendJson, verifyJwt } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    let token = '';
    const headerAuth = String(req.headers.authorization || '').trim();
    if (headerAuth.toLowerCase().startsWith('bearer ')) {
      token = headerAuth.slice(7).trim();
    }

    if (!token && req.method === 'POST') {
      const body = await parseJsonBody(req);
      token = String(body.token || '').trim();
    }

    let tokenCheck = null;
    if (token) {
      try {
        tokenCheck = { ok: true, claims: await verifyJwt(token) };
      } catch (err) {
        tokenCheck = { ok: false, error: err.message || 'Token invalid' };
      }
    }

    sendJson(res, 200, {
      authUrl: getNeonAuthBaseUrl() || null,
      jwksUrl: getJwksUrl() || null,
      hasBearerHeader: Boolean(headerAuth),
      tokenCheck,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
