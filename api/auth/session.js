const { getSessionFromNeon, sendJson } = require('../_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const sessionResult = await getSessionFromNeon(req);
    if (!sessionResult.ok) {
      sendJson(res, 401, { authenticated: false });
      return;
    }

    sendJson(res, 200, {
      authenticated: true,
      user: sessionResult.session.user,
    });
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
