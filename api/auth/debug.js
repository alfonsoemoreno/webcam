const {
  callNeonAuth,
  deriveOrigin,
  getNeonAuthBaseUrl,
  sendJson,
} = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const derivedOrigin = deriveOrigin(req);
    const authBaseUrl = getNeonAuthBaseUrl();

    let upstream = null;
    if (authBaseUrl) {
      const result = await callNeonAuth({ req, method: 'GET', path: '/session' });
      upstream = {
        status: result.status,
        ok: result.ok,
        body: result.json,
      };
    }

    sendJson(res, 200, {
      derivedOrigin,
      appOriginEnv: process.env.APP_ORIGIN || null,
      neonAuthBaseUrl: authBaseUrl || null,
      requestHeaders: {
        origin: req.headers.origin || null,
        referer: req.headers.referer || null,
        host: req.headers.host || null,
        xForwardedHost: req.headers['x-forwarded-host'] || null,
        xForwardedProto: req.headers['x-forwarded-proto'] || null,
      },
      upstream,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
