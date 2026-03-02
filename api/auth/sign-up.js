const { callNeonAuth, copyResponseHeaders, parseJsonBody, sendJson } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const result = await callNeonAuth({
      req,
      method: 'POST',
      path: '/sign-up/email',
      body,
    });

    copyResponseHeaders(result.headers, res);
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
