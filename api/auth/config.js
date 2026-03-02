const { getJwksUrl, getNeonAuthBaseUrl, sendJson } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  sendJson(res, 200, {
    authEnabled: Boolean(getNeonAuthBaseUrl()),
    authUrl: getNeonAuthBaseUrl() || null,
    jwksConfigured: Boolean(getJwksUrl()),
  });
};
