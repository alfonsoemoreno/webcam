const { sendJson } = require('../_lib');

module.exports = async (req, res) => {
  sendJson(res, 410, {
    error: 'Deprecated endpoint. Use Neon Auth client SDK directly from frontend.',
  });
};
