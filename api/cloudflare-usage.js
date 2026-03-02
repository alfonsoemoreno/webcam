const { fetchCloudflareMonthlyUsage, requireAuth, sendJson } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const session = await requireAuth(req, res);
    if (!session) return;

    const usage = await fetchCloudflareMonthlyUsage();
    sendJson(res, 200, usage);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
};
