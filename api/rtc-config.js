const { sendJson } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  sendJson(res, 200, { iceServers });
};
